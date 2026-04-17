/**
 * RevealSecretModal Component
 * 
 * Modal for revealing sensitive wallet information (secret phrase or private key).
 * Requires password confirmation before revealing.
 */
import React, { useEffect, useState } from 'react';
import { Icon, MnemonicDisplay } from './ui';

type SecretType = 'mnemonic' | 'privateKey';
type ChainType = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
type PrivateKeyFormat = 'hex' | 'wif' | 'base58' | 'seed' | 'secretKey';

interface WalletState {
  importType?: 'mnemonic' | 'privateKey' | null;
  privateKeyType?: ChainType | null;
  network?: string | null;
}

const CHAIN_LABELS: Record<ChainType, string> = {
  evm: 'EVM (Ethereum)',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  xrp: 'XRP Ledger',
  ton: 'TON'
};

function getAvailableChains(networks: Record<string, any>): ChainType[] {
  const values = Object.values(networks || {});
  const hasType = (type: ChainType) => values.some((net: any) => net?.type === type);
  const hasEvm = values.some((net: any) => !net?.type || net?.type === 'evm');
  const chains: ChainType[] = [];
  if (hasEvm) chains.push('evm');
  if (hasType('bitcoin')) chains.push('bitcoin');
  if (hasType('solana')) chains.push('solana');
  if (hasType('xrp')) chains.push('xrp');
  if (hasType('ton')) chains.push('ton');
  return chains;
}

function getChainFromNetwork(network: string | null | undefined, networks: Record<string, any>): ChainType {
  if (!network || !networks?.[network]) return 'evm';
  const netType = networks[network]?.type;
  if (netType === 'bitcoin' || netType === 'solana' || netType === 'xrp' || netType === 'ton') {
    return netType;
  }
  return 'evm';
}

function getFormatOptions(chainType: ChainType, walletState: WalletState | null): Array<{ value: PrivateKeyFormat; label: string; disabled?: boolean; hint?: string }> {
  const isMnemonic = walletState?.importType === 'mnemonic';
  switch (chainType) {
    case 'bitcoin':
      return [{ value: 'wif', label: 'WIF (Wallet Import Format)' }];
    case 'solana':
      return [{ value: 'base58', label: 'Base58 secret key' }];
    case 'xrp':
      return [
        {
          value: 'seed',
          label: 'Family seed (s...)',
          disabled: isMnemonic,
          hint: isMnemonic ? 'Seed format unavailable for mnemonic wallets' : 'Most XRPL wallets expect this format'
        },
        { value: 'hex', label: 'Hex private key' }
      ];
    case 'ton':
      return [
        { value: 'seed', label: 'Seed (32-byte hex)' },
        { value: 'secretKey', label: 'Secret key (64-byte hex)' }
      ];
    case 'evm':
    default:
      return [{ value: 'hex', label: 'Hex (0x...)' }];
  }
}

