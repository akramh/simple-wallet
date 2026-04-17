/**
 * @file TransactionDetailsModal.tsx
 * @description Modal UI for displaying transaction details in the extension.
 *
 * @responsibilities
 * - Render transaction metadata (status, type, addresses, hash, fees)
 * - Provide copy-to-clipboard affordances for addresses and hashes
 * - Open the transaction on the appropriate block explorer
 *
 * @security
 * - Opens external block explorer URLs in a new tab
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { TransactionHistoryManager } from '../../../src/transaction-history.js';
import { Icon, Modal } from './ui';

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

interface NetworkConfig {
  blockExplorer: string;
  nativeSymbol: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  networkConfig: NetworkConfig; // Specific config for the transaction's network
}

function TransactionDetailsModal({ isOpen, onClose, transaction, networkConfig }: Props) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const formatAddress = (addr: string | null) => {
    if (!addr) return 'N/A';
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatHash = (hash: string) => {
    return `${hash.substring(0, 10)}...${hash.substring(hash.length - 8)}`;
  };

  const getExplorerUrl = useCallback(() => {
    if (!transaction.hash) return '';
    if (networkConfig.blockExplorer) {
      const base = networkConfig.blockExplorer.replace(/\/$/, '');
      const suffix = transaction.network === 'solana-devnet' ? '?cluster=devnet' : '';
      return `${base}/tx/${transaction.hash}${suffix}`;
    }
    return TransactionHistoryManager.getExplorerUrl(transaction.network, transaction.hash);
  }, [transaction.hash, transaction.network, networkConfig.blockExplorer]);

  const openInExplorer = useCallback(() => {
    const url = getExplorerUrl();
    if (url) {
      chrome.tabs.create({ url });
    }
  }, [getExplorerUrl]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      showToast(`${label} copied!`);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [showToast]);

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'confirmed': return 'var(--success)';
      case 'pending': return 'var(--warning)';
      case 'failed': return 'var(--danger)';
      default: return 'var(--text-secondary)';
    }
  };

  const getStatusText = (status: Transaction['status']) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };
  
  // Convert wei to ETH for display if it's an EVM native token
  const formatValueForDisplay = (value: string, symbol: string) => {
    if (networkConfig.nativeSymbol === 'ETH' || networkConfig.nativeSymbol === 'tETH') { // EVM native is stored as wei
      const numValue = parseFloat(value) / 1e18; // Convert from wei
      return `${numValue.toFixed(4)} ${symbol}`;
    }
    // For other networks like Solana or Bitcoin, value is already in native units
    // or for ERC20/SPL tokens.
    const numValue = parseFloat(value);
    return `${numValue.toFixed(4)} ${symbol}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transaction Details" size="sm">
      <div className="transaction-details-modal">
        <div className="detail-row">
          <span className="detail-label">Status</span>
          <span className="detail-value" style={{ color: getStatusColor(transaction.status) }}>
            {getStatusText(transaction.status)}
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Type</span>
          <span className="detail-value">{transaction.type}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Value</span>
          <span className="detail-value">
            {transaction.type === 'send' ? '-' : '+'}
            {formatValueForDisplay(transaction.value, transaction.tokenSymbol || networkConfig.nativeSymbol)}
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">From</span>
          <span className="detail-value copyable" onClick={() => copyToClipboard(transaction.from, 'Address')}>
            {formatAddress(transaction.from)}
            <Icon name="copy" size={12} decorative className="copy-icon" />
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">To</span>
          <span className="detail-value copyable" onClick={() => copyToClipboard(transaction.to || '', 'Address')}>
            {formatAddress(transaction.to)}
            <Icon name="copy" size={12} decorative className="copy-icon" />
          </span>
        </div>

        {typeof transaction.destinationTag === 'number' && (
          <div className="detail-row">
            <span className="detail-label">Destination Tag</span>
            <span className="detail-value">{transaction.destinationTag.toString()}</span>
          </div>
        )}

        <div className="detail-row">
          <span className="detail-label">Transaction Hash</span>
          <span className="detail-value copyable" onClick={() => copyToClipboard(transaction.hash, 'Hash')}>
            {formatHash(transaction.hash)}
            <Icon name="copy" size={12} decorative className="copy-icon" />
          </span>
        </div>

        {transaction.blockNumber && (
          <div className="detail-row">
            <span className="detail-label">Block Number</span>
            <span className="detail-value">{transaction.blockNumber.toLocaleString()}</span>
          </div>
        )}

        {transaction.nonce && (
          <div className="detail-row">
            <span className="detail-label">Nonce</span>
            <span className="detail-value">{transaction.nonce}</span>
          </div>
        )}

        {transaction.fee && (
          <div className="detail-row">
            <span className="detail-label">Fee</span>
            <span className="detail-value">{transaction.fee} {networkConfig.nativeSymbol}</span>
          </div>
        )}
        
        {transaction.gasUsed && (
          <div className="detail-row">
            <span className="detail-label">Gas Used</span>
            <span className="detail-value">{transaction.gasUsed}</span>
          </div>
        )}
        
        {transaction.gasPrice && (
          <div className="detail-row">
            <span className="detail-label">Gas Price</span>
            <span className="detail-value">{transaction.gasPrice}</span>
          </div>
        )}

        <div className="detail-row">
          <span className="detail-label">Date</span>
          <span className="detail-value">{formatDate(transaction.timestamp)}</span>
        </div>

        {transaction.error && (
          <div className="detail-row">
            <span className="detail-label" style={{ color: 'var(--danger)' }}>Error</span>
            <span className="detail-value" style={{ color: 'var(--danger)' }}>{transaction.error}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={openInExplorer}>
            View on Explorer
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default TransactionDetailsModal;
