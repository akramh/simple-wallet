/**
 * @fileoverview Swap wizard for the extension popup/sidepanel.
 *
 * Four steps: pick the source token (active network), pick the destination
 * network from the capability matrix and the token on it, enter an amount
 * (debounced re-quote), then confirm. Dispatches the chain-neutral swap
 * messages; routing (same-chain 1inch vs cross-chain Mayan) and all signing
 * happen in the service worker.
 *
 * @responsibilities
 * - Fetch capabilities and destination tokens via GET_SWAP_CAPABILITIES /
 *   GET_SWAP_DEST_TOKENS
 * - Debounce quote requests (the 1inch free tier is ~1 req/sec)
 * - Surface approval requirements, execution phases, and terminal status
 *
 * @security
 * - No secrets handled in UI. Solana-source swaps are signed in the service
 *   worker with the session password; the popup never sees or asks for it.
 * - Quotes expire; the confirm step re-quotes rather than submitting a stale
 *   quote, which the service layer would reject anyway.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import { ScreenHeader } from './ui';

interface TokenData {
  symbol: string;
  name: string;
  type?: string;
  address: string;
  decimals: number;
}

interface SwapCapabilitiesData {
  canSwap: boolean;
  sameChain: boolean;
  crossChain: boolean;
  destinationNetworkKeys: string[];
  unsupportedReason?: string;
}

interface SwapQuoteData {
  provider: 'oneinch' | 'mayan';
  fromNetworkKey: string;
  toNetworkKey: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted: string;
  rateFormatted: string;
  feeFormatted: string;
  bridgeFeeFormatted?: string;
  etaSeconds?: number;
  needsApproval: boolean;
  approvalSpender?: string;
  expiresAt: number;
  raw: unknown;
  request: unknown;
}

interface SwapResultData {
  provider: 'oneinch' | 'mayan';
  txId: string;
  approvalTxId?: string;
  fromNetworkKey: string;
  toNetworkKey: string;
}

interface Props {
  network: string;
  networks: Record<string, any>;
  /** Tokens on the active (source) network. */
  tokens: TokenData[];
  /** Called on exit; didSwap=true when a swap was submitted. */
  onClose: (didSwap: boolean) => void;
}

type Step = 'source' | 'destination' | 'amount' | 'confirm' | 'result';

/** Human labels for the execution phases broadcast by the service worker. */
const PHASE_LABELS: Record<string, string> = {
  'checking-allowance': 'Checking token allowance…',
  'approving': 'Approve the token spend…',
  'approval-confirmed': 'Approval confirmed',
  'submitting-swap': 'Submitting swap…',
  'swap-submitted': 'Swap submitted',
};

/**
 * Swap wizard.
 *
 * @param props - Component props
 * @returns Swap flow component
 */