function getFormatHelp(chainType: ChainType, format: PrivateKeyFormat): string {
  switch (chainType) {
    case 'bitcoin':
      return 'WIF format for the selected Bitcoin network';
    case 'solana':
      return 'Base58-encoded secret key (64 bytes)';
    case 'xrp':
      return format === 'seed'
        ? 'XRPL family seed (starts with s)'
        : 'Hex-encoded private key (32 bytes)';
    case 'ton':
      return format === 'secretKey'
        ? 'Hex-encoded secret key (64 bytes)'
        : 'Hex-encoded seed (32 bytes)';
    case 'evm':
    default:
      return '0x-prefixed 64 hex characters';
  }
}

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
  const [chainType, setChainType] = useState<ChainType>('evm');
  const [format, setFormat] = useState<PrivateKeyFormat>('hex');
  const [chainOptions, setChainOptions] = useState<Array<{ value: ChainType; label: string }>>([]);
  const [walletState, setWalletState] = useState<WalletState | null>(null);

  const title = secretType === 'mnemonic' ? 'Secret Recovery Phrase' : 'Private Key';
  const messageType = secretType === 'mnemonic' ? 'GET_SECRET_PHRASE' : 'GET_PRIVATE_KEY';

  useEffect(() => {
    if (!isOpen || secretType !== 'privateKey') return;
    let isActive = true;

    Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      chrome.runtime.sendMessage({ type: 'GET_NETWORKS' })
    ])
      .then(([state, networksResponse]) => {
        if (!isActive) return;
        const networkMap = networksResponse?.networks || {};
        const availableChains = getAvailableChains(networkMap);
        const options = availableChains.map((value) => ({
          value,
          label: CHAIN_LABELS[value]
        }));
        const stateChain = getChainFromNetwork(state?.network, networkMap);
        const lockedChain =
          state?.importType === 'privateKey' && state?.privateKeyType
            ? state.privateKeyType
            : stateChain;
        const fallbackChain = options[0]?.value ?? 'evm';
        const nextChain = (lockedChain && (CHAIN_LABELS as Record<string, string>)[lockedChain])
          ? lockedChain
          : fallbackChain;

        setWalletState({
          importType: state?.importType ?? null,
          privateKeyType: state?.privateKeyType ?? null,
          network: state?.network ?? null
        });
        setChainOptions(options);
        setChainType(nextChain as ChainType);
      })
      .catch(() => {});

    return () => {
      isActive = false;
    };
  }, [isOpen, secretType]);

  useEffect(() => {
    if (secretType !== 'privateKey') return;
    const options = getFormatOptions(chainType, walletState);
    const activeOption = options.find((option) => option.value === format && !option.disabled);
    if (!activeOption) {
      const next = options.find((option) => !option.disabled) || options[0];
      setFormat(next?.value ?? 'hex');
    }
  }, [chainType, walletState, format, secretType]);

  const resetForm = () => {
    setPassword('');
    setSecret('');
    setError('');
    setStep('password');
    setIsRevealed(false);
    setCopied(false);
    setLoading(false);
    setChainType('evm');
    setFormat('hex');
    setChainOptions([]);
    setWalletState(null);
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
      const payload: Record<string, any> = { password };
      if (secretType === 'privateKey') {
        payload.chainType = chainType;
        payload.format = format;
      }
      const response = await chrome.runtime.sendMessage({
        type: messageType,
        payload
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

  const formatOptions = getFormatOptions(chainType, walletState);
  const formatHelp = getFormatHelp(chainType, format);
  const isChainLocked = walletState?.importType === 'privateKey' && !!walletState?.privateKeyType;
  const chainSelectOptions = chainOptions.length
    ? chainOptions
    : (Object.keys(CHAIN_LABELS) as ChainType[]).map((value) => ({
        value,
        label: CHAIN_LABELS[value]
      }));

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
                  <Icon name="alert-triangle" size={18} decorative style={{ color: 'var(--warning-dark)', flex: '0 0 auto', marginTop: 1 }} />
                  <div style={{ fontSize: '13px', color: 'var(--warning-dark)', lineHeight: 1.5 }}>
                    <strong>Warning:</strong> Never share your {secretType === 'mnemonic' ? 'secret recovery phrase' : 'private key'} with anyone.
                    Anyone with access to it can steal your funds.
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Enter your password to reveal your {secretType === 'mnemonic' ? 'secret recovery phrase' : 'private key'}.
              </p>

              {secretType === 'privateKey' && (
                <>
                  <div className="form-group">
                    <label>Chain</label>
                    <select
                      value={chainType}
                      onChange={(e) => {
                        setChainType(e.target.value as ChainType);
                        setError('');
                      }}
                      disabled={isChainLocked}
                    >
                      {chainSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {isChainLocked && (
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                        Private key wallets can only export their original chain.
                      </div>
                    )}
                  </div>

                  {formatOptions.length > 1 ? (
                    <div className="form-group">
                      <label>Format</label>
                      <select
                        value={format}
                        onChange={(e) => {
                          setFormat(e.target.value as PrivateKeyFormat);
                          setError('');
                        }}
                      >
                        {formatOptions.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                            title={option.hint}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                        {formatHelp}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                      Format: {formatOptions[0]?.label} — {formatHelp}
                    </div>
                  )}
                </>
              )}

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
                  <Icon name="lock-keyhole" size={18} decorative style={{ color: 'var(--danger-dark)', flex: '0 0 auto', marginTop: 1 }} />
                  <div style={{ fontSize: '13px', color: 'var(--danger-dark)', lineHeight: 1.5 }}>
                    <strong>Keep this secret!</strong> Do not share or store in an insecure location.
                  </div>
                </div>
              </div>

              {/* Secret Display */}
              {secretType === 'privateKey' && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {CHAIN_LABELS[chainType]} • {formatHelp}
                </div>
              )}
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
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Icon name={isRevealed ? 'eye-off' : 'eye'} size={16} decorative />
                  {isRevealed ? 'Hide' : 'Reveal'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleCopy}
                  disabled={!isRevealed}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={16} decorative />
                  {copied ? 'Copied!' : 'Copy'}
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
