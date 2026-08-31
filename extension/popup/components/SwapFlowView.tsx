/**
 * @fileoverview Single-canvas swap experience for the extension popup and
 * sidepanel.
 *
 * Token and network choices, settings, and review happen in bottom sheets so
 * the amount and live quote remain the stable center of the flow. Routing,
 * quoting, approval, signing, and status still cross the chain-neutral
 * service-worker message boundary.
 *
 * @responsibilities
 * - Fetch swap capabilities, destination tokens, and debounced live quotes
 * - Surface quote expiry, slippage, approval phases, and terminal status
 * - Keep same-chain and cross-chain routing visible on one canvas
 *
 * @security
 * - No secrets are handled by this UI; signing stays in the service worker.
 * - Expired quotes cannot be submitted and must be explicitly refreshed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import {
  AmountCard,
  AssetMark,
  AssetPill,
  FlowButton,
  FlowCallout,
  FlowDetailRow,
  FlowDetails,
  FlowHeader,
  FlowSheet,
} from './SwapStakeUI';
import { Icon } from './ui';
import NetworkSelector from './ui/NetworkSelector';
import { quoteSecondsRemaining, validateSwapAmount } from '../utils/swapStake.js';
import solIcon from '../../assets/img/solana-logo.svg';
import ethIcon from '../../assets/img/eth_logo.svg';
import usdcIcon from '../../assets/img/icon-usdc.png';
import usdtIcon from '../../assets/img/usdt.svg';
import bnbIcon from '../../assets/img/bnb.svg';
import polIcon from '../../assets/img/pol-token.svg';
import baseIcon from '../../assets/img/base.svg';
import arbitrumIcon from '../../assets/img/arbitrum.svg';
import optimismIcon from '../../assets/img/optimism-logo.svg';
import avalancheIcon from '../../assets/img/avax-token.svg';
import lineaIcon from '../../assets/img/linea-logo-mainnet.svg';
import rayIcon from '../../assets/img/raydium-ray-logo.svg';

interface TokenData {
  symbol: string;
  name: string;
  type?: string;
  address: string;
  decimals: number;
  balance?: string;
  price?: number | null;
  value?: number;
  logoURI?: string;
  icon?: string;
}

interface SwapCapabilitiesData {
  canSwap: boolean;
  sameChain: boolean;
  crossChain: boolean;
  destinationNetworkKeys: string[];
  unsupportedReason?: string;
}

interface SwapQuoteData {
  provider: 'oneinch' | 'jupiter' | 'mayan';
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
  request: { slippagePercent?: number } & Record<string, unknown>;
}

interface SwapResultData {
  provider: 'oneinch' | 'jupiter' | 'mayan';
  txId: string;
  approvalTxId?: string;
  fromNetworkKey: string;
  toNetworkKey: string;
}

interface Props {
  network: string;
  networks: Record<string, any>;
  /** Tokens on the active source network, optionally enriched with balances and USD prices. */
  tokens: TokenData[];
  /** Called on exit; didSwap=true once a swap transaction was submitted. */
  onClose: (didSwap: boolean) => void;
}

type SheetName = 'source' | 'destination' | 'settings' | 'review' | null;
type SwapStatus = { state: 'pending' | 'completed' | 'refunded' | 'failed'; destTxId?: string; detail?: string };

const SYMBOL_ICONS: Record<string, string> = {
  SOL: solIcon,
  ETH: ethIcon,
  WETH: ethIcon,
  USDC: usdcIcon,
  USDT: usdtIcon,
  BNB: bnbIcon,
  POL: polIcon,
  MATIC: polIcon,
  RAY: rayIcon,
};

const BUNDLED_ICON_FILES: Record<string, string> = {
  'solana-logo.svg': solIcon,
  'eth_logo.svg': ethIcon,
  'icon-usdc.png': usdcIcon,
  'usdt.svg': usdtIcon,
  'bnb.svg': bnbIcon,
  'pol-token.svg': polIcon,
  'base.svg': baseIcon,
  'arbitrum.svg': arbitrumIcon,
  'optimism-logo.svg': optimismIcon,
  'avax-token.svg': avalancheIcon,
  'linea-logo-mainnet.svg': lineaIcon,
  'raydium-ray-logo.svg': rayIcon,
};

