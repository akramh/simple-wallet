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
  const [createWalletName, setCreateWalletName] = useState(() => `wallet-${Math.floor(Math.random() * 1000)}`);
  const [importWalletName, setImportWalletName] = useState(() => `wallet-${Math.floor(Math.random() * 1000)}`);
  const [importMnemonic, setImportMnemonic] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [setActiveOnCreate, setSetActiveOnCreate] = useState(true);
  const [setActiveOnImport, setSetActiveOnImport] = useState(true);
  const [showCreatedMnemonic, setShowCreatedMnemonic] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState('');
  const [toast, setToast] = useState('');
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
      setTimeout(() => {
        onAccountSwitch();
        onStateChange?.();
        onClose();
      }, 300);
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
    const finalName = createWalletName.trim() || `wallet-${Math.floor(Math.random() * 1000)}`;

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
        setCreateWalletName(`wallet-${Math.floor(Math.random() * 1000)}`);
        setCreatedMnemonic(response.mnemonic || '');
        setShowCreatedMnemonic(false);
        await Promise.all([loadWallets(), loadAccounts()]);
        if (setActiveOnCreate) {
          await chrome.runtime.sendMessage({ type: 'UNLOCK_WALLET', payload: { name: finalName } });
        }
        onWalletSwitch?.();
        onStateChange?.();
        setShowCreateModal(false);
        onClose();
      }
    } catch (err) {
      console.error('Failed to create wallet:', err);
      setStatus({ type: 'error', message: 'Failed to create wallet' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    const finalName = importWalletName.trim() || `wallet-${Math.floor(Math.random() * 1000)}`;
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
        setImportWalletName(`wallet-${Math.floor(Math.random() * 1000)}`);
        await Promise.all([loadWallets(), loadAccounts()]);
        if (setActiveOnImport) {
          await chrome.runtime.sendMessage({ type: 'UNLOCK_WALLET', payload: { name: finalName } });
        }
        onWalletSwitch?.();
        onStateChange?.();
        setShowImportModal(false);
        onClose();
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
              <button className="section-cta" onClick={() => setShowImportModal(true)}>
                Import
              </button>
              <button className="section-cta" onClick={() => setShowCreateModal(true)}>
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
                <div className="section-sub">Optional name; defaults auto.</div>
              </div>
              <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            {status.type && status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            <input
              type="text"
              placeholder="Wallet name (optional)"
              value={createWalletName}
              onChange={(e) => setCreateWalletName(e.target.value)}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={setActiveOnCreate}
                onChange={(e) => setSetActiveOnCreate(e.target.checked)}
              />
              <span>Set as active after creating</span>
            </label>

            {createdMnemonic && (
              <>
                {/* Keep the phrase masked by default to avoid accidental exposure */}
                <div className="mnemonic-panel">
                  <div className="mnemonic-panel-header">
                    <span>Recovery phrase</span>
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

            <button
              className="btn btn-primary"
              onClick={handleCreateWallet}
              disabled={loading}
            >
              {loading ? 'Working...' : 'Create wallet'}
            </button>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-title">Import wallet</div>
                <div className="section-sub">Paste a recovery phrase (12+ words).</div>
              </div>
              <button className="close-btn" onClick={() => setShowImportModal(false)}>×</button>
            </div>

            {status.type && status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            <input
              type="text"
              placeholder="Wallet name (optional)"
              value={importWalletName}
              onChange={(e) => setImportWalletName(e.target.value)}
            />

            <textarea
              rows={3}
              placeholder="Recovery phrase"
              value={importMnemonic}
              onChange={(e) => setImportMnemonic(e.target.value)}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={setActiveOnImport}
                onChange={(e) => setSetActiveOnImport(e.target.checked)}
              />
              <span>Set as active after import</span>
            </label>

            <button
              className="btn btn-primary"
              onClick={handleImportWallet}
              disabled={loading || importMnemonic.trim().split(/\s+/).length < 12}
            >
              {loading ? 'Working...' : 'Import wallet'}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default AccountMenu;
