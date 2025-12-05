/**
 * AddTokenModal Component
 * 
 * Modal for adding custom ERC-20 tokens to the wallet.
 * Validates contract address format and fetches token metadata.
 */
import React, { useState } from 'react';

interface Token {
  symbol: string;
  name: string;
  type: 'native' | 'erc20';
  address?: string;
  decimals: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  network: string;
  onTokenAdded: () => void | Promise<void>;
}

function AddTokenModal({ isOpen, onClose, network, onTokenAdded }: Props) {
  const [contractAddress, setContractAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'input' | 'confirm'>('input');

  const resetForm = () => {
    setContractAddress('');
    setSymbol('');
    setName('');
    setDecimals('18');
    setError('');
    setStep('input');
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isValidAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const handleFetchMetadata = async () => {
    if (!contractAddress) {
      setError('Please enter a contract address');
      return;
    }

    if (!isValidAddress(contractAddress)) {
      setError('Invalid contract address format');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Try to fetch token metadata from the contract
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TOKEN_METADATA',
        payload: { address: contractAddress }
      });

      if (response.error) {
        // If we can't fetch metadata, let user enter manually
        setStep('confirm');
      } else if (response.metadata) {
        setSymbol(response.metadata.symbol || '');
        setName(response.metadata.name || '');
        setDecimals(response.metadata.decimals?.toString() || '18');
        setStep('confirm');
      } else {
        // Fallback to manual entry
        setStep('confirm');
      }
    } catch (err) {
      // Service worker might not support GET_TOKEN_METADATA yet
      // Fall back to manual entry
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToken = async () => {
    if (!symbol.trim()) {
      setError('Symbol is required');
      return;
    }

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const decimalsNum = parseInt(decimals, 10);
    if (isNaN(decimalsNum) || decimalsNum < 0 || decimalsNum > 18) {
      setError('Decimals must be between 0 and 18');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const token: Token = {
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        type: 'erc20',
        address: contractAddress.toLowerCase(),
        decimals: decimalsNum
      };

      const response = await chrome.runtime.sendMessage({
        type: 'ADD_CUSTOM_TOKEN',
        payload: { token }
      });

      if (response.error) {
        setError(response.error);
      } else {
        // Wait for refresh to complete before closing modal
        await onTokenAdded();
        handleClose();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add token');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="account-menu-overlay" onClick={handleClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
        {/* Header */}
        <div className="account-menu-header">
          <div className="account-menu-title">Add Custom Token</div>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        {/* Content */}
        <div className="account-menu-section" style={{ padding: '16px' }}>
          {step === 'input' ? (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Enter the contract address of the ERC-20 token you want to add on {network}.
              </p>

              <div className="form-group">
                <label>Contract Address</label>
                <input
                  type="text"
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  placeholder="0x..."
                />
              </div>

              {error && <div className="error" style={{ marginBottom: '12px' }}>{error}</div>}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={handleClose} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={handleFetchMetadata}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  {loading ? 'Loading...' : 'Next'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Confirm the token details below. You can edit them if needed.
              </p>

              <div className="form-group">
                <label>Contract Address</label>
                <input
                  type="text"
                  value={contractAddress}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>

              <div className="form-group">
                <label>Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g., USDC"
                />
              </div>

              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., USD Coin"
                />
              </div>

              <div className="form-group">
                <label>Decimals</label>
                <input
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                  placeholder="18"
                  min="0"
                  max="18"
                />
              </div>

              {error && <div className="error" style={{ marginBottom: '12px' }}>{error}</div>}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={() => setStep('input')} style={{ flex: 1 }}>
                  Back
                </button>
                <button 
                  className="btn btn-primary"
                  onClick={handleAddToken}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  {loading ? 'Adding...' : 'Add Token'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddTokenModal;
