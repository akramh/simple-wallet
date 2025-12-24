/**
 * AccountMenu Component
 * 
 * A comprehensive modal for managing wallets and accounts.
 * Features: view/switch wallets & accounts, create/import wallets
 */
import React, { useState, useEffect } from 'react';
import { MnemonicDisplay } from './ui';
import { useToast } from '../context/ToastContext';

interface Account {
  index: number;
  address: string;
  createdAt?: string;
}

interface WalletMeta {
  name: string;
  accounts: Record<number, { address: string; createdAt: string }>;
  importType?: 'mnemonic' | 'privateKey';
}

interface Props {
  currentAddress: string;
  currentWalletName?: string;
  onClose: () => void;
  onAccountSwitch: () => void;
  onWalletSwitch?: () => void;
  onStateChange?: () => void;
}

function AccountMenu({
  currentAddress,
  currentWalletName,
  onClose,
  onAccountSwitch,
  onWalletSwitch,
  onStateChange
}: Props) {
  // Keep wallet names consistent with storage keys and background validation rules.
  const isValidWalletName = (name: string) => /^[A-Za-z0-9]{1,12}$/.test(name);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success' | ''; message: string }>({ type: '', message: '' });
  
  // Import State
  const [importMnemonic, setImportMnemonic] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [importType, setImportType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  const [importChainType, setImportChainType] = useState('evm');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'success'>('form');
  const [importStep, setImportStep] = useState<'form' | 'success'>('form');
  const [showCreatedMnemonic, setShowCreatedMnemonic] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState('');
  const [createdWalletName, setCreatedWalletName] = useState('');
  const [importedWalletName, setImportedWalletName] = useState('');
  const { showToast } = useToast();
  const [pendingCreateName, setPendingCreateName] = useState('wallet1');
  const [pendingImportName, setPendingImportName] = useState('wallet1');
  const [createNameInput, setCreateNameInput] = useState('');
  const [importNameInput, setImportNameInput] = useState('');
  const [isEditingCurrentWalletName, setIsEditingCurrentWalletName] = useState(false);
  const [currentWalletNameDraft, setCurrentWalletNameDraft] = useState('');

  useEffect(() => {
    loadAccounts();
    loadWallets();
    return () => {
      setStatus({ type: '', message: '' });
    };
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
      if (response.accounts) {
        const accountList = Object.entries(response.accounts).map(([index, data]: [string, any]) => ({
          index: parseInt(index, 10),
          address: data.address,
          createdAt: data.createdAt
        }));
        setAccounts(accountList);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const loadWallets = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      if (response.wallets) {
        const walletList = Object.entries(response.wallets).map(([name, data]: [string, any]) => ({
          name,
          accounts: data.accounts || {},
          importType: data.importType || 'mnemonic'
        }));
        setWallets(walletList);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    }
  };

  const getNextWalletName = async (): Promise<string> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      const names = response?.wallets ? Object.keys(response.wallets) : [];
      let max = 0;
      names.forEach((name: string) => {
        const match = name.match(/^wallet(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      });
      return `wallet${max + 1 || 1}`;
    } catch {
      return 'wallet1';
    }
  };

  const handleSwitchAccount = async (walletName: string, accountIndex: number, accountAddress: string) => {
    if (accountAddress === currentAddress) return;

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      if (walletName !== currentWalletName) {
        await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: walletName } });
      }
      await chrome.runtime.sendMessage({ type: 'SWITCH_ACCOUNT', payload: { index: accountIndex } });
      showToast(`Switched to ${walletName} - Account ${accountIndex + 1}`);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onWalletSwitch?.();
      onStateChange?.();
      setTimeout(() => onClose(), 300);
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to switch account' });
    } finally {
      setLoading(false);
    }
  };

  // UX: click the "Current wallet" name to rename in-place (no separate Rename buttons).
  const startEditingCurrentWalletName = () => {
    if (!currentWalletName) return;
    setStatus({ type: '', message: '' });
    setIsEditingCurrentWalletName(true);
    setCurrentWalletNameDraft(currentWalletName);
  };

  const submitCurrentWalletRename = async () => {
    if (!currentWalletName) return;
    const next = currentWalletNameDraft.trim();
    if (!isValidWalletName(next)) {
      setStatus({ type: 'error', message: 'Name must be 1-12 letters/numbers (no spaces or symbols)' });
      return;
    }
    if (next === currentWalletName) {
      setIsEditingCurrentWalletName(false);
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RENAME_WALLET',
        payload: { oldName: currentWalletName, newName: next }
      });
      if (response?.success) {
        showToast(`Renamed to ${next}`);
        setIsEditingCurrentWalletName(false);
        await Promise.all([loadWallets(), loadAccounts()]);
        onAccountSwitch();
        onStateChange?.();
      }
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to rename wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_ACCOUNT' });
      showToast(`Account ${response.index + 1} created`);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onStateChange?.();
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to create account' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    // Optional name; fallback to existing walletN convention.
    const finalName = createNameInput.trim() || pendingCreateName || (await getNextWalletName());
    if (!isValidWalletName(finalName)) {
      setStatus({ type: 'error', message: 'Name must be 1-12 letters/numbers (no spaces or symbols)' });
      return;
    }
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WALLET',
        payload: { name: finalName, showMnemonic: true }
      });
      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setCreatedMnemonic(response.mnemonic || '');
        setShowCreatedMnemonic(false);
        setCreatedWalletName(finalName);
        setCreateStep('success');
        setCreateNameInput('');
        setPendingCreateName(await getNextWalletName());
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to create wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWalletDone = async () => {
    setLoading(true);
    try {
      await Promise.all([loadWallets(), loadAccounts()]);
      await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: createdWalletName } });
      showToast(`Switched to ${createdWalletName}`);
      onWalletSwitch?.();
      onStateChange?.();
      setShowCreateModal(false);
      setCreateStep('form');
      setShowCreatedMnemonic(false);
      setCreatedMnemonic('');
    } catch (err) {
      setStatus({ type: 'error', message: 'Wallet created but failed to switch' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    // Optional name; fallback to existing walletN convention.
    const finalName = importNameInput.trim() || pendingImportName || (await getNextWalletName());
    if (!isValidWalletName(finalName)) {
      setStatus({ type: 'error', message: 'Name must be 1-12 letters/numbers (no spaces or symbols)' });
      return;
    }

    const payload: any = { name: finalName };

    if (importType === 'mnemonic') {
        if (!importMnemonic.trim()) {
            setStatus({ type: 'error', message: 'Please paste a recovery phrase' });
            return;
        }
        if (importMnemonic.trim().split(/\s+/).length < 12) {
            setStatus({ type: 'error', message: 'Recovery phrase looks too short' });
            return;
        }
        payload.mnemonic = importMnemonic.trim();
    } else {
        if (!importPrivateKey.trim()) {
            setStatus({ type: 'error', message: 'Please paste a private key' });
            return;
        }
        payload.privateKey = importPrivateKey.trim();
        payload.chainType = importChainType;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload
      });
      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setImportMnemonic('');
        setImportPrivateKey('');
        setImportedWalletName(finalName);
        setImportStep('success');
        setImportNameInput('');
        await Promise.all([loadWallets(), loadAccounts()]);
        await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: finalName } });
        onWalletSwitch?.();
        onStateChange?.();
        setPendingImportName(await getNextWalletName());
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Failed to import wallet' });
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  const getWalletsWithAccounts = () => {
    return wallets.map(wallet => ({
      name: wallet.name,
      importType: wallet.importType,
      accounts: Object.entries(wallet.accounts || {})
        .map(([index, data]: [string, any]) => ({
          index: parseInt(index, 10),
          address: data.address,
          createdAt: data.createdAt
        }))
        .sort((a, b) => a.index - b.index)
    }));
  };

  const currentWalletData = wallets.find(w => w.name === currentWalletName);
  const isPrivateKeyWallet = currentWalletData?.importType === 'privateKey';

  return (
    <div className="account-menu-overlay" onClick={onClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="account-menu-header">
          <div className="account-menu-title-group">
            <div className="account-menu-label">Current wallet</div>
            {isEditingCurrentWalletName ? (
              <input
                className="account-menu-title"
                value={currentWalletNameDraft}
                onChange={(e) => setCurrentWalletNameDraft(e.target.value)}
                onBlur={() => submitCurrentWalletRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCurrentWalletRename();
                  if (e.key === 'Escape') {
                    setIsEditingCurrentWalletName(false);
                    setStatus({ type: '', message: '' });
                  }
                }}
                disabled={loading}
                autoFocus
              />
            ) : (
              <div
                className="account-menu-title"
                onClick={startEditingCurrentWalletName}
                title="Click to rename (1-12 letters/numbers)"
                style={{ cursor: 'text' }}
              >
                {currentWalletName || 'Wallet'}
              </div>
            )}
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Status Alert */}
        {status.message && (
          <div className={`account-menu-alert alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
            {status.message}
          </div>
        )}

        {/* Content */}
        <div className="account-menu-section">
          {/* Section Header */}
          <div className="section-header">
            <div className="section-title">Wallets</div>
            <div className="section-actions-inline">
              <button
                className="btn btn-secondary btn-inline"
                onClick={async () => {
                  setPendingImportName(await getNextWalletName());
                  setShowImportModal(true);
                }}
              >
                Import
              </button>
              <button
                className="btn btn-primary btn-inline"
                onClick={async () => {
                  setPendingCreateName(await getNextWalletName());
                  setShowCreateModal(true);
                }}
              >
                Create
              </button>
            </div>
          </div>

          {/* Wallet List */}
          <div className="wallet-list">
            {getWalletsWithAccounts().map((wallet) => (
              <div key={wallet.name} className="wallet-group">
                <div className="wallet-group-header">
                  <span>{wallet.name}</span>
                  {wallet.importType === 'privateKey' && (
                    <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.7 }}>(Private Key)</span>
                  )}
                </div>

                <div className="account-list">
                  {wallet.accounts.map((account) => {
                    const isActive = wallet.name === currentWalletName && 
                                     account.address.toLowerCase() === currentAddress.toLowerCase();
                    return (
                    <div
                      key={`${wallet.name}-${account.index}`}
                      className={`account-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSwitchAccount(wallet.name, account.index, account.address)}
                    >
                      <div className="account-avatar">
                        {account.address.substring(2, 4).toUpperCase()}
                      </div>
                      <div className="account-details">
                        <div className="account-name">Account {account.index + 1}</div>
                        <div className="account-address">{formatAddress(account.address)}</div>
                      </div>
                      {isActive && (
                        <span className="active-badge">✓</span>
                      )}
                    </div>
                  );
                  })}

                  {wallet.name === currentWalletName && (
                    <>
                        {wallet.importType !== 'privateKey' ? (
                            <button
                            className="add-account-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCreateAccount();
                            }}
                            disabled={loading}
                            >
                            + Add account
                            </button>
                        ) : (
                            <div className="alert alert-warning" style={{ fontSize: '11px', marginTop: '4px', marginBottom: '0' }}>
                                Account creation not supported for private key wallets
                            </div>
                        )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {getWalletsWithAccounts().length === 0 && (
              <div className="empty-state">
                <p>No wallets yet</p>
                <span>Create or import one to get started.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Wallet Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{createStep === 'success' ? `Wallet: ${createdWalletName}` : 'Create wallet'}</h3>
              <button className="close-btn" onClick={() => {
                if (createStep === 'success') {
                  if (!confirm("Make sure you've saved your recovery phrase!")) return;
                }
                setShowCreateModal(false);
                setCreateStep('form');
                setCreatedMnemonic('');
              }}>×</button>
            </div>

            {status.message && createStep === 'form' && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            {createStep === 'success' && createdMnemonic && (
              <>
                <div className="mnemonic-warning">
                  <strong>⚠️ Save your recovery phrase!</strong>
                  <span>This is the only way to recover your wallet.</span>
                </div>

                <div className="mnemonic-panel">
                  <div className="mnemonic-panel-header">
                    <span>Recovery phrase</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="section-cta"
                        onClick={() => {
                          navigator.clipboard.writeText(createdMnemonic);
                          showToast('Copied!');
                        }}
                      >
                        📋 Copy
                      </button>
                      <button
                        className="section-cta"
                        onClick={() => setShowCreatedMnemonic(v => !v)}
                      >
                        {showCreatedMnemonic ? '👁️ Hide' : '👁️ Reveal'}
                      </button>
                    </div>
                  </div>
                  <MnemonicDisplay mnemonic={createdMnemonic} isRevealed={showCreatedMnemonic} />
                </div>
              </>
            )}

            {createStep === 'form' ? (
              <>
                <div className="form-group">
                  <label>Wallet name (optional)</label>
                  <input
                    value={createNameInput}
                    onChange={(e) => setCreateNameInput(e.target.value)}
                    placeholder={`Default: ${pendingCreateName}`}
                  />
                </div>
                <button className="btn btn-primary" onClick={handleCreateWallet} disabled={loading}>
                  {loading ? 'Creating...' : 'Create wallet'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={handleCreateWalletDone} disabled={loading}>
                {loading ? 'Switching...' : 'Done — Switch to wallet'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Import Wallet Modal */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import wallet</h3>
              <button className="close-btn" onClick={() => {
                setShowImportModal(false);
                setImportStep('form');
                setImportMnemonic('');
                setImportPrivateKey('');
              }}>×</button>
            </div>

            {status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            {importStep === 'form' ? (
              <>
                <div className="tabs">
                    <button 
                        className={`tab ${importType === 'mnemonic' ? 'active' : ''}`}
                        onClick={() => { setImportType('mnemonic'); setStatus({ type: '', message: '' }); }}
                    >
                        Recovery Phrase
                    </button>
                    <button 
                        className={`tab ${importType === 'privateKey' ? 'active' : ''}`}
                        onClick={() => { setImportType('privateKey'); setStatus({ type: '', message: '' }); }}
                    >
                        Private Key
                    </button>
                </div>

                <div className="form-group">
                  <label>Wallet name (optional)</label>
                  <input
                    value={importNameInput}
                    onChange={(e) => setImportNameInput(e.target.value)}
                    placeholder={`Default: ${pendingImportName}`}
                  />
                </div>

                {importType === 'mnemonic' ? (
                    <div className="form-group">
                    <label>Recovery Phrase</label>
                    <textarea
                        rows={3}
                        placeholder="Enter your 12-24 word phrase"
                        value={importMnemonic}
                        onChange={(e) => setImportMnemonic(e.target.value)}
                    />
                    </div>
                ) : (
                    <>
                        <div className="form-group">
                            <label>Chain Type</label>
                            <select 
                                value={importChainType}
                                onChange={(e) => setImportChainType(e.target.value)}
                            >
                                <option value="evm">Ethereum / EVM</option>
                                <option value="bitcoin">Bitcoin</option>
                                <option value="solana">Solana</option>
                                <option value="xrp">XRP Ledger</option>
                                <option value="ton">TON</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Private Key</label>
                            <textarea
                                rows={3}
                                placeholder="Enter raw private key"
                                value={importPrivateKey}
                                onChange={(e) => setImportPrivateKey(e.target.value)}
                            />
                        </div>
                    </>
                )}

                <button
                  className="btn btn-primary"
                  onClick={handleImportWallet}
                  disabled={loading}
                >
                  {loading ? 'Importing...' : 'Import wallet'}
                </button>
              </>
            ) : (
              <>
                <div className="alert alert-success">
                  Wallet "{importedWalletName}" imported successfully!
                </div>
                <button className="btn btn-primary" onClick={() => {
                  setShowImportModal(false);
                  setImportStep('form');
                }}>
                  Go to wallet
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default AccountMenu;