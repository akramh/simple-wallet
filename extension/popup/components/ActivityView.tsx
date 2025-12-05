import React, { useState, useEffect, useCallback } from 'react';
import { TransactionHistoryManager } from '../../../src/transaction-history.js';

interface Transaction {
  hash: string;
  from: string;
  to: string | null;
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

type DataSource = 'explorer' | 'local';

function ActivityView({ currentAddress, network }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'failed'>('all');
  const [dataSource, setDataSource] = useState<DataSource>('explorer');
  const [error, setError] = useState<string | null>(null);
  const [explorerSupported, setExplorerSupported] = useState(true);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      if (dataSource === 'explorer') {
        // Fetch from block explorer API
        const response = await chrome.runtime.sendMessage({
          type: 'GET_EXPLORER_TRANSACTIONS',
          payload: { network, address: currentAddress }
        });

        setExplorerSupported(response.supported !== false);
        
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
      } else {
        // Fetch from local storage (wallet-initiated txs only)
        const response = await chrome.runtime.sendMessage({
          type: 'GET_TRANSACTIONS_BY_NETWORK',
          payload: { network }
        });
        setTransactions(response.transactions || []);
      }
    } catch (err: any) {
      console.error('Failed to load transactions:', err);
      setError(err.message);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [network, dataSource, currentAddress]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const formatAddress = (addr: string | undefined | null) => {
    if (!addr) return 'Unknown';
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
    if (tx.from?.toLowerCase() === currentAddress.toLowerCase()) return 'Sent';
    if (tx.to?.toLowerCase() === currentAddress.toLowerCase()) return 'Received';
    return 'Contract';
  };

  const formatValue = (value: string, tokenSymbol?: string) => {
    // Explorer API returns value in wei for ETH, raw for tokens
    if (!tokenSymbol || tokenSymbol === 'ETH') {
      // Convert wei to ETH
      const ethValue = parseFloat(value) / 1e18;
      if (ethValue === 0) return '0 ETH';
      if (ethValue < 0.0001) return '<0.0001 ETH';
      return `${ethValue.toFixed(4)} ETH`;
    }
    // For tokens, the value might already be formatted or need decimal adjustment
    const numValue = parseFloat(value);
    if (numValue === 0) return `0 ${tokenSymbol}`;
    if (numValue < 0.0001) return `<0.0001 ${tokenSymbol}`;
    return `${numValue.toFixed(4)} ${tokenSymbol}`;
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
        <h2>Activity</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {explorerSupported && (
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value as DataSource)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <option value="explorer">Explorer</option>
              <option value="local">Local</option>
            </select>
          )}
          <button
            className="btn-refresh"
            onClick={loadTransactions}
            title="Refresh"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--warning-light)',
          border: '1px solid var(--warning)',
          borderRadius: '6px',
          fontSize: '12px',
          color: 'var(--warning-dark)',
          marginBottom: '12px'
        }}>
          ⚠️ {error}. Showing local transactions.
        </div>
      )}

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
                    {tx.type === 'send' ? '-' : '+'}{formatValue(tx.value, tx.tokenSymbol)}
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
