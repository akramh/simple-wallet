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

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-warning-light text-warning-dark border-warning';
      case 'confirmed':
        return 'bg-success-light text-success-dark border-success';
      case 'failed':
        return 'bg-danger-light text-danger-dark border-danger';
      default:
        return 'bg-surface-secondary text-text-secondary border-border';
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
      <div className="flex items-center justify-center py-16">
        <div className="text-text-secondary text-base">Loading transactions...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex justify-between items-center px-5 py-4 border-b border-border">
        <h2 className="text-lg font-bold text-text-primary">Transaction History</h2>
        <button
          className="w-10 h-10 flex items-center justify-center rounded-wallet-sm text-xl hover:bg-surface-secondary transition-colors"
          onClick={loadTransactions}
          title="Refresh"
        >
          🔄
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-5 py-4 border-b border-border overflow-x-auto scrollbar-hide">
        {(['all', 'pending', 'confirmed', 'failed'] as const).map((filterType) => {
          const count = filterType === 'all'
            ? transactions.length
            : transactions.filter(tx => tx.status === filterType).length;
          return (
            <button
              key={filterType}
              className={`px-4 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-all ${
                filter === filterType
                  ? 'bg-primary text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary'
              }`}
              onClick={() => setFilter(filterType)}
            >
              {filterType.charAt(0).toUpperCase() + filterType.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-base font-semibold text-text-primary mb-2">No transactions yet</p>
            <span className="text-sm text-text-secondary">Your transaction history will appear here</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredTransactions.map((tx) => (
              <div
                key={tx.hash}
                className="flex items-start gap-4 p-4 bg-white border border-border rounded-wallet-sm hover:border-border-dark transition-colors"
              >
                {/* Icon */}
                <div className="w-11 h-11 rounded-full bg-surface-secondary flex items-center justify-center text-xl shrink-0">
                  {tx.type === 'send' ? '📤' : '📥'}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-semibold text-sm text-text-primary">
                      {getTransactionType(tx)}
                    </span>
                    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${getStatusStyles(tx.status)}`}>
                      {getStatusIcon(tx.status)} {tx.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm text-text-secondary mb-2">
                    <span className="font-mono">
                      {tx.type === 'send' ? `To: ${formatAddress(tx.to)}` : `From: ${formatAddress(tx.from)}`}
                    </span>
                    <span>{formatDate(tx.timestamp)}</span>
                  </div>

                  <div className="text-base font-semibold text-text-primary">
                    {tx.type === 'send' ? '-' : '+'}{tx.value} {tx.tokenSymbol || 'ETH'}
                  </div>

                  {tx.error && (
                    <div className="mt-3 text-sm text-danger flex items-center gap-2">
                      <span>⚠️</span> {tx.error}
                    </div>
                  )}
                </div>

                {/* Explorer Link */}
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-wallet-sm text-lg hover:bg-surface-secondary transition-colors shrink-0"
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
