/**
 * AccountMenu Component
 * 
 * A comprehensive modal for managing wallets and accounts in the Chrome extension.
 * Displays a hierarchical view of all wallets with their associated accounts.
 * 
 * Features:
 * - View all wallets grouped with their accounts
 * - Switch between accounts (automatically switches wallet if needed)
 * - Create new accounts within the active wallet
 * - Create new wallets (with mnemonic display)
 * - Import existing wallets via mnemonic phrase
 * - Search/filter wallets and accounts
 * - Visual indicators for active account
 * 
 * Hierarchy: Wallet → Accounts (multiple accounts per wallet)
 */
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
  onAccountSwitch: () => void; // Called when account is switched/created (doesn't close menu)
  onWalletSwitch?: () => void; // Called when wallet is switched/created (closes menu)
  onStateChange?: () => void; // Generic state change notification
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

  // Load accounts and wallets on mount
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

  /**
   * Load all accounts for the current wallet from the background service
   */
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

  /**
   * Load all wallets (with their accounts) from the background service
   */
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

  /**
   * Generate the next available wallet name (wallet1, wallet2, etc.)
   */
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

  /**
   * Switch to a specific account, automatically switching wallet if needed
   * This handles cross-wallet account switching transparently
   * 
   * @param walletName - The wallet containing the target account
   * @param accountIndex - The account index within the wallet
   * @param accountAddress - The address to switch to
   */
  const handleSwitchAccount = async (walletName: string, accountIndex: number, accountAddress: string) => {
    if (accountAddress === currentAddress) {
      return; // Already active
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      // If account belongs to a different wallet, switch wallet first
      if (walletName !== currentWalletName) {
        await chrome.runtime.sendMessage({
          type: 'SWITCH_WALLET',
          payload: { name: walletName }
        });
        // After switching wallet, the account should be active if it's the default
        // But we still need to explicitly switch to the desired account
      }
      
      // Now switch to the specific account
      await chrome.runtime.sendMessage({
        type: 'SWITCH_ACCOUNT',
        payload: { index: accountIndex }
      });
      
      setToast(`Switched to ${walletName} - Account ${accountIndex + 1}`);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 2000);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onWalletSwitch?.();
      onStateChange?.();
      setTimeout(() => onClose(), 300);
    } catch (err) {
      console.error('Failed to switch account:', err);
      setStatus({ type: 'error', message: 'Failed to switch account' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create a new account in the currently active wallet
   * The menu stays open after creation so user can see the new account
   */
  const handleCreateAccount = async () => {
    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_ACCOUNT' });
      setToast(`Account ${response.index + 1} created`);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 2000);
      await loadAccounts();
      await loadWallets();
      onAccountSwitch();
      onStateChange?.();
      // Don't close the menu - keep it open so user can see the new account
    } catch (err) {
      console.error('Failed to create account:', err);
      setStatus({ type: 'error', message: 'Failed to create account' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Switch to a different wallet
   * This will also switch to the wallet's default account
   */
  const handleSwitchWallet = async (walletName: string) => {
    if (walletName === currentWalletName) {
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SWITCH_WALLET',
        payload: { name: walletName }
      });

      if (response.error) {
        setStatus({ type: 'error', message: response.error });
      } else {
        setToast(`Switched to ${walletName}`);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), 2000);
        await Promise.all([loadWallets(), loadAccounts()]);
        onWalletSwitch?.();
        onStateChange?.();
        setTimeout(() => onClose(), 300);
      }
    } catch (err) {
      console.error('Failed to switch wallet:', err);
      setStatus({ type: 'error', message: 'Failed to switch wallet' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create a new wallet with a generated mnemonic
   * Shows the mnemonic to the user before switching to the new wallet
   */
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
        // Store the mnemonic and show success step
        setCreatedMnemonic(response.mnemonic || '');
        setShowCreatedMnemonic(false); // Start hidden for security
        setCreatedWalletName(finalName);
        setCreateStep('success');
        setPendingCreateName(await getNextWalletName());
      }
    } catch (err) {
      console.error('Failed to create wallet:', err);
      setStatus({ type: 'error', message: 'Failed to create wallet' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Complete wallet creation flow by switching to the newly created wallet
   * Called after user confirms they've saved the mnemonic
   */
  const handleCreateWalletDone = async () => {
    // Now switch to the newly created wallet
    setLoading(true);
    try {
      await Promise.all([loadWallets(), loadAccounts()]);
      await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: createdWalletName } });
      setToast(`Switched to ${createdWalletName}`);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 2000);
      onWalletSwitch?.();
      onStateChange?.();
      
      // Reset modal state
      setShowCreateModal(false);
      setCreateStep('form');
      setShowCreatedMnemonic(false);
      setCreatedMnemonic('');
      setStatus({ type: '', message: '' });
    } catch (err) {
      console.error('Failed to switch to new wallet:', err);
      setStatus({ type: 'error', message: 'Wallet created but failed to switch to it' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Import an existing wallet using a mnemonic phrase
   * Validates the mnemonic and creates the wallet if valid
   */
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
        // Switch to the newly imported wallet
        await chrome.runtime.sendMessage({ type: 'SWITCH_WALLET', payload: { name: finalName } });
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

  /**
   * Build hierarchical structure grouping accounts under their wallets
   * Applies search filtering across wallet names and account addresses
   */
  const getWalletsWithAccounts = () => {
    return wallets.map(wallet => {
      const walletAccounts = Object.entries(wallet.accounts || {}).map(([index, data]: [string, any]) => ({
        index: parseInt(index, 10),
        address: data.address,
        createdAt: data.createdAt
      })).sort((a, b) => a.index - b.index);
      
      return {
        name: wallet.name,
        accounts: walletAccounts
      };
    }).filter(wallet => {
      // Apply search filter
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return wallet.name.toLowerCase().includes(term) || 
             wallet.accounts.some(acc => 
               acc.address.toLowerCase().includes(term) || 
               `account ${acc.index + 1}`.toLowerCase().includes(term)
             );
    });
  };

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
              <div className="section-title">Wallets</div>
              <div className="section-sub">Tap an account to switch. Total: ${wallets.reduce((sum, w) => sum + (w.accounts ? Object.keys(w.accounts).length : 0), 0) * 0.00}</div>
            </div>
            <div className="section-actions-inline">
              <button className="section-cta" onClick={async () => {
                setPendingImportName(await getNextWalletName());
                setShowImportModal(true);
              }}>
                Import wallet
              </button>
              <button className="section-cta" onClick={async () => {
                setPendingCreateName(await getNextWalletName());
                setShowCreateModal(true);
              }}>
                Create wallet
              </button>
            </div>
          </div>

          <input
            className="account-search"
            placeholder="Search wallets or accounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="wallet-list">
            {getWalletsWithAccounts().map((wallet) => (
              <div key={wallet.name} className="wallet-group">
                <div className="wallet-group-header">
                  {wallet.name.toUpperCase()}
                </div>
                
                <div className="account-list">
                  {wallet.accounts.map((account) => (
                    <div
                      key={`${wallet.name}-${account.index}`}
                      className={`account-item ${account.address === currentAddress ? 'active' : ''}`}
                      onClick={() => handleSwitchAccount(wallet.name, account.index, account.address)}
                    >
                      <div className="account-avatar">
                        {account.address.substring(2, 4).toUpperCase()}
                      </div>
                      <div className="account-details">
                        <div className="account-name">Account {account.index + 1}</div>
                        <div className="account-address">{formatAddress(account.address)}</div>
                        <div className="account-balance">$0.00</div>
                      </div>
                      <div className="account-actions">
                        {account.address === currentAddress && (
                          <span className="active-badge">✓</span>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {wallet.name === currentWalletName && (
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
                  )}
                </div>
              </div>
            ))}

            {getWalletsWithAccounts().length === 0 && (
              <div className="empty-state" style={{ padding: '16px' }}>
                <p>No wallets match that search.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={(e) => {
          if (createStep === 'success') {
            e.stopPropagation(); // Prevent closing when showing mnemonic
          } else {
            setShowCreateModal(false);
          }
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="section-title">Create wallet</div>
                <div className="section-sub">
                  {createStep === 'success' 
                    ? `Wallet created: ${createdWalletName}` 
                    : `New wallet will be named: ${pendingCreateName}`}
                </div>
              </div>
              <button 
                className="close-btn" 
                onClick={() => {
                  if (createStep === 'success') {
                    const confirmed = confirm('Are you sure? Make sure you\'ve saved your recovery phrase!');
                    if (!confirmed) return;
                  }
                  setShowCreateModal(false);
                  setCreateStep('form');
                  setShowCreatedMnemonic(false);
                  setCreatedMnemonic('');
                  setStatus({ type: '', message: '' });
                }}
              >×</button>
            </div>

            {status.type && status.message && (
              <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {status.message}
              </div>
            )}

            {createStep === 'success' && createdMnemonic && (
              <>
                <div className="alert" style={{ 
                  background: '#fef3c7', 
                  borderColor: '#fbbf24', 
                  color: '#92400e',
                  marginBottom: '16px'
                }}>
                  <strong>⚠️ Save your recovery phrase!</strong>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    This is the only way to recover your wallet. Store it somewhere safe.
                  </div>
                </div>
                
                <div className="mnemonic-panel">
                  <div className="mnemonic-panel-header">
                    <span>Recovery phrase — {createdWalletName}</span>
                    <div className="mnemonic-actions">
                      <button
                        className="btn btn-secondary btn-inline"
                        onClick={() => {
                          navigator.clipboard.writeText(createdMnemonic);
                          setToast('Copied to clipboard');
                          if (toastTimer.current) clearTimeout(toastTimer.current);
                          toastTimer.current = setTimeout(() => setToast(''), 2000);
                        }}
                      >
                        📋 Copy
                      </button>
                      <button
                        className="btn btn-secondary btn-inline"
                        onClick={() => setShowCreatedMnemonic(v => !v)}
                      >
                        {showCreatedMnemonic ? '👁️ Hide' : '👁️ Reveal'}
                      </button>
                    </div>
                  </div>
                  <div className={`mnemonic-box inline ${showCreatedMnemonic ? 'revealed' : 'masked'}`}>
                    {showCreatedMnemonic ? createdMnemonic : '•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••'}
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
                onClick={handleCreateWalletDone}
                disabled={loading}
              >
                {loading ? 'Switching...' : 'Done — Switch to this wallet'}
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
                <div className="section-sub">New wallet will be named: {pendingImportName}</div>
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
