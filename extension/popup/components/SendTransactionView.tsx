/**
 * @fileoverview Send transaction confirmation and status flow.
 *
 * Provides the review/confirm step and tracks pending/confirmed states with
 * explorer link integration.
 *
 * @responsibilities
 * - Render transaction review and confirmation UI
 * - Track pending/confirmed/failed states via background messaging
 *
 * @security
 * - Uses background messaging to broadcast transactions
 * - No secrets handled in UI
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Token } from '../../../src/types/token.js';
import { calculateTransactionCosts, formatUSDValue } from '../../../src/price-service';
import { findTonTransaction } from '../../../src/ton/index.js';
import { Icon, Skeleton } from './ui';

interface SendTransactionViewProps {
  token: Token;
  recipient: string;
  amount: string;
  destinationTag?: number;
  comment?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type TxStatus = 'confirm' | 'sending' | 'pending' | 'confirmed' | 'failed';

interface TxState {
  status: TxStatus;
  hash?: string;
  blockNumber?: number;
  error?: string;
}

interface NetworkConfig {
  network: string;
  blockExplorer: string | null;
  chainId?: number;
  isBitcoin?: boolean;
  bitcoinNetwork?: string;
  isXrp?: boolean;
  isSolana?: boolean;
  isTon?: boolean;
}

interface GasEstimate {
  estimatedCostNative: string;
  nativeSymbol: string;
  gasLimit: string;
}

interface PriceData {
  prices: Record<string, number | null>;
  nativePrice?: number | null;
}

/**
 * Send transaction review and status component.
 *
 * @param props - Component props
 * @returns Send transaction view
 */
