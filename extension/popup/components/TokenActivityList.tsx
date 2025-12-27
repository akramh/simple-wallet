/**
 * @fileoverview Token-specific activity list for Token Details.
 *
 * Renders a filtered transaction list with status indicators and supports
 * opening the existing transaction details modal.
 *
 * @responsibilities
 * - Render token-filtered activity rows
 * - Provide refresh and detail modal interactions
 *
 * @security
 * - Displays explorer-derived data; no sensitive data handled
 */

import React, { useState } from 'react';
import TransactionDetailsModal from './TransactionDetailsModal';
import { formatAddress, formatDate, formatTransactionValue } from '../utils/transactionFormat';

interface TokenActivityListProps {
  transactions: Transaction[];
  loading: boolean;
  error?: string | null;
  networkConfig: { blockExplorer?: string; nativeSymbol?: string };
  onRefresh: () => void;
  refreshing: boolean;
}

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

/**
 * Token activity list component.
 *
 * @param props - Component props
 * @returns Token activity list
 */
export default function TokenActivityList({
  transactions,
  loading,
  error,
  networkConfig,
  onRefresh,
  refreshing
}: TokenActivityListProps) {
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const getTransactionType = (tx: Transaction) => {
    if (tx.type === 'send') return 'Sent';
    if (tx.type === 'receive') return 'Received';
    return 'Contract';
  };

  const handleTransactionClick = (tx: Transaction) => {
    setSelectedTx(tx);
    setShowDetailsModal(true);
  };

  return (
    <div className="token-activity">
      <div className="token-activity-header">
        <h4>Activity</h4>
        <button
          className="refresh-link"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="token-activity-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading activity...</div>
      ) : transactions.length === 0 ? (
        <div className="loading token-activity-empty">
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <p>No token activity yet</p>
        </div>
      ) : (
        <div className="transaction-list">
          {transactions.map((tx) => (
            <div key={tx.hash} className="transaction-item" onClick={() => handleTransactionClick(tx)}>
              <div className={`tx-status-bar ${tx.status}`} />
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

      {showDetailsModal && selectedTx && (
        <TransactionDetailsModal
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          transaction={selectedTx}
          networkConfig={{
            blockExplorer: networkConfig.blockExplorer || '',
            nativeSymbol: networkConfig.nativeSymbol || '???'
          }}
        />
      )}
    </div>
  );
}
