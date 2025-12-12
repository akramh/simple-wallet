/**
 * SendTransactionView Component
 * 
 * Enhanced send transaction experience with:
 * - Confirmation step before sending
 * - Transaction progress indicator
 * - Confirmation tracking with block number
 * - Explorer link integration
 * - Hash display on confirmation
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Token } from '../../../src/types';
import { calculateTransactionCosts, formatUSDValue } from '../../../src/price-service';

interface SendTransactionViewProps {
  token: Token;
  recipient: string;
  amount: string;
  onClose: () => void;
  onSuccess: () => void;
}

type TxStatus = 'confirm' | 'sending' | 'confirmed' | 'failed';

interface TxState {
  status: TxStatus;
  hash?: string;
  blockNumber?: number;
  error?: string;
}

interface NetworkConfig {
  network: string;
  blockExplorer: string | null;
  chainId: number;
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

export function SendTransactionView({
  token,
  recipient,
  amount,
  onClose,
  onSuccess
}: SendTransactionViewProps) {
  // Start with confirmation step
  const [txState, setTxState] = useState<TxState>({ status: 'confirm' });
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
        payload: { token, toAddress: recipient, amount }
      });

      if (response.error) {
        setTxState({ status: 'failed', error: response.error });
      } else if (response.result) {
        // Transaction confirmed - we have hash and blockNumber
        setTxState({ 
          status: 'confirmed', 
          hash: response.result.hash,
          blockNumber: response.result.blockNumber
        });
      }
    } catch (err: any) {
      setTxState({ status: 'failed', error: err.message || 'Transaction failed' });
    }
  }, [token, recipient, amount]);

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
    if (txState.status === 'confirmed') {
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
            <h3>Confirm Transaction</h3>
            <p>Please review the details before sending</p>
          </div>

          <div className="tx-details-card">
            <div className="tx-detail-rows">
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <div className="tx-detail-value-group">
                  <span className="tx-detail-value tx-amount-highlight">{amount} {token.symbol}</span>
                  {getAmountUsd() && <span className="tx-detail-usd">{getAmountUsd()}</span>}
                </div>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">To</span>
                <span className="tx-detail-value">{formatAddress(recipient)}</span>
              </div>

              <div className="tx-detail-row">
                <span className="tx-detail-label">Network</span>
                <span className="tx-detail-value">{networkConfig?.network || 'Loading...'}</span>
              </div>

              <div className="tx-detail-divider" />

              <div className="tx-detail-row">
                <span className="tx-detail-label">Estimated Network Fee</span>
                <div className="tx-detail-value-group">
                  <span className="tx-detail-value">
                    {gasEstimateStatus === 'loading'
                      ? 'Estimating...'
                      : gasEstimate
                        ? `${parseFloat(gasEstimate.estimatedCostNative).toFixed(6)} ${gasEstimate.nativeSymbol}`
                        : '--'}
                  </span>
                  {getGasUsd() && <span className="tx-detail-usd">{getGasUsd()}</span>}
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
                Please wait while the transaction is being confirmed on the blockchain...
              </p>
            </div>
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