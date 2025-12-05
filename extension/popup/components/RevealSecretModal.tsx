/**
 * RevealSecretModal Component
 * 
 * Modal for revealing sensitive wallet information (secret phrase or private key).
 * Requires password confirmation before revealing.
 */
import React, { useState } from 'react';
import { MnemonicDisplay } from './ui';

type SecretType = 'mnemonic' | 'privateKey';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  secretType: SecretType;
}

function RevealSecretModal({ isOpen, onClose, secretType }: Props) {
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'password' | 'reveal'>('password');
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const title = secretType === 'mnemonic' ? 'Secret Recovery Phrase' : 'Private Key';
  const messageType = secretType === 'mnemonic' ? 'GET_SECRET_PHRASE' : 'GET_PRIVATE_KEY';

  const resetForm = () => {
    setPassword('');
    setSecret('');
    setError('');
    setStep('password');
    setIsRevealed(false);
    setCopied(false);
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleReveal = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: messageType,
        payload: { password }
      });

      if (response.error) {
        setError(response.error);
      } else {
        const secretValue = secretType === 'mnemonic' ? response.mnemonic : response.privateKey;
        setSecret(secretValue);
        setStep('reveal');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve secret');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="account-menu-overlay" onClick={handleClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        {/* Header */}
        <div className="account-menu-header">
          <div className="account-menu-title">{title}</div>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        {/* Content */}
        <div className="account-menu-section" style={{ padding: '16px' }}>
          {step === 'password' ? (
            <>
              {/* Warning */}
              <div className="alert alert-warning" style={{ 
                background: 'var(--warning-light)', 
                border: '1px solid var(--warning)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>⚠️</span>
                  <div style={{ fontSize: '13px', color: 'var(--warning-dark)', lineHeight: 1.5 }}>
                    <strong>Warning:</strong> Never share your {secretType === 'mnemonic' ? 'secret recovery phrase' : 'private key'} with anyone. 
                    Anyone with access to it can steal your funds.
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Enter your password to reveal your {secretType === 'mnemonic' ? 'secret recovery phrase' : 'private key'}.
              </p>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  onKeyDown={(e) => e.key === 'Enter' && handleReveal()}
                />
              </div>

              {error && <div className="error" style={{ marginBottom: '12px' }}>{error}</div>}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={handleClose} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={handleReveal}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  {loading ? 'Verifying...' : 'Continue'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Danger Warning */}
              <div className="alert alert-danger" style={{ 
                background: 'var(--danger-light)', 
                border: '1px solid var(--danger)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>🔐</span>
                  <div style={{ fontSize: '13px', color: 'var(--danger-dark)', lineHeight: 1.5 }}>
                    <strong>Keep this secret!</strong> Do not share or store in an insecure location.
                  </div>
                </div>
              </div>

              {/* Secret Display */}
              {secretType === 'mnemonic' ? (
                <div style={{ 
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <MnemonicDisplay mnemonic={secret} isRevealed={isRevealed} />
                </div>
              ) : (
                <div style={{ 
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <div style={{ 
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    wordBreak: 'break-all',
                    color: 'var(--text-primary)',
                    filter: isRevealed ? 'none' : 'blur(4px)',
                    userSelect: isRevealed ? 'text' : 'none',
                    transition: 'filter 0.2s'
                  }}>
                    {secret}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <button 
                  className="btn btn-secondary"
                  onClick={() => setIsRevealed(!isRevealed)}
                  style={{ flex: 1 }}
                >
                  {isRevealed ? '🙈 Hide' : '👁️ Reveal'}
                </button>
                <button 
                  className="btn btn-secondary"
                  onClick={handleCopy}
                  disabled={!isRevealed}
                  style={{ flex: 1 }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>

              <button className="btn btn-primary" onClick={handleClose} style={{ width: '100%' }}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default RevealSecretModal;
