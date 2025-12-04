import React, { useState, useEffect } from 'react';

interface Account {
  index: number;
  address: string;
  createdAt?: string;
}

interface Wallet {
  name: string;
  accounts: Record<number, { address: string; createdAt: string }>;
}

interface Props {
  currentAddress: string;
  onAccountSwitch: () => void;
  onWalletSwitch: () => void;
  onStateChange?: () => void;
  onClose?: () => void;
}

function SettingsView({ currentAddress, onAccountSwitch, onWalletSwitch, onStateChange, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'wallets' | 'advanced'>('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [currentWalletName, setCurrentWalletName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [createMnemonic, setCreateMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const copyTimer = React.useRef<NodeJS.Timeout | null>(null);
  const [createWalletName, setCreateWalletName] = useState('wallet-' + Math.floor(Math.random() * 1000));
  const [importWalletName, setImportWalletName] = useState('wallet-' + Math.floor(Math.random() * 1000));
  const [importMnemonic, setImportMnemonic] = useState('');

  useEffect(() => {
    loadAccounts();
    loadWallets();

    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
      if (response.accounts) {
        const accountList = Object.entries(response.accounts).map(([index, data]: [string, any]) => ({
          index: parseInt(index),
          address: data.address,
          createdAt: data.createdAt
        }));
        setAccounts(accountList);
        if (response.currentWalletName) {
          setCurrentWalletName(response.currentWalletName);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load accounts');
    }
  };

  const loadWallets = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      if (response.wallets) {
        const walletList = Object.entries(response.wallets).map(([name, data]: [string, any]) => ({
          name,
          accounts: data.accounts || {}
        }));
        setWallets(walletList);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load wallets');
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_ACCOUNT' });
      if (response.error) {
        setError(response.error);
      } else {
        setSuccess(`✓ Created and switched to Account ${response.index + 1}`);
        // Reload accounts list to show the new account
        await loadAccounts();
        // Notify parent to update UI (account switched automatically in backend)
        setTimeout(() => {
          onAccountSwitch();
          onStateChange?.();
        }, 800);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchAccount = async (index: number) => {
    if (accounts.find(a => a.index === index)?.address === currentAddress) {
      return; // Already on this account
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SWITCH_ACCOUNT',
        payload: { index }
      });

      if (response.error) {
        setError(response.error);
      } else {
        setSuccess(`✓ Switched to Account ${index + 1}`);
        setTimeout(() => {
          onAccountSwitch();
          onStateChange?.();
        }, 300);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to switch account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWallet = async (walletName: string) => {
    if (!confirm(`Are you sure you want to delete wallet "${walletName}"? This cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_WALLET',
        payload: { name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        setSuccess(`Deleted wallet: ${walletName}`);
        await loadWallets();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete wallet');
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const handleSwitchWallet = async (walletName: string) => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UNLOCK_WALLET',
        payload: { name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        setSuccess(`Switched to wallet "${walletName}"`);
        await loadWallets();
        await loadAccounts();
        onWalletSwitch();
        onStateChange?.();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to switch wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    if (!createWalletName.trim()) {
      setCreateError('Please enter a wallet name');
      return;
    }

    setLoading(true);
    setCreateError('');
    setCreateSuccess('');
    setCreateMnemonic('');
    setShowMnemonic(false);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WALLET',
        payload: { name: createWalletName.trim() }
      });
      if (response.error) {
        setCreateError(response.error);
      } else {
        setCreateSuccess(`Wallet "${createWalletName}" created.`);
        setCreateMnemonic(response.mnemonic || '');
        setShowMnemonic(false);
        setCreateWalletName('wallet-' + Math.floor(Math.random() * 1000));
        await loadWallets();
        await loadAccounts();
        onWalletSwitch();
        onStateChange?.();
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    if (!importWalletName.trim()) {
      setImportError('Please enter a wallet name');
      return;
    }
    if (!importMnemonic.trim()) {
      setImportError('Please enter the recovery phrase');
      return;
    }
    const words = importMnemonic.trim().split(/\\s+/);
    if (words.length < 12) {
      setImportError('Recovery phrase looks too short');
      return;
    }

    setLoading(true);
    setImportError('');
    setImportSuccess('');
    setSuccess('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: importMnemonic.trim(), name: importWalletName.trim() }
      });

      if (response.error) {
        setImportError(response.error);
      } else {
        setImportSuccess(`Wallet "${importWalletName}" imported.`);
        setImportMnemonic('');
        setImportWalletName('wallet-' + Math.floor(Math.random() * 1000));
        await loadWallets();
        await loadAccounts();
        onWalletSwitch();
        onStateChange?.();
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="settings-header">
        <div className="settings-title">Settings</div>
        {onClose && (
          <button className="btn btn-secondary btn-inline settings-back-btn" onClick={onClose}>
            ← Back to wallet
          </button>
        )}
      </div>
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          Accounts
        </button>
        <button
          className={`tab ${activeTab === 'wallets' ? 'active' : ''}`}
          onClick={() => setActiveTab('wallets')}
        >
          Wallets
        </button>
        <button
          className={`tab ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced')}
        >
          Advanced
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {activeTab === 'accounts' && (
        <div>
          {currentWalletName && (
            <div style={{ marginBottom: '12px', padding: '12px', background: '#f3f4f6', borderRadius: '8px', fontSize: '13px' }}>
              <strong>Current Wallet:</strong> {currentWalletName}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={handleCreateAccount}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create New Account'}
            </button>
          </div>

          <div className="token-list">
            {accounts.map((account) => (
              <div
                key={account.index}
                className="token-item"
                style={{
                  cursor: 'pointer',
                  background: account.address === currentAddress ? '#e0e7ff' : undefined
                }}
                onClick={() => handleSwitchAccount(account.index)}
              >
                <div className="token-info">
                  <div className="token-icon">
                    {account.index + 1}
                  </div>
                  <div className="token-details">
                    <h3>Account {account.index + 1}</h3>
                    <p style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {formatAddress(account.address)}
                    </p>
                  </div>
                </div>
                {account.address === currentAddress && (
                  <div style={{ color: '#6366f1', fontWeight: 600, fontSize: '12px' }}>
                    ACTIVE
                  </div>
                )}
              </div>
            ))}
          </div>

          {accounts.length === 0 && (
            <div className="loading">No accounts found</div>
          )}
        </div>
      )}

      {activeTab === 'wallets' && (
        <div className="wallets-pane">
          {(createError || createSuccess) && (
            <div className={`alert ${createError ? 'alert-error' : 'alert-success'}`}>
              {createError || createSuccess}
            </div>
          )}

          {createMnemonic && (
            <div className="alert alert-success mnemonic-alert">
              <div className="mnemonic-row">
                <span>Recovery phrase ready.</span>
                <div className="mnemonic-actions">
                  <button
                    className="btn btn-secondary btn-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(createMnemonic);
                      setCopyNotice('Copied recovery phrase');
                      if (copyTimer.current) {
                        clearTimeout(copyTimer.current);
                      }
                      copyTimer.current = setTimeout(() => setCopyNotice(''), 1600);
                    }}
                  >
                    Copy
                  </button>
                  <button
                    className="btn btn-secondary btn-inline"
                    onClick={() => setShowMnemonic(prev => !prev)}
                  >
                    {showMnemonic ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {showMnemonic && (
                <div className="mnemonic-box inline">
                  {createMnemonic}
                </div>
              )}
            </div>
          )}

          {(importError || importSuccess) && (
            <div className={`alert ${importError ? 'alert-error' : 'alert-success'}`}>
              {importError || importSuccess}
            </div>
          )}

          {copyNotice && (
            <div className="alert alert-success" style={{ marginTop: -4 }}>
              {copyNotice}
            </div>
          )}

          <div className="wallets-actions">
            <div className="wallet-action-card">
              <div className="wallet-action-header">
                <h4>Create wallet</h4>
                <p>Uses your master password automatically.</p>
              </div>
              <div className="wallet-action-body">
                <input
                  type="text"
                  placeholder="Wallet name"
                  value={createWalletName}
                  onChange={e => setCreateWalletName(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleCreateWallet}
                  disabled={loading || !createWalletName.trim()}
                >
                  {loading ? 'Working...' : 'Create'}
                </button>
              </div>
            </div>

            <div className="wallet-action-card">
              <div className="wallet-action-header">
                <h4>Import wallet</h4>
                <p>Paste a recovery phrase. Master password is reused.</p>
              </div>
              <div className="wallet-action-body">
                <input
                  type="text"
                  placeholder="Wallet name"
                  value={importWalletName}
                  onChange={e => setImportWalletName(e.target.value)}
                />
                <textarea
                  placeholder="Recovery phrase"
                  value={importMnemonic}
                  onChange={e => setImportMnemonic(e.target.value)}
                  rows={3}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleImportWallet}
                  disabled={loading || importMnemonic.trim().split(/\s+/).length < 12 || !importWalletName.trim()}
                >
                  {loading ? 'Working...' : 'Import'}
                </button>
              </div>
            </div>
          </div>

          <div className="wallet-list">
            {wallets
              .slice()
              .sort((a, b) => {
                if (a.name === currentWalletName) return -1;
                if (b.name === currentWalletName) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((wallet) => (
              <div
                key={wallet.name}
                className={`wallet-list-item ${wallet.name === currentWalletName ? 'active' : ''}`}
              >
                <div className="wallet-list-meta">
                  <div className="wallet-list-title">{wallet.name}</div>
                  <div className="wallet-list-sub">{Object.keys(wallet.accounts).length} account(s)</div>
                </div>
                <div className="wallet-list-actions">
                  {wallet.name === currentWalletName ? (
                    <span className="wallet-pill">Active</span>
                  ) : (
                    <button
                      className="btn btn-secondary btn-inline"
                      onClick={() => handleSwitchWallet(wallet.name)}
                      disabled={loading}
                    >
                      Switch
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-inline"
                    onClick={() => handleDeleteWallet(wallet.name)}
                    disabled={loading || wallets.length === 1}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {wallets.length === 0 && (
            <div className="loading">No wallets found</div>
          )}
        </div>
      )}

      {activeTab === 'advanced' && (
        <div>
          <div className="form-group">
            <label>Export Recovery Phrase</label>
            <button className="btn btn-secondary">
              View Recovery Phrase
            </button>
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
              Warning: Never share your recovery phrase with anyone.
            </p>
          </div>

          <div className="form-group">
            <label>Export Private Key</label>
            <button className="btn btn-secondary">
              View Private Key
            </button>
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
              Warning: Anyone with your private key can access your funds.
            </p>
          </div>

          <div className="form-group">
            <label>About</label>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>
              <p>Simple Crypto Wallet v1.0.0</p>
              <p>Chrome Extension</p>
              <p style={{ marginTop: '8px' }}>
                This is a demo wallet. For production use, consider hardware wallets.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsView;