function SwapFlowView({ network, networks, tokens, onClose }: Props) {
  const [step, setStep] = useState<Step>('source');
  const [capabilities, setCapabilities] = useState<SwapCapabilitiesData | null>(null);
  const [fromToken, setFromToken] = useState<TokenData | null>(null);
  const [toNetworkKey, setToNetworkKey] = useState<string>('');
  const [destTokens, setDestTokens] = useState<TokenData[]>([]);
  const [destTokensLoading, setDestTokensLoading] = useState(false);
  const [toToken, setToToken] = useState<TokenData | null>(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [quote, setQuote] = useState<SwapQuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResultData | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ state: string; destTxId?: string; detail?: string } | null>(null);

  const networkLabel = useCallback(
    (key: string) => networks[key]?.name || key,
    [networks]
  );

  useEffect(() => {
    let cancelled = false;
    sendMessageWithRetry<{ capabilities?: SwapCapabilitiesData; error?: string }>({
      type: 'GET_SWAP_CAPABILITIES',
      payload: { networkKey: network },
    })
      .then((resp) => { if (!cancelled) setCapabilities(resp?.capabilities || null); })
      .catch(() => { if (!cancelled) setCapabilities(null); });
    return () => { cancelled = true; };
  }, [network]);

  // Destination tokens are fetched per selected network — you can swap into a
  // token you hold none of, so this can't reuse the sendable-assets list.
  useEffect(() => {
    if (!toNetworkKey) return;
    let cancelled = false;
    setDestTokensLoading(true);
    setDestTokens([]);
    sendMessageWithRetry<{ tokens?: TokenData[]; error?: string }>({
      type: 'GET_SWAP_DEST_TOKENS',
      payload: { networkKey: toNetworkKey },
    })
      .then((resp) => { if (!cancelled) setDestTokens(resp?.tokens || []); })
      .catch(() => { if (!cancelled) setDestTokens([]); })
      .finally(() => { if (!cancelled) setDestTokensLoading(false); });
    return () => { cancelled = true; };
  }, [toNetworkKey]);

  // Listen for execution progress broadcast by the service worker.
  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'SWAP_PROGRESS') {
        setPhase(message.payload?.phase ?? null);
      } else if (message?.type === 'SWAP_STATUS') {
        setStatus(message.payload ?? null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const validateAmount = (value: string): string | null => {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return 'Enter a valid numeric amount';
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
    return null;
  };

  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !toNetworkKey) return;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const resp = await sendMessageWithRetry<{ quote?: SwapQuoteData; error?: string }>({
        type: 'GET_SWAP_QUOTE',
        payload: {
          request: {
            fromNetworkKey: network,
            fromToken,
            toNetworkKey,
            toToken,
            amount: amount.trim(),
          },
        },
      });
      if (resp?.error) throw new Error(resp.error);
      if (!resp?.quote) throw new Error('No quote returned');
      setQuote(resp.quote);
    } catch (err: any) {
      setQuote(null);
      setQuoteError(err?.message || 'Could not fetch a quote');
    } finally {
      setQuoteLoading(false);
    }
  }, [fromToken, toToken, toNetworkKey, network, amount]);

  // Debounced quoting on the confirm step. 1inch's free tier is ~1 req/sec,
  // so every keystroke must not become a request.
  useEffect(() => {
    if (step !== 'confirm') return;
    const timer = setTimeout(() => { fetchQuote(); }, 400);
    return () => clearTimeout(timer);
  }, [step, fetchQuote]);

  const submitSwap = async () => {
    if (!quote) return;
    setSubmitting(true);
    setSubmitError(null);
    setPhase(null);
    try {
      // Re-quote when the current one has aged out rather than submitting a
      // stale quote the service layer would reject.
      let effectiveQuote = quote;
      if (Date.now() > quote.expiresAt) {
        const refreshed = await sendMessageWithRetry<{ quote?: SwapQuoteData; error?: string }>({
          type: 'GET_SWAP_QUOTE',
          payload: {
            request: {
              fromNetworkKey: network,
              fromToken,
              toNetworkKey,
              toToken,
              amount: amount.trim(),
            },
          },
        });
        if (refreshed?.error) throw new Error(refreshed.error);
        if (!refreshed?.quote) throw new Error('Quote expired — try again');
        effectiveQuote = refreshed.quote;
        setQuote(refreshed.quote);
      }

      const resp = await sendMessageWithRetry<{ result?: SwapResultData; error?: string }>({
        type: 'EXECUTE_SWAP',
        payload: { quote: effectiveQuote },
      });
      if (resp?.error) throw new Error(resp.error);
      if (!resp?.result?.txId) throw new Error('No transaction id returned');
      setResult(resp.result);
      setStep('result');
    } catch (err: any) {
      setSubmitError(err?.message || 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Same-network swaps into the same token are meaningless.
  const selectableDestTokens = useMemo(
    () => destTokens.filter((t) => !(toNetworkKey === network && t.symbol === fromToken?.symbol)),
    [destTokens, toNetworkKey, network, fromToken]
  );

  const destinationKeys = capabilities?.destinationNetworkKeys ?? [];

  const goBack = () => {
    if (step === 'destination') setStep('source');
    else if (step === 'amount') setStep('destination');
    else if (step === 'confirm') setStep('amount');
    else onClose(step === 'result');
  };

  return (
    <div className="takeover">
      <ScreenHeader title="Swap" onBack={goBack} />

      <div style={{ padding: '0 16px 16px' }}>
        {capabilities && !capabilities.canSwap && (
          <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
            <span>{capabilities.unsupportedReason || 'Swaps are not available on this network'}</span>
          </div>
        )}

        {step === 'source' && (
          <>
            <div className="form-group">
              <label>Token to swap from</label>
            </div>
            <div className="transaction-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {tokens.map((t) => (
                <div
                  key={`${t.symbol}-${t.address}`}
                  className="transaction-item"
                  onClick={() => { setFromToken(t); setStep('destination'); }}
                >
                  <div className="tx-content">
                    <div className="tx-row-primary">
                      <span className="tx-type">{t.symbol}</span>
                      <span className="tx-amount-value">{t.type === 'native' ? 'Native' : ''}</span>
                    </div>
                    <div className="tx-row-secondary">
                      <span className="tx-address">{t.name}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'destination' && (
          <>
            <div className="form-group">
              <label>Destination network</label>
            </div>
            <div className="transaction-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {destinationKeys.map((key) => (
                <div
                  key={key}
                  className="transaction-item"
                  onClick={() => { setToNetworkKey(key); setToToken(null); }}
                >
                  <div className="tx-content">
                    <div className="tx-row-primary">
                      <span className="tx-type">{networkLabel(key)}</span>
                      <span className="tx-amount-value">
                        {key === network ? 'Same network' : 'Cross-chain'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {toNetworkKey && (
              <>
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label>Token to receive on {networkLabel(toNetworkKey)}</label>
                </div>
                {destTokensLoading ? (
                  <div className="loading">Loading tokens...</div>
                ) : (
                  <div className="transaction-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {selectableDestTokens.map((t) => (
                      <div
                        key={`${t.symbol}-${t.address}`}
                        className="transaction-item"
                        onClick={() => { setToToken(t); setStep('amount'); }}
                      >
                        <div className="tx-content">
                          <div className="tx-row-primary">
                            <span className="tx-type">{t.symbol}</span>
                            <span className="tx-amount-value">{t.type === 'native' ? 'Native' : ''}</span>
                          </div>
                          <div className="tx-row-secondary">
                            <span className="tx-address">{t.name}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {selectableDestTokens.length === 0 && (
                      <div className="tx-row-secondary" style={{ padding: 8 }}>
                        <span className="tx-address">No tokens available on this network.</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {step === 'amount' && fromToken && toToken && (
          <>
            <div className="form-group">
              <label>Swapping</label>
              <div className="asset-picker-chip" style={{ cursor: 'default' }}>
                <span className="asset-picker-chip__main">
                  <span className="asset-picker-chip__symbol">
                    {fromToken.symbol} → {toToken.symbol}
                  </span>
                  <span className="asset-picker-chip__network">
                    {networkLabel(network)} → {networkLabel(toNetworkKey)}
                  </span>
                </span>
              </div>
            </div>

            <div className="form-group">
              <label>Amount ({fromToken.symbol})</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`0.0 ${fromToken.symbol}`}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountError(null); }}
              />
              {amountError && <div className="tx-error-inline">{amountError}</div>}
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                const err = validateAmount(amount);
                if (err) { setAmountError(err); return; }
                setQuote(null);
                setStep('confirm');
              }}
            >
              Get quote
            </button>
          </>
        )}

        {step === 'confirm' && fromToken && toToken && (
          <>
            <div className="form-group">
              <label>Confirm swap</label>
              <div className="transaction-item" style={{ cursor: 'default' }}>
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">You pay</span>
                    <span className="tx-amount-value">{amount.trim()} {fromToken.symbol}</span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">on {networkLabel(network)}</span>
                  </div>
                  <div className="tx-row-primary">
                    <span className="tx-type">You receive</span>
                    <span className="tx-amount-value">
                      {quoteLoading ? '…' : quote ? `~${quote.amountOutFormatted} ${quote.toTokenSymbol}` : '—'}
                    </span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">on {networkLabel(toNetworkKey)}</span>
                  </div>
                  {quote && (
                    <>
                      <div className="tx-row-secondary">
                        <span className="tx-address">Minimum received</span>
                        <span className="tx-time">{quote.minAmountOutFormatted} {quote.toTokenSymbol}</span>
                      </div>
                      {quote.rateFormatted && (
                        <div className="tx-row-secondary">
                          <span className="tx-address">Rate</span>
                          <span className="tx-time">{quote.rateFormatted}</span>
                        </div>
                      )}
                      {quote.feeFormatted && (
                        <div className="tx-row-secondary">
                          <span className="tx-address">Network fee</span>
                          <span className="tx-time">{quote.feeFormatted}</span>
                        </div>
                      )}
                      {quote.bridgeFeeFormatted && (
                        <div className="tx-row-secondary">
                          <span className="tx-address">Bridge fee</span>
                          <span className="tx-time">{quote.bridgeFeeFormatted}</span>
                        </div>
                      )}
                      {typeof quote.etaSeconds === 'number' && (
                        <div className="tx-row-secondary">
                          <span className="tx-address">Estimated time</span>
                          <span className="tx-time">~{Math.max(1, Math.round(quote.etaSeconds / 60))} min</span>
                        </div>
                      )}
                      <div className="tx-row-secondary">
                        <span className="tx-address">Via</span>
                        <span className="tx-time">{quote.provider === 'oneinch' ? '1inch' : 'Mayan'}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {quote?.needsApproval && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>Requires a token approval first — 2 transactions will be sent.</span>
              </div>
            )}

            {quoteError && <div className="tx-error-inline" style={{ marginBottom: 8 }}>{quoteError}</div>}
            {submitError && <div className="tx-error-inline" style={{ marginBottom: 8 }}>{submitError}</div>}
            {submitting && phase && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>{PHASE_LABELS[phase] ?? phase}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={submitting} onClick={() => setStep('amount')}>
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={submitting || quoteLoading || !quote}
                onClick={submitSwap}
              >
                {submitting ? 'Swapping…' : 'Confirm & Swap'}
              </button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <>
            <div className="form-group">
              <label>Swap submitted</label>
              <div className="transaction-item" style={{ cursor: 'default' }}>
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">
                      {status?.state === 'completed'
                        ? 'Completed'
                        : status?.state === 'refunded'
                          ? 'Refunded'
                          : status?.state === 'failed'
                            ? 'Failed'
                            : 'In progress'}
                    </span>
                    <span className="tx-amount-value">{amount.trim()} {fromToken?.symbol}</span>
                  </div>
                  {result.approvalTxId && (
                    <div className="tx-row-secondary">
                      <span className="tx-address">
                        Approval {result.approvalTxId.slice(0, 8)}…{result.approvalTxId.slice(-8)}
                      </span>
                    </div>
                  )}
                  <div className="tx-row-secondary">
                    <span className="tx-address">Tx {result.txId.slice(0, 8)}…{result.txId.slice(-8)}</span>
                  </div>
                  {status?.destTxId && status.destTxId !== result.txId && (
                    <div className="tx-row-secondary">
                      <span className="tx-address">
                        Destination {status.destTxId.slice(0, 8)}…{status.destTxId.slice(-8)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {result.provider === 'mayan' && status?.state !== 'completed' && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>Cross-chain swaps settle on the destination chain a few minutes after the source transaction confirms.</span>
              </div>
            )}
            {status?.detail && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>{status.detail}</span>
              </div>
            )}

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => onClose(true)}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SwapFlowView;