const NETWORK_ICONS: Record<string, string> = {
  'solana-mainnet': solIcon,
  'solana-devnet': solIcon,
  mainnet: ethIcon,
  sepolia: ethIcon,
  base: baseIcon,
  arbitrum: arbitrumIcon,
  optimism: optimismIcon,
  polygon: polIcon,
  bsc: bnbIcon,
  avalanche: avalancheIcon,
  linea: lineaIcon,
};

const PHASE_LABELS: Record<string, string> = {
  'checking-allowance': 'Checking allowance',
  approving: 'Approve token',
  'approval-confirmed': 'Approval confirmed',
  'submitting-swap': 'Submitting swap',
  'swap-submitted': 'Swap submitted',
};

const PHASE_ORDER = ['checking-allowance', 'approving', 'approval-confirmed', 'submitting-swap', 'swap-submitted'];

function tokenKey(token: TokenData): string {
  return `${token.symbol}-${token.address}`;
}

function tokenIcon(token: TokenData | null): string | null {
  if (!token) return null;
  const bundledReference = token.icon || token.logoURI || '';
  if (BUNDLED_ICON_FILES[bundledReference]) {
    return BUNDLED_ICON_FILES[bundledReference];
  }
  if (token.logoURI && /^(https?:|data:|blob:|chrome-extension:|\/)/i.test(token.logoURI)) {
    return token.logoURI;
  }
  return SYMBOL_ICONS[token.symbol.toUpperCase()] || null;
}

function displayBalance(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatUsd(amount: string, price?: number | null): string | undefined {
  const value = Number(amount) * Number(price);
  if (!Number.isFinite(value) || price === null || price === undefined) return undefined;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncateId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 7)}…${value.slice(-7)}`;
}

function swapProviderLabel(provider: SwapQuoteData['provider']): string {
  if (provider === 'oneinch') return '1inch';
  if (provider === 'jupiter') return 'Jupiter';
  return 'Mayan';
}

function PhaseTracker({ phase }: { phase: string | null }) {
  const current = phase ? PHASE_ORDER.indexOf(phase) : -1;
  const steps = [
    { key: 'checking-allowance', label: 'Allowance' },
    { key: 'approving', label: 'Approve' },
    { key: 'submitting-swap', label: 'Swap' },
  ];
  return (
    <div className="swap-phase-tracker" aria-label="Swap progress">
      {steps.map((step, index) => {
        const stepIndex = PHASE_ORDER.indexOf(step.key);
        const done = current > stepIndex || (step.key === 'approving' && current >= PHASE_ORDER.indexOf('approval-confirmed'));
        const active = phase === step.key;
        return (
          <React.Fragment key={step.key}>
            <div className={`swap-phase-tracker__step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
              <span>{done ? <Icon name="check" size={11} decorative /> : active ? <Icon name="loader" size={11} decorative /> : index + 1}</span>
              <strong>{step.label}</strong>
            </div>
            {index < steps.length - 1 && <i className={done ? 'is-done' : ''} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TokenRows({
  tokens,
  loading,
  query,
  onQuery,
  onPick,
}: {
  tokens: TokenData[];
  loading?: boolean;
  query: string;
  onQuery: (query: string) => void;
  onPick: (token: TokenData) => void;
}) {
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tokens;
    return tokens.filter((token) => token.symbol.toLowerCase().includes(normalized) || token.name.toLowerCase().includes(normalized));
  }, [query, tokens]);

  return (
    <>
      <label className="swap-stake-search">
        <Icon name="search" size={16} decorative />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search name or symbol" />
      </label>
      <div className="swap-stake-picker-list">
        {loading ? (
          <div className="swap-stake-picker-empty">Loading tokens…</div>
        ) : filtered.length ? filtered.map((token) => (
          <button type="button" className="swap-stake-picker-row" key={tokenKey(token)} onClick={() => onPick(token)}>
            <AssetMark label={token.symbol} src={tokenIcon(token)} />
            <span className="swap-stake-picker-row__main">
              <strong>{token.symbol}{token.type === 'native' && <em>Native</em>}</strong>
              <small>{token.name}</small>
            </span>
            {token.balance !== undefined && (
              <span className="swap-stake-picker-row__value">
                <strong>{displayBalance(token.balance)}</strong>
                <small>{formatUsd(token.balance, token.price) ?? ''}</small>
              </span>
            )}
          </button>
        )) : (
          <div className="swap-stake-picker-empty">No tokens match “{query}”.</div>
        )}
      </div>
    </>
  );
}

