import React, { useState, useEffect } from 'react';

interface Account {
  index: number;
  address: string;
  createdAt?: string;
}

interface WalletMeta {
  name: string;
  accounts: Record<number, { address: string; createdAt: string }>;
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success' | '';
    message: string; }>({ type: '', message: '' });
  const [search, setSearch] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'success'>('form');
  const [importStep, setImportStep] = useState<'form' | 'success'>('form');
  const [showCreatedMnemonic, setShowCreatedMnemonic] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState('');
  const [createdWalletName, setCreatedWalletName] = useState('');
  const [importedWalletName, setImportedWalletName] = useState('');
  const [toast, setToast] = useState('');
  const [pendingCreateName, setPendingCreateName] = useState<string>('wallet1');
  const [pendingImportName, setPendingImportName] = useState<string>('wallet1');
  const toastTimer = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadAccounts();
    loadWallets();
    return () => {
      setStatus({ type: '', message: '' });
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
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
          accounts: data.accounts || {}
        }));
        setWallets(walletList);
      }
    } catch (err) {
      console.error('Failed to load wallets:', err);
    }
  };

  const getNextWalletName = async (): Promise<string> => {
    const base = 'wallet';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      const names = response?.wallets ? Object.keys(response.wallets) : [];
      let max = 0;
      names.forEach((name: string) => {
        const match = name.match(/^wallet(\d+)$/);
        if (match) {
          max = Math.max(max, parseInt(match[1], 10));
        }
      });
      return `${base}${max + 1 || 1}`;
    } catch (err) {
      console.warn('Failed to compute next wallet name, defaulting to wallet1', err);
      return `${base}1`;
    }
  };

  const handleSwitchAccount = async (index: number) => {
    const account = accounts.find(a => a.index === index);
    if (account?.address === currentAddress) {
      return; // Already active
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      await chrome.runtime.sendMessage({
        type: 'SWITCH_ACCOUNT',
        payload: { index }
      });
      await loadAccounts();
      onAccountSwitch();
      onStateChange?.();
      onClose();
    } catch (err) {
      console.error('Failed to switch account:', err);
      setStatus({ type: 'error', message: 'Failed to switch account' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      await chrome.runtime.sendMessage({ type: 'CREATE_ACCOUNT' });
      await loadAccounts();
      onAccountSwitch();
      onStateChange?.();
      setStatus({ type: 'success', message: 'Account created and selected' });
    } catch (err) {
      console.error('Failed to create account:', err);
      setStatus({ type: 'error', message: 'Failed to create account' });
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchWallet = async (walletName: string) => {
    if (walletName === currentWalletName) {
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UNLOCK_WALLET',
        payload: { name: walletName }
      });

      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setStatus({ type: 'success', message: `Switched to wallet "${walletName}"` });
        await Promise.all([loadWallets(), loadAccounts()]);
        onWalletSwitch?.();
        onStateChange?.();
        onClose();
      }
    } catch (err) {
      console.error('Failed to switch wallet:', err);
      setStatus({ type: 'error', message: 'Failed to switch wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWallet = async () => {
    const finalName = pendingCreateName || (await getNextWalletName());

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WALLET',
        payload: { name: finalName }
      });

      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setStatus({ type: 'success', message: `Created wallet "${finalName}"` });
        setCreatedMnemonic(response.mnemonic || '');
        setShowCreatedMnemonic(true);
        setCreatedWalletName(finalName);
        setCreateStep('success');
        await Promise.all([loadWallets(), loadAccounts()]);
        await chrome.runtime.sendMessage({ type: 'UNLOCK_WALLET', payload: { name: finalName } });
        onWalletSwitch?.();
        onStateChange?.();
        setPendingCreateName(await getNextWalletName());
      }
    } catch (err) {
      console.error('Failed to create wallet:', err);
      setStatus({ type: 'error', message: 'Failed to create wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    const finalName = pendingImportName || (await getNextWalletName());
    if (!importMnemonic.trim()) {
      setStatus({ type: 'error', message: 'Please paste a recovery phrase' });
      return;
    }
    if (importMnemonic.trim().split(/\s+/).length < 12) {
      setStatus({ type: 'error', message: 'Recovery phrase looks too short' });
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: importMnemonic.trim(), name: finalName }
      });

      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setStatus({ type: 'success', message: `Imported wallet "${finalName}"` });
        setImportMnemonic('');
        setImportedWalletName(finalName);
        setImportStep('success');
        await Promise.all([loadWallets(), loadAccounts()]);
        await chrome.runtime.sendMessage({ type: 'UNLOCK_WALLET', payload: { name: finalName } });
        onWalletSwitch?.();
        onStateChange?.();
        setPendingImportName(await getNextWalletName());
      }
    } catch (err) {
      console.error('Failed to import wallet:', err);
      setStatus({ type: 'error', message: 'Failed to import wallet' });
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  const handleCopyAddress = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
  };

  const filteredAccounts = accounts
    .filter(account => {
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return account.address.toLowerCase().includes(term) || `account ${account.index + 1}`.includes(term);
    })
    .sort((a, b) => {
      const aActive = a.address === currentAddress ? -1 : 0;
      const bActive = b.address === currentAddress ? -1 : 0;
      return aActive - bActive || a.index - b.index;
    });

  return (
    <div className="account-menu-overlay" onClick={onClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()}>
        <div className="account-menu-header">
          <div className="account-menu-title-group">
            <div className="account-menu-label">Current wallet</div>
            <div className="account-menu-title">{currentWalletName || 'Wallet'}</div>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {(() => {
          const activeAccount = accounts.find(a => a.address === currentAddress);
          if (!activeAccount) return null;
          return (
            <div className="account-menu-section" style={{ paddingBottom: 0 }}>
              <div className="section-title" style={{ marginBottom: 4 }}>Active wallet & account</div>
              <div className="account-item active" style={{ cursor: 'default' }}>
                <div className="account-details" style={{ gap: 4 }}>
                  <div className="account-name">{currentWalletName || 'Wallet'} — Account {activeAccount.index + 1}</div>
                  <div className="account-address">{formatAddress(activeAccount.address)}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {(() => {
          const activeAccount = accounts.find(a => a.address === currentAddress);
          if (!activeAccount) return null;
          return (
            <div className="account-menu-section" style={{ paddingBottom: 0 }}>
              <div className="section-title" style={{ marginBottom: 4 }}>Active account</div>
              <div className="account-item active" style={{ cursor: 'default' }}>
                <div className="account-avatar">{activeAccount.address.substring(2, 4).toUpperCase()}</div>
                <div className="account-details">
                  <div className="account-name">Account {activeAccount.index + 1}</div>
                  <div className="account-address">{formatAddress(activeAccount.address)}</div>
                </div>
                <span className="active-badge">✓</span>
              </div>
            </div>
          );
        })()}

        {status.message && (
          <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'} account-menu-alert`}>
            {status.message}
          </div>
        )}

        <div className="account-menu-section">
          <div className="section-header">
            <div>
              <div className="section-title">Accounts</div>
              <div className="section-sub">Tap an account to switch.</div>
            </div>
            <button
              className="section-cta"
              onClick={handleCreateAccount}
              disabled={loading}
            >
              {loading ? 'Working...' : '+ Add account'}
            </button>
          </div>

          <input
            className="account-search"
            placeholder="Search by name or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="account-list">
            {filteredAccounts.map((account) => (
              <div
                key={account.index}
                className={`account-item ${account.address === currentAddress ? 'active' : ''}`}
                onClick={() => handleSwitchAccount(account.index)}
              >
                <div className="account-avatar">
                  {account.address.substring(2, 4).toUpperCase()}
                </div>
                <div className="account-details">
                  <div className="account-name">Account {account.index + 1}</div>
                  <div className="account-address">{formatAddress(account.address)}</div>
                </div>
                <div className="account-actions">
                  {account.address === currentAddress && (
                    <span className="active-badge">✓</span>
                  )}
                  <button
                    className="copy-icon-btn"
                    onClick={(e) => handleCopyAddress(account.address, e)}
                    title="Copy address"
                  >
                    📋
                  </button>
                </div>
              </div>
            ))}

            {filteredAccounts.length === 0 && (
              <div className="empty-state" style={{ padding: '16px' }}>
                <p>No accounts match that search.</p>
              </div>
            )}
          </div>
        </div>

        <div className="account-menu-section">
          <div className="section-header">
            <div>
              <div className="section-title">Wallets</div>
              <div className="section-sub">Switch or add a wallet.</div>
            </div>
            <div className="section-actions-inline">
              <button className="section-cta" onClick={async () => {
                setPendingImportName(await getNextWalletName());
                setShowImportModal(true);
              }}>
                Import
              </button>
              <button className="section-cta" onClick={async () => {
                setPendingCreateName(await getNextWalletName());
                setShowCreateModal(true);
              }}>
                Create
              </button>
            </div>
          </div>

          <div className="wallet-chip-row">
            {wallets
              .slice()
              .sort((a, b) => {
                if (a.name === currentWalletName) return -1;
                if (b.name === currentWalletName) return 1;
                return a.name.localeCompare(b.name);
              })
              .map(wallet => (
                <button
                  key={wallet.name}
                  className={`wallet-chip ${wallet.name === currentWalletName ? 'active' : ''}`}
                  onClick={() => handleSwitchWallet(wallet.name)}
                  disabled={loading}
                >
                  <div className="wallet-chip-name">{wallet.name}</div>
                  <div className="wallet-chip-sub">{Object.keys(wallet.accounts || {}).length} account(s)</div>
                  {wallet.name === currentWalletName && <span className="wallet-chip-pill">Active</span>}
                </button>
              ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-title">Create wallet</div>
                <div className="section-sub">Auto-named: {pendingCreateName}</div>
              </div>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            {status.type && status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            {createStep === 'success' && createdMnemonic && (
              <>
                {/* Keep the phrase masked by default to avoid accidental exposure */}
                <div className="mnemonic-panel">
                  <div className="mnemonic-panel-header">
                    <span>Recovery phrase — {createdWalletName}</span>
                    <div className="mnemonic-actions">
                      <button
                        className="btn btn-secondary btn-inline"
                        onClick={() => {
                          navigator.clipboard.writeText(createdMnemonic);
                          setToast('Copied');
                          if (toastTimer.current) clearTimeout(toastTimer.current);
                          toastTimer.current = setTimeout(() => setToast(''), 1400);
                        }}
                      >
                        Copy
                      </button>
                      <button
                        className="btn btn-secondary btn-inline"
                        onClick={() => setShowCreatedMnemonic(v => !v)}
                      >
                        {showCreatedMnemonic ? 'Hide' : 'Reveal'}
                      </button>
                    </div>
                  </div>
                  <div className={`mnemonic-box inline ${showCreatedMnemonic ? 'revealed' : 'masked'}`}>
                    {showCreatedMnemonic ? createdMnemonic : '•••• •••• •••• •••• •••• •••• •••• ••••'}
                  </div>
                </div>
              </>
            )}

            {createStep === 'form' && (
              <button
                className="btn btn-primary"
                onClick={handleCreateWallet}
                disabled={loading}
              >
                {loading ? 'Working...' : 'Create wallet'}
              </button>
            )}

            {createStep === 'success' && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateStep('form');
                  setShowCreatedMnemonic(false);
                  setStatus({ type: '', message: '' });
                }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-title">Import wallet</div>
                <div className="section-sub">Auto-named: {pendingImportName}</div>
              </div>
              <button className="close-btn" onClick={() => setShowImportModal(false)}>×</button>
            </div>

            {status.type && status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            {importStep === 'form' && (
              <>
                <textarea
                  rows={3}
                  placeholder="Recovery phrase"
                  value={importMnemonic}
                  onChange={(e) => setImportMnemonic(e.target.value)}
                />

                <button
                  className="btn btn-primary"
                  onClick={handleImportWallet}
                  disabled={loading || importMnemonic.trim().split(/\s+/).length < 12}
                >
                  {loading ? 'Working...' : 'Import wallet'}
                </button>
              </>
            )}

            {importStep === 'success' && (
              <>
                <div className="alert alert-success" style={{ marginBottom: '12px' }}>
                  Wallet {importedWalletName || pendingImportName} imported and unlocked.
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportStep('form');
                    setStatus({ type: '', message: '' });
                  }}
                >
                  Go to wallet
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default AccountMenu;
