/**
 * @fileoverview Activity list view for the extension popup.
 *
 * Displays recent transactions for the active network with explorer fallback,
 * and allows users to open transaction details.
 *
 * @responsibilities
 * - Fetch and render transaction activity for the active account
 * - Provide refresh and detail modal interactions
 *
 * @security
 * - Uses explorer APIs via background messaging; no secrets handled in UI
 */

import React, { useState, useEffect, useCallback } from 'react';
import TransactionDetailsModal from './TransactionDetailsModal';
import { formatAddress, formatDate, formatTransactionValue } from '../utils/transactionFormat';
import { EmptyState, Icon } from './ui';

interface Transaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  fee?: string;
  destinationTag?: number;
  network: string;
  status: 'pending' | 'confirmed' | 'failed';
  type: 'send' | 'receive' | 'contract_interaction';
  timestamp: number;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  error?: string;
  nonce?: number;
}

interface Props {
  currentAddress: string;
  network: string;
  networks: Record<string, any>;
}

/**
 * Activity list screen for the current network.
 *
 * @param props - Component props
 * @returns Activity view component
 */
function ActivityView({ currentAddress, network, networks }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const loadTransactions = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_EXPLORER_TRANSACTIONS',
        payload: { network, address: currentAddress }
      });
      
      if (response.error || !response.supported) {
        if (response.error) setError(response.error);
        // Fall back to local transactions
        const localResponse = await chrome.runtime.sendMessage({
          type: 'GET_TRANSACTIONS_BY_NETWORK',
          payload: { network }
        });
        setTransactions(localResponse.transactions || []);
      } else {
        setTransactions(response.transactions || []);
      }
    } catch (err: any) {
      console.error('Failed to load transactions:', err);
      setError(err.message);
      setTransactions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [network, currentAddress]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const getTransactionType = (tx: Transaction) => {
    if (tx.type === 'send') return 'Sent';
    if (tx.type === 'receive') return 'Received';
    return 'Contract';
  };

  const handleTransactionClick = (tx: Transaction) => {
    setSelectedTx(tx);
    setShowDetailsModal(true);
  };

  const getNetworkConfigForTx = (txNetworkKey: string) => {
    const netConfig = networks[txNetworkKey];
    if (!netConfig) {
      // Fallback for missing network config (shouldn't happen if networks prop is robust)
      return { blockExplorer: '', nativeSymbol: '???' };
    }
    return {
      blockExplorer: netConfig.blockExplorer || '',
      nativeSymbol: netConfig.nativeSymbol || '???'
    };
  };

  if (loading) {
    return (
      <div className="loading">
        Loading transactions...
      </div>
    );
  }

  return (
    <div className="activity-view">
      {/* Header - just refresh button */}
      <div className="activity-header-simple">
        <button
          className="refresh-link"
          onClick={() => loadTransactions(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Fallback notice: explorer unreachable → local cache. Keep it calm & subtle. */}
      {error && (
        <div className="activity-fallback-chip" title={error}>
          <Icon name="info" size={12} decorative />
          <span>Showing cached history</span>
        </div>
      )}

      {/* Transaction List */}
      <div className="transaction-list">
        {transactions.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No transactions yet"
            subtitle="Your transaction history will appear here."
          />
        ) : (
          <div>
            {transactions.map((tx) => (
              <div key={tx.hash} className="transaction-item" onClick={() => handleTransactionClick(tx)}>
                {/* Status Indicator Bar */}
                <div className={`tx-status-bar ${tx.status}`} title={tx.status.charAt(0).toUpperCase() + tx.status.slice(1)} />
                
                {/* Details */}
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">{getTransactionType(tx)}</span>
                    <span className="tx-amount-value">
                      {tx.type === 'send' ? '-' : '+'}{formatTransactionValue(tx.value, tx.tokenSymbol)}
                    </span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">
                      {tx.type === 'send' ? `To ${formatAddress(tx.to)}` : `From ${formatAddress(tx.from)}`}
                    </span>
                    <span className="tx-time">{formatDate(tx.timestamp)}</span>
                  </div>
                  {tx.error && (
                    <div className="tx-error-inline">{tx.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction Details Modal */}
      {showDetailsModal && selectedTx && (
        <TransactionDetailsModal
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          transaction={selectedTx}
          networkConfig={getNetworkConfigForTx(selectedTx.network)}
        />
      )}
    </div>
  );
}

export default ActivityView;