function SwapResult({
  result,
  status,
  quote,
  fromToken,
  toToken,
  networks,
  onDone,
}: {
  result: SwapResultData;
  status: SwapStatus | null;
  quote: SwapQuoteData;
  fromToken: TokenData;
  toToken: TokenData;
  networks: Record<string, any>;
  onDone: () => void;
}) {
  const state = status?.state ?? 'pending';
  const destinationName = networks[result.toNetworkKey]?.name || result.toNetworkKey;
  const isCrossChain = result.fromNetworkKey !== result.toNetworkKey;
  const meta = {
    pending: {
      title: 'Swap in progress',
      tone: 'warning' as const,
      note: isCrossChain
        ? `Settling on ${destinationName}. Cross-chain delivery may take a few minutes.`
        : `Waiting for confirmation on ${destinationName}.`,
    },
    completed: { title: 'Swap complete', tone: 'success' as const, note: `${toToken.symbol} has arrived on ${destinationName}.` },
    refunded: { title: 'Swap refunded', tone: 'warning' as const, note: `${fromToken.symbol} was returned on the source chain because the route could not complete.` },
    failed: { title: 'Swap failed', tone: 'danger' as const, note: 'The source transaction failed. Only a network fee may have been charged.' },
  }[state];
  const explorerBase = networks[result.fromNetworkKey]?.blockExplorer;
  const explorerUrl = explorerBase ? `${explorerBase.replace(/\/$/, '')}/tx/${result.txId}` : null;

  return (
    <div className="swap-stake-screen">
      <FlowHeader title="Swap" onBack={onDone} />
      <main className="swap-stake-result">
        <div className={`swap-stake-result__icon is-${meta.tone}`}>
          <Icon name={state === 'completed' ? 'check' : state === 'failed' ? 'alert-triangle' : state === 'refunded' ? 'refresh' : 'loader'} size={27} decorative />
        </div>
        <h2>{meta.title}</h2>
        <p>{status?.detail || meta.note}</p>
        <FlowDetails>
          <FlowDetailRow label="Paid" value={`${quote.amountInFormatted} ${fromToken.symbol}`} strike={state === 'refunded'} />
          <FlowDetailRow label="Received" value={state === 'completed' ? `${quote.amountOutFormatted} ${toToken.symbol}` : '—'} accent={state === 'completed' ? 'success' : 'muted'} />
          <FlowDetailRow label="Route" value={swapProviderLabel(quote.provider)} />
          {result.approvalTxId && <FlowDetailRow label="Approval tx" value={truncateId(result.approvalTxId)} />}
          <FlowDetailRow label="Transaction" value={truncateId(result.txId)} />
          {status?.destTxId && status.destTxId !== result.txId && <FlowDetailRow label="Destination tx" value={truncateId(status.destTxId)} />}
        </FlowDetails>
      </main>
      <footer className={`swap-stake-footer ${explorerUrl ? 'swap-stake-footer--split' : ''}`.trim()}>
        {explorerUrl && <FlowButton variant="secondary" onClick={() => window.open(explorerUrl, '_blank')}>Explorer</FlowButton>}
        <FlowButton onClick={onDone}>Done</FlowButton>
      </footer>
    </div>
  );
}