export function SendTransactionView({
  token,
  recipient,
  amount,
  destinationTag,
  comment,
  onClose,
  onSuccess
}: SendTransactionViewProps) {
  // Start with confirmation step
  const [txState, setTxState] = useState<TxState>({ status: 'confirm' });
  const [displayMode, setDisplayMode] = useState<'token' | 'usd'>('token');
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig | null>(null);
  const [copied, setCopied] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasEstimateStatus, setGasEstimateStatus] = useState<'loading' | 'done' | 'failed'>('loading');
  const [priceData, setPriceData] = useState<PriceData | null>(null);

  // Fetch network config, gas estimate, and prices
  useEffect(() => {
    setGasEstimateStatus('loading');
    // Fetch network config
    chrome.runtime.sendMessage({ type: 'GET_NETWORK_CONFIG' })
      .then((response) => {
        if (response && !response.error) {
          setNetworkConfig(response);
        }
      })
      .catch(console.error);

    // Fetch gas estimate with timeout
    const gasTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const gasPromise = chrome.runtime.sendMessage({
      type: 'GET_GAS_ESTIMATE',
      payload: { token, toAddress: recipient, amount }
    });
    
    Promise.race([gasPromise, gasTimeout])
      .then((response) => {
        if (response && !response.error) {
          setGasEstimate(response);
          setGasEstimateStatus('done');
        } else {
          setGasEstimateStatus('failed');
        }
      })
      .catch((err) => {
        console.error(err);
        setGasEstimateStatus('failed');
      });

    // Fetch token prices
    chrome.runtime.sendMessage({ type: 'GET_TOKEN_PRICES' })
      .then((response) => {
        if (response && !response.error) {
          setPriceData({
            prices: response.prices || {},
            nativePrice: response.prices?.native || null
          });
        }
      })
      .catch(console.error);
  }, [token, recipient, amount]);

  // Calculate USD values using shared function
  const transactionCosts = useMemo(() => {
    if (!priceData) return null;

    const priceKey = token.type === 'native' ? 'native' : token.address?.toLowerCase();
    const tokenPrice = priceKey ? priceData.prices[priceKey] ?? null : null;
    const nativePrice = priceData.nativePrice ?? null;
    const gasCostNative = gasEstimate?.estimatedCostNative || '0';

    return calculateTransactionCosts(amount, tokenPrice, gasCostNative, nativePrice);
  }, [priceData, token, amount, gasEstimate]);

  const getAmountUsd = (): string | null => {
    if (!transactionCosts?.amountUsd) return null;
    return formatUSDValue(transactionCosts.amountUsd);
  };

  const getGasUsd = (): string | null => {
    if (!transactionCosts?.gasCostUsd) return null;
    return formatUSDValue(transactionCosts.gasCostUsd);
  };

  const getTotalUsd = (): string | null => {
    if (!transactionCosts?.totalUsd) return null;
    return formatUSDValue(transactionCosts.totalUsd);
  };

  // Submit transaction when user confirms
  const handleConfirmSend = useCallback(async () => {
    setTxState({ status: 'sending' });
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEND_TRANSACTION',
        payload: { token, toAddress: recipient, amount, destinationTag, comment }
      });

      if (response.error) {
        setTxState({ status: 'failed', error: response.error });
      } else if (response.result) {
        // EVM: confirmed (waits for mining). Bitcoin: broadcasted (pending).
        const hash = response.result.hash;
        const blockNumber = response.result.blockNumber;
        const isPending = response.result.status === 'pending' || (!blockNumber && (networkConfig?.isBitcoin || networkConfig?.isTon));

        setTxState({
          status: isPending ? 'pending' : 'confirmed',
          hash,
          blockNumber
        });
      }
    } catch (err: any) {
      setTxState({ status: 'failed', error: err.message || 'Transaction failed' });
    }
  }, [token, recipient, amount, networkConfig]);

  useEffect(() => {
    if (!networkConfig?.isTon) return;
    if (txState.status !== 'pending' || txState.hash) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 8;
    const pollDelayMs = 2000;

    const poll = async () => {
      attempts += 1;
      try {
        const addressResponse = await chrome.runtime.sendMessage({ type: 'GET_ADDRESS' });
        const address = addressResponse?.address;
        if (!address) return;

        const historyResponse = await chrome.runtime.sendMessage({
          type: 'GET_EXPLORER_TRANSACTIONS',
          payload: { address, network: networkConfig.network, pageSize: 10 }
        });
        const txs = historyResponse?.transactions || [];

        const match = findTonTransaction(txs, {
          fromAddress: address,
          toAddress: recipient,
          amountTon: amount,
          type: 'send'
        });

        if (match?.hash && !cancelled) {
          setTxState((prev) => ({ ...prev, hash: match.hash }));
          return;
        }
      } catch (error) {
        console.warn('[TON] Failed to refresh transaction hash:', error);
      }

      if (!cancelled && attempts < maxAttempts) {
        setTimeout(poll, pollDelayMs);
      }
    };

    const timer = setTimeout(poll, pollDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [txState.status, txState.hash, networkConfig, recipient, amount]);

  const copyHash = useCallback(() => {
    if (txState.hash) {
      navigator.clipboard.writeText(txState.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [txState.hash]);

  const openExplorer = useCallback(() => {
    if (txState.hash && networkConfig?.blockExplorer) {
      const url = `${networkConfig.blockExplorer}/tx/${txState.hash}`;
      window.open(url, '_blank');
    }
  }, [txState.hash, networkConfig]);

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 8)}...${addr.substring(addr.length - 6)}`;
  };

  const formatHash = (hash: string) => {
    return `${hash.substring(0, 10)}...${hash.substring(hash.length - 8)}`;
  };

  const handleClose = () => {
    if (txState.status === 'confirmed' || txState.status === 'pending') {
      onSuccess();
    }
    onClose();
  };

  return (
    <div className="send-transaction-view">
      {/* Confirmation step - review before sending */}
      {txState.status === 'confirm' && (
        <>
          <div className="tx-confirm-header">
            <div className="tx-confirm-icon" style={{ 
              width: '48px', 
              height: '48px', 
              margin: '0 auto 12px', 
              color: 'var(--primary)',
              background: 'var(--primary-50)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
            <h3>Confirm Transaction</h3>
            <p>Please review the details before sending</p>
          </div>

          <div className="tx-details-card">
            <div className="tx-amount-toggle">
              <button
                type="button"
                className={`tx-toggle-btn ${displayMode === 'token' ? 'active' : ''}`}
                onClick={() => setDisplayMode('token')}
              >
                {token.symbol}
              </button>
              <button
                type="button"
                className={`tx-toggle-btn ${displayMode === 'usd' ? 'active' : ''}`}
                onClick={() => setDisplayMode('usd')}
                disabled={!getAmountUsd()}
              >
                USD
              </button>
            </div>
            <div className="tx-detail-rows">
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <div className="tx-detail-value-group">
                  {displayMode === 'token' ? (
                    <>
                      <span className="tx-detail-value tx-amount-highlight">{amount} {token.symbol}</span>
                      {getAmountUsd() && <span className="tx-detail-usd">{getAmountUsd()}</span>}
                    </>
                  ) : (
                    <>
                      <span className="tx-detail-value tx-amount-highlight">{getAmountUsd() || '--'}</span>
                      <span className="tx-detail-usd">{amount} {token.symbol}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">To</span>
                <span className="tx-detail-value">{formatAddress(recipient)}</span>
              </div>

              {typeof destinationTag === 'number' && networkConfig?.isXrp && (
                <div className="tx-detail-row">
                  <span className="tx-detail-label">Destination Tag</span>
                  <span className="tx-detail-value">{destinationTag.toString()}</span>
                </div>
              )}

              {comment && networkConfig?.isTon && (
                <div className="tx-detail-row">
                  <span className="tx-detail-label">Comment</span>
                  <span className="tx-detail-value">{comment}</span>
                </div>
              )}

              <div className="tx-detail-row">
                <span className="tx-detail-label">Network</span>
                <span className="tx-detail-value">{networkConfig?.network || 'Loading...'}</span>
              </div>

              <div className="tx-detail-divider" />

              <div className="tx-detail-row">
                <span className="tx-detail-label">Estimated Network Fee</span>
                <div className="tx-detail-value-group">
                  {gasEstimateStatus === 'loading' ? (
                    <Skeleton width={110} height={14} borderRadius={7} />
                  ) : gasEstimateStatus === 'failed' || !gasEstimate ? (
                    <span
                      className="tx-detail-value"
                      style={{ color: 'var(--warning-dark)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      title="We couldn't estimate the network fee. Continue at your own risk or retry."
                    >
                      <Icon name="alert-triangle" size={12} decorative />
                      Estimate unavailable
                    </span>
                  ) : displayMode === 'token' ? (
                    <>
                      <span className="tx-detail-value">
                        {parseFloat(gasEstimate.estimatedCostNative).toFixed(
                          networkConfig?.isBitcoin
                            ? 8
                            : (networkConfig?.isTon || networkConfig?.isSolana ? 9 : 6)
                        )} {gasEstimate.nativeSymbol}
                      </span>
                      {getGasUsd() && <span className="tx-detail-usd">{getGasUsd()}</span>}
                    </>
                  ) : (
                    <>
                      <span className="tx-detail-value">{getGasUsd() || '--'}</span>
                      <span className="tx-detail-usd">
                        {parseFloat(gasEstimate.estimatedCostNative).toFixed(
                          networkConfig?.isBitcoin
                            ? 8
                            : (networkConfig?.isTon || networkConfig?.isSolana ? 9 : 6)
                        )} {gasEstimate.nativeSymbol}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {getTotalUsd() && (
                <>
                  <div className="tx-detail-divider" />
                  <div className="tx-detail-row tx-total-row">
                    <span className="tx-detail-label">Total Cost</span>
                    <span className="tx-detail-value tx-total-value">{getTotalUsd()}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="tx-actions">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirmSend}>
              Confirm & Send
            </button>
          </div>
        </>
      )}

      {/* Progress indicator - shows spinner while sending */}
      {txState.status === 'sending' && (
        <>
          <div className="tx-progress-steps">
            <div className="tx-step active">
              <div className="tx-step-indicator">
                <div className="tx-spinner" />
              </div>
              <span className="tx-step-label">Sending Transaction...</span>
            </div>
          </div>

          <div className="tx-details-card">
            <div className="tx-detail-rows">
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <span className="tx-detail-value">{amount} {token.symbol}</span>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">To</span>
                <span className="tx-detail-value">{formatAddress(recipient)}</span>
              </div>

              <p className="tx-sending-note">
                {networkConfig?.isBitcoin
                  ? 'Broadcasting transaction to the Bitcoin network...'
                  : 'Please wait while the transaction is being confirmed on the blockchain...'}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Bitcoin pending state */}
      {txState.status === 'pending' && (
        <>
          <div className="tx-details-card success">
            <div className="tx-success-header">
              <div className="tx-success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12h8" />
                </svg>
              </div>
              <h3>Transaction Broadcasted</h3>
              <p className="tx-error-message">Pending confirmation</p>
            </div>

            <div className="tx-detail-rows">
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <span className="tx-detail-value">{amount} {token.symbol}</span>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">To</span>
                <span className="tx-detail-value">{formatAddress(recipient)}</span>
              </div>

              {txState.hash && (
                <div className="tx-detail-row">
                  <span className="tx-detail-label">Hash</span>
                  <div className="tx-detail-value tx-hash-value">
                    <span>{formatHash(txState.hash)}</span>
                    <button className="tx-copy-btn" onClick={copyHash} title="Copy hash">
                      {copied ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      )}
                    </button>
                    {networkConfig?.blockExplorer && (
                      <button className="tx-explorer-btn" onClick={openExplorer} title="View on explorer">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="tx-actions">
            {networkConfig?.blockExplorer && txState.hash && (
              <button className="btn btn-secondary" onClick={openExplorer}>
                View on Explorer
              </button>
            )}
            <button className="btn btn-primary" onClick={handleClose}>
              Close
            </button>
          </div>
        </>
      )}

      {/* Success state */}
      {txState.status === 'confirmed' && (
        <>
          <div className="tx-details-card success">
            <div className="tx-success-header">
              <div className="tx-success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="16 10 10.5 15.5 8 13" />
                </svg>
              </div>
              <h3>Transaction Confirmed!</h3>
            </div>

            <div className="tx-detail-rows">
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <span className="tx-detail-value">{amount} {token.symbol}</span>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">To</span>
                <span className="tx-detail-value">{formatAddress(recipient)}</span>
              </div>

              {txState.hash && (
                <div className="tx-detail-row">
                  <span className="tx-detail-label">Hash</span>
                  <div className="tx-detail-value tx-hash-value">
                    <span>{formatHash(txState.hash)}</span>
                    <button className="tx-copy-btn" onClick={copyHash} title="Copy hash">
                      {copied ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      )}
                    </button>
                    {networkConfig?.blockExplorer && (
                      <button className="tx-explorer-btn" onClick={openExplorer} title="View on explorer">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {txState.blockNumber && (
                <div className="tx-detail-row">
                  <span className="tx-detail-label">Block</span>
                  <span className="tx-detail-value">#{txState.blockNumber.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <div className="tx-actions">
            {networkConfig?.blockExplorer && txState.hash && (
              <button className="btn btn-secondary" onClick={openExplorer}>
                View on Explorer
              </button>
            )}
            <button className="btn btn-primary" onClick={handleClose}>
              Close
            </button>
          </div>
        </>
      )}

      {/* Error state */}
      {txState.status === 'failed' && (
        <>
          <div className="tx-details-card error">
            <div className="tx-error-header">
              <div className="tx-error-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <h3>Transaction Failed</h3>
              {txState.error && <p className="tx-error-message">{txState.error}</p>}
            </div>
          </div>

          <div className="tx-actions">
            <button className="btn btn-primary" onClick={handleClose}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default SendTransactionView;
