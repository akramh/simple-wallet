import React, { useState, useEffect } from 'react';
import { TransactionHistoryManager } from '../../../src/transaction-history.js';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
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
}

interface Props {
  currentAddress: string;
  network: string;
}

function ActivityView({ currentAddress, network }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'failed'>('all');

  useEffect(() => {
    loadTransactions();
  }, [network]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRANSACTIONS_BY_NETWORK',
        payload: { network }
      });

      if (response.transactions) {
        setTransactions(response.transactions);
      }
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than a minute
    if (diff < 60000) {
      return 'Just now';
    }

    // Less than an hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }

    // Less than a day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than a week
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Show date
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'confirmed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'tx-status-pending';
      case 'confirmed':
        return 'tx-status-confirmed';
      case 'failed':
        return 'tx-status-failed';
      default:
        return '';
    }
  };

  const getTransactionType = (tx: Transaction) => {
    if (tx.from.toLowerCase() === currentAddress.toLowerCase()) {
      return 'Sent';
    } else if (tx.to.toLowerCase() === currentAddress.toLowerCase()) {
      return 'Received';
    }
    return 'Contract';
  };

  const openInExplorer = (hash: string) => {
    const url = TransactionHistoryManager.getExplorerUrl(network, hash);
    chrome.tabs.create({ url });
  };

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return true;
    return tx.status === filter;
  });

  if (loading) {
    return (
      <div className="activity-view">
        <div className="loading">Loading transactions...</div>
      </div>
    );
  }

  return (
    <div className="activity-view">
      <div className="activity-header">
        <h2>Transaction History</h2>
        <button className="btn-refresh" onClick={loadTransactions} title="Refresh">
          🔄
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="activity-filters">
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({transactions.length})
        </button>
        <button
          className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
          onClick={() => setFilter('pending')}
        >
          Pending ({transactions.filter(tx => tx.status === 'pending').length})
        </button>
        <button
          className={`filter-btn ${filter === 'confirmed' ? 'active' : ''}`}
          onClick={() => setFilter('confirmed')}
        >
          Confirmed ({transactions.filter(tx => tx.status === 'confirmed').length})
        </button>
        <button
          className={`filter-btn ${filter === 'failed' ? 'active' : ''}`}
          onClick={() => setFilter('failed')}
        >
          Failed ({transactions.filter(tx => tx.status === 'failed').length})
        </button>
      </div>

      {/* Transaction List */}
      <div className="transaction-list">
        {filteredTransactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>No transactions yet</p>
            <span>Your transaction history will appear here</span>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div key={tx.hash} className="transaction-item">
              <div className="tx-icon">
                <span className={`tx-type-badge ${tx.type}`}>
                  {tx.type === 'send' ? '📤' : '📥'}
                </span>
              </div>

              <div className="tx-details">
                <div className="tx-main">
                  <span className="tx-type">{getTransactionType(tx)}</span>
                  <span className={`tx-status ${getStatusClass(tx.status)}`}>
                    {getStatusIcon(tx.status)} {tx.status}
                  </span>
                </div>

                <div className="tx-addresses">
                  <span className="tx-address">
                    {tx.type === 'send' ? `To: ${formatAddress(tx.to)}` : `From: ${formatAddress(tx.from)}`}
                  </span>
                  <span className="tx-time">{formatDate(tx.timestamp)}</span>
                </div>

                <div className="tx-amount">
                  {tx.value} {tx.tokenSymbol || 'ETH'}
                </div>

                {tx.error && (
                  <div className="tx-error">
                    <span className="error-icon">⚠️</span> {tx.error}
                  </div>
                )}
              </div>

              <div className="tx-actions">
                <button
                  className="btn-explorer"
                  onClick={() => openInExplorer(tx.hash)}
                  title="View on Explorer"
                >
                  🔗
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ActivityView;
