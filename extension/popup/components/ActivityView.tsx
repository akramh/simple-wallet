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

function ActivityView({ currentAddress, network }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

      {/* Transaction List */}
      <div className="transaction-list">
        {transactions.length === 0 ? (
          <div className="loading" style={{ flexDirection: 'column', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>No transactions yet</p>
            <span>Your transaction history will appear here</span>
          </div>
        ) : (
          <div>
            {transactions.map((tx) => (
              <div key={tx.hash} className="transaction-item">
                {/* Status Indicator Bar */}
                <div className={`tx-status-bar ${tx.status}`} title={tx.status.charAt(0).toUpperCase() + tx.status.slice(1)} />
                
                {/* Details */}
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">{getTransactionType(tx)}</span>
                    <span className="tx-amount-value">
                      {tx.type === 'send' ? '-' : '+'}{formatValue(tx.value, tx.tokenSymbol)}
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

                {/* View Link */}
                <button
                  className="tx-view-link"
                  onClick={() => openInExplorer(tx.hash)}
                  title="View on explorer"
                >
                  View
                </button>

                {/* Hover Tooltip */}
                <div className="tx-tooltip">
                  <div className="tx-tooltip-row"><strong>Status:</strong> {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}</div>
                  <div className="tx-tooltip-row"><strong>Hash:</strong> {tx.hash.substring(0, 10)}...{tx.hash.substring(tx.hash.length - 8)}</div>
                  <div className="tx-tooltip-row"><strong>From:</strong> {formatAddress(tx.from)}</div>
                  <div className="tx-tooltip-row"><strong>To:</strong> {formatAddress(tx.to)}</div>
                  {tx.blockNumber && <div className="tx-tooltip-row"><strong>Block:</strong> {tx.blockNumber}</div>}
                  {tx.gasUsed && <div className="tx-tooltip-row"><strong>Gas Used:</strong> {tx.gasUsed}</div>}
                  <div className="tx-tooltip-row"><strong>Time:</strong> {new Date(tx.timestamp).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityView;