/**
 * Render the live, single-canvas swap flow.
 *
 * @param props - Active network, network config, source assets, and exit callback.
 * @returns Swap canvas with picker, review, settings, and result sheets.
 */
function SwapFlowView({ network, networks, tokens, onClose }: Props) {
  const [capabilities, setCapabilities] = useState<SwapCapabilitiesData | null>(null);
  const [fromToken, setFromToken] = useState<TokenData | null>(tokens[0] ?? null);
  const [toNetworkKey, setToNetworkKey] = useState(network);
  const [destTokens, setDestTokens] = useState<TokenData[]>([]);
  const [destTokensLoading, setDestTokensLoading] = useState(false);
  const [toToken, setToToken] = useState<TokenData | null>(null);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(1);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [sourceQuery, setSourceQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [quote, setQuote] = useState<SwapQuoteData | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResultData | null>(null);
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const quoteRequestId = useRef(0);

  const networkLabel = useCallback((key: string) => networks[key]?.name || key, [networks]);
  const sourceBalance = fromToken?.balance;
  const amountError = amount ? validateSwapAmount(amount, sourceBalance) : null;
  const destinationKeys = capabilities?.destinationNetworkKeys ?? [];
  const destinationNetworkOptions = useMemo(() => destinationKeys.map((key) => ({
    value: key,
    label: networkLabel(key),
    icon: NETWORK_ICONS[key],
  })), [destinationKeys, networkLabel]);
  const crossChain = toNetworkKey !== network;
  const secondsLeft = quote ? quoteSecondsRemaining(quote.expiresAt, now) : 0;
  const quoteExpired = !!quote && secondsLeft === 0;

  useEffect(() => {
    if (!fromToken && tokens.length) setFromToken(tokens[0]);
  }, [fromToken, tokens]);

  useEffect(() => {
    let cancelled = false;
    sendMessageWithRetry<{ capabilities?: SwapCapabilitiesData }>({
      type: 'GET_SWAP_CAPABILITIES',
      payload: { networkKey: network },
    }).then((response) => {
      if (cancelled) return;
      const next = response?.capabilities ?? null;
      setCapabilities(next);
      if (next?.destinationNetworkKeys.length) {
        setToNetworkKey((current) => next.destinationNetworkKeys.includes(current)
          ? current
          : next.destinationNetworkKeys[0]);
      }
    }).catch(() => { if (!cancelled) setCapabilities(null); });
    return () => { cancelled = true; };
  }, [network]);

  useEffect(() => {
    if (!toNetworkKey) return;
    let cancelled = false;
    setDestTokensLoading(true);
    sendMessageWithRetry<{ tokens?: TokenData[] }>({
      type: 'GET_SWAP_DEST_TOKENS',
      payload: { networkKey: toNetworkKey },
    }).then((response) => {
      if (cancelled) return;
      const nextTokens = response?.tokens ?? [];
      setDestTokens(nextTokens);
      setToToken((current) => {
        const currentStillExists = current && nextTokens.some((token) => tokenKey(token) === tokenKey(current));
        if (currentStillExists) return current;
        return nextTokens.find((token) => !(toNetworkKey === network && token.symbol === fromToken?.symbol)) ?? null;
      });
    }).catch(() => {
      if (!cancelled) {
        setDestTokens([]);
        setToToken(null);
      }
    }).finally(() => { if (!cancelled) setDestTokensLoading(false); });
    return () => { cancelled = true; };
  }, [fromToken?.symbol, network, toNetworkKey]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'SWAP_PROGRESS') setPhase(message.payload?.phase ?? null);
      if (message?.type === 'SWAP_STATUS') setStatus(message.payload ?? null);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!quote) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [quote]);

  const fetchQuote = useCallback(async () => {
    if (!fromToken || !toToken || !toNetworkKey || !amount || validateSwapAmount(amount, fromToken.balance)) return;
    const requestId = ++quoteRequestId.current;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const response = await sendMessageWithRetry<{ quote?: SwapQuoteData; error?: string }>({
        type: 'GET_SWAP_QUOTE',
        payload: {
          request: {
            fromNetworkKey: network,
            fromToken,
            toNetworkKey,
            toToken,
            amount: amount.trim(),
            slippagePercent: slippage,
          },
        },
      });
      if (requestId !== quoteRequestId.current) return;
      if (response?.error) throw new Error(response.error);
      if (!response?.quote) throw new Error('No quote returned');
      setQuote(response.quote);
      setNow(Date.now());
    } catch (error: any) {
      if (requestId === quoteRequestId.current) setQuoteError(error?.message || 'Could not fetch a quote');
    } finally {
      if (requestId === quoteRequestId.current) setQuoteLoading(false);
    }
  }, [amount, fromToken, network, slippage, toNetworkKey, toToken]);

  useEffect(() => {
    if (!amount || amountError || !fromToken || !toToken) {
      quoteRequestId.current += 1;
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    const timer = window.setTimeout(fetchQuote, 500);
    return () => window.clearTimeout(timer);
  }, [amount, amountError, fetchQuote, fromToken, toToken]);

  const selectableDestTokens = useMemo(
    () => destTokens.filter((token) => !(toNetworkKey === network && token.symbol === fromToken?.symbol)),
    [destTokens, fromToken?.symbol, network, toNetworkKey]
  );

  const chooseDestinationNetwork = (key: string) => {
    setToNetworkKey(key);
    setToToken(null);
    setDestinationQuery('');
    setQuote(null);
  };

  const flipTokens = () => {
    if (crossChain || !fromToken || !toToken) return;
    const nextSource = tokens.find((token) => tokenKey(token) === tokenKey(toToken)) ?? toToken;
    const nextDestination = destTokens.find((token) => tokenKey(token) === tokenKey(fromToken)) ?? fromToken;
    setFromToken(nextSource);
    setToToken(nextDestination);
  };

  const pickPercent = (percent: number) => {
    const balance = Number(fromToken?.balance);
    if (!Number.isFinite(balance)) return;
    setAmount(String(+(balance * percent / 100).toFixed(Math.min(fromToken?.decimals ?? 6, 6))));
  };

  const submitSwap = async () => {
    if (!quote || quoteExpired) return;
    setSubmitting(true);
    setSubmitError(null);
    setPhase(null);
    try {
      const response = await sendMessageWithRetry<{ result?: SwapResultData; error?: string }>({
        type: 'EXECUTE_SWAP',
        payload: { quote },
      });
      if (response?.error) throw new Error(response.error);
      if (!response?.result?.txId) throw new Error('No transaction id returned');
      setResult(response.result);
      setStatus({ state: 'pending' });
      setSheet(null);
    } catch (error: any) {
      setSubmitError(error?.message || 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (result && quote && fromToken && toToken) {
    return (
      <SwapResult result={result} status={status} quote={quote} fromToken={fromToken} toToken={toToken} networks={networks} onDone={() => onClose(true)} />
    );
  }

  const quoteSecondary = quoteLoading ? 'Updating quote…' : quote ? formatUsd(quote.amountOutFormatted, toToken?.price) : undefined;

  return (
    <div className="swap-stake-screen">
      <FlowHeader
        title="Swap"
        onBack={() => onClose(false)}
        right={(
          <button className="swap-stake-icon-button is-raised" type="button" onClick={() => setSheet('settings')} aria-label="Swap settings">
            <Icon name="settings" size={16} decorative />
          </button>
        )}
      />
      <main className="swap-stake-scroll">
        {capabilities?.unsupportedReason && (
          <FlowCallout tone="info" title={capabilities.canSwap ? 'Some routes unavailable' : 'Swaps unavailable'}>
            {capabilities.unsupportedReason}
          </FlowCallout>
        )}
        <div className="swap-canvas">
          <AmountCard
            label="You pay"
            value={amount}
            onChange={setAmount}
            asset={<AssetPill symbol={fromToken?.symbol || '—'} src={tokenIcon(fromToken)} onClick={() => { setSourceQuery(''); setSheet('source'); }} />}
            balance={displayBalance(fromToken?.balance)}
            onMax={fromToken?.balance !== undefined ? () => setAmount(fromToken.balance || '') : undefined}
            onPercent={fromToken?.balance !== undefined ? pickPercent : undefined}
            secondary={formatUsd(amount, fromToken?.price)}
            error={amountError}
          />
          <div className="swap-canvas__flip">
            <button type="button" onClick={flipTokens} disabled={crossChain || !toToken} title={crossChain ? 'Cross-chain swaps are one-directional' : 'Flip assets'}>
              <Icon name="arrow-down-left" size={16} decorative />
            </button>
          </div>
          <AmountCard
            label="You receive"
            value={quote?.amountOutFormatted || ''}
            readOnly
            asset={<AssetPill symbol={toToken?.symbol || '—'} src={tokenIcon(toToken)} networkLabel={crossChain ? networkLabel(toNetworkKey) : undefined} onClick={() => { setDestinationQuery(''); setSheet('destination'); }} />}
            secondary={quoteSecondary}
          />
        </div>
        <button className="swap-destination-card" type="button" onClick={() => setSheet('destination')}>
          <AssetMark label={networkLabel(toNetworkKey)} src={NETWORK_ICONS[toNetworkKey]} size="small" />
          <span><small>Receive on</small><strong>{networkLabel(toNetworkKey)}</strong></span>
          <em className={crossChain ? 'is-cross-chain' : 'is-same-chain'}>{crossChain ? 'Cross-chain' : 'Same network'}</em>
          <Icon name="chevron-right" size={15} decorative />
        </button>
        {quote && (
          <FlowDetails>
            <FlowDetailRow label="Rate" value={quote.rateFormatted} />
            <FlowDetailRow label="Minimum received" hint="Guaranteed after max slippage" value={`${quote.minAmountOutFormatted} ${quote.toTokenSymbol}`} />
            {quote.feeFormatted && <FlowDetailRow label="Network fee" value={quote.feeFormatted} />}
            {quote.bridgeFeeFormatted && <FlowDetailRow label="Bridge fee" hint="Mayan relayer fee" value={quote.bridgeFeeFormatted} />}
            {typeof quote.etaSeconds === 'number' && <FlowDetailRow label="Estimated time" value={`~${Math.max(1, Math.round(quote.etaSeconds / 60))} min`} />}
            <FlowDetailRow label="Route" value={swapProviderLabel(quote.provider)} accent="muted" />
            <FlowDetailRow label="Quote expires" value={quoteExpired ? 'Expired' : `${secondsLeft}s`} accent={quoteExpired || secondsLeft <= 10 ? 'warning' : undefined} />
          </FlowDetails>
        )}
        {quote?.needsApproval && <FlowCallout title="Two transactions required">{quote.fromTokenSymbol} needs a one-time spend approval before the swap.</FlowCallout>}
        {quoteExpired && <FlowCallout tone="warning" title="Quote expired" icon="refresh">Refresh to get current pricing before you swap.</FlowCallout>}
        {quoteError && <FlowCallout tone="danger" title="Quote unavailable">{quoteError}</FlowCallout>}
      </main>
      <footer className="swap-stake-footer">
        {quoteExpired ? (
          <FlowButton variant="secondary" onClick={fetchQuote} loading={quoteLoading}><Icon name="refresh" size={15} decorative /> Refresh quote</FlowButton>
        ) : (
          <FlowButton disabled={!quote || quoteLoading || !!amountError || !capabilities?.canSwap} onClick={() => setSheet('review')} loading={quoteLoading}>
            {quoteLoading ? 'Updating quote…' : quote ? 'Review swap' : amount ? 'Get quote' : 'Enter an amount'}
          </FlowButton>
        )}
      </footer>
      <FlowSheet open={sheet === 'source'} onClose={() => setSheet(null)} title="Swap from">
        <TokenRows tokens={tokens.filter((token) => !(toNetworkKey === network && token.symbol === toToken?.symbol))} query={sourceQuery} onQuery={setSourceQuery} onPick={(token) => { setFromToken(token); setSheet(null); }} />
      </FlowSheet>
      <FlowSheet open={sheet === 'destination'} onClose={() => setSheet(null)} title="Receive" subtitle="Choose a network and token">
        <div className="swap-network-field">
          <span>Destination network</span>
          <NetworkSelector
            value={toNetworkKey}
            options={destinationNetworkOptions}
            onChange={chooseDestinationNetwork}
          />
        </div>
        <TokenRows tokens={selectableDestTokens} loading={destTokensLoading} query={destinationQuery} onQuery={setDestinationQuery} onPick={(token) => { setToToken(token); setSheet(null); }} />
      </FlowSheet>
      <FlowSheet open={sheet === 'settings'} onClose={() => setSheet(null)} title="Swap settings" size="small" footer={<FlowButton onClick={() => setSheet(null)}>Done</FlowButton>}>
        <div className="swap-settings">
          <label>Max slippage</label>
          <div>{[0.1, 0.5, 1, 3].map((value) => <button type="button" className={slippage === value ? 'is-active' : ''} key={value} onClick={() => setSlippage(value)}>{value}%</button>)}</div>
          <FlowCallout tone={slippage >= 3 ? 'warning' : 'info'}>{slippage >= 3 ? 'High slippage can return meaningfully less than quoted in volatile markets.' : 'The swap reverts if the price moves more than this before execution.'}</FlowCallout>
        </div>
      </FlowSheet>
      <FlowSheet
        open={sheet === 'review'}
        onClose={() => { if (!submitting) setSheet(null); }}
        title="Review swap"
        footer={submitting ? <FlowButton loading>{PHASE_LABELS[phase || ''] || 'Submitting swap'}…</FlowButton> : (
          <div className="swap-stake-sheet-actions"><FlowButton variant="secondary" onClick={() => setSheet(null)}>Cancel</FlowButton><FlowButton onClick={submitSwap}>{quote?.needsApproval ? 'Approve & swap' : 'Confirm swap'}</FlowButton></div>
        )}
      >
        {quote && fromToken && toToken && (
          <div className="swap-review">
            <div className="swap-review__assets">
              <div><span><AssetMark label={fromToken.symbol} src={tokenIcon(fromToken)} size="small" /> {networkLabel(network)}</span><strong>{quote.amountInFormatted}</strong><small>{fromToken.symbol}</small></div>
              <Icon name="arrow-up-right" size={16} decorative />
              <div><span>{networkLabel(toNetworkKey)} <AssetMark label={toToken.symbol} src={tokenIcon(toToken)} size="small" /></span><strong>{quote.amountOutFormatted}</strong><small>{toToken.symbol}</small></div>
            </div>
            {quote.needsApproval && <PhaseTracker phase={phase} />}
            <FlowDetails>
              <FlowDetailRow label="Rate" value={quote.rateFormatted} />
              <FlowDetailRow label="Minimum received" value={`${quote.minAmountOutFormatted} ${quote.toTokenSymbol}`} />
              <FlowDetailRow label="Max slippage" value={`${quote.request.slippagePercent ?? slippage}%`} />
              {quote.feeFormatted && <FlowDetailRow label="Network fee" value={quote.feeFormatted} />}
              {quote.bridgeFeeFormatted && <FlowDetailRow label="Bridge fee" value={quote.bridgeFeeFormatted} />}
              <FlowDetailRow label="Route" value={swapProviderLabel(quote.provider)} />
            </FlowDetails>
            {crossChain && <FlowCallout>Cross-chain swaps settle on {networkLabel(toNetworkKey)} after the source transaction confirms.</FlowCallout>}
            {submitError && <FlowCallout tone="danger" title="Swap failed">{submitError}</FlowCallout>}
          </div>
        )}
      </FlowSheet>
    </div>
  );
}

export default SwapFlowView;
