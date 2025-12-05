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

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'confirmed': return '✅';
      case 'failed': return '❌';
      default: return '';
    }
  };

  const getTransactionType = (tx: Transaction) => {
    if (tx.from.toLowerCase() === currentAddress.toLowerCase()) return 'Sent';
    if (tx.to.toLowerCase() === currentAddress.toLowerCase()) return 'Received';
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
      <div className="loading">
        Loading transactions...
      </div>
    );
  }

  return (
    <div className="activity-view">
      {/* Header */}
      <div className="activity-header">
        <h2>Transaction History</h2>
        <button
          className="btn-refresh"
          onClick={loadTransactions}
          title="Refresh"
        >
          🔄
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="activity-filters">
        {(['all', 'pending', 'confirmed', 'failed'] as const).map((filterType) => {
          const count = filterType === 'all'
            ? transactions.length
            : transactions.filter(tx => tx.status === filterType).length;
          return (
            <button
              key={filterType}
              className={`filter-btn ${filter === filterType ? 'active' : ''}`}
              onClick={() => setFilter(filterType)}
            >
              {filterType.charAt(0).toUpperCase() + filterType.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {/* Transaction List */}
      <div className="transaction-list">
        {filteredTransactions.length === 0 ? (
          <div className="loading" style={{ flexDirection: 'column', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>No transactions yet</p>
            <span>Your transaction history will appear here</span>
          </div>
        ) : (
          <div>
            {filteredTransactions.map((tx) => (
              <div key={tx.hash} className="transaction-item">
                {/* Icon */}
                <div className="tx-icon">
                  <div className={`tx-type-badge ${tx.type}`}>
                    {tx.type === 'send' ? '📤' : '📥'}
                  </div>
                </div>

                {/* Details */}
                <div className="tx-details">
                  <div className="tx-main">
                    <span className="tx-type">{getTransactionType(tx)}</span>
                    <span className={`tx-status tx-status-${tx.status}`}>
                      {getStatusIcon(tx.status)} {tx.status}
                    </span>
                  </div>

                  <div className="tx-meta">
                    <span className="tx-address">
                      {tx.type === 'send' ? `To: ${formatAddress(tx.to)}` : `From: ${formatAddress(tx.from)}`}
                    </span>
                    <span className="tx-time">{formatDate(tx.timestamp)}</span>
                  </div>

                  <div className="tx-amount">
                    {tx.type === 'send' ? '-' : '+'}{tx.value} {tx.tokenSymbol || 'ETH'}
                  </div>

                  {tx.error && (
                    <div className="tx-error">
                      <span>⚠️</span> {tx.error}
                    </div>
                  )}
                </div>

                {/* Explorer Link */}
                <button
                  className="btn-refresh"
                  onClick={() => openInExplorer(tx.hash)}
                  title="View on Explorer"
                >
                  🔗
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityView;
