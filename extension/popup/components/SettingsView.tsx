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
}

function SettingsView({ currentAddress, onAccountSwitch, onWalletSwitch }: Props) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'wallets' | 'advanced'>('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [currentWalletName, setCurrentWalletName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadAccounts();
    loadWallets();
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

  return (
    <div>
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
        <div>
          <div className="token-list">
            {wallets.map((wallet) => (
              <div key={wallet.name} className="token-item">
                <div className="token-info">
                  <div className="token-icon">
                    W
                  </div>
                  <div className="token-details">
                    <h3>{wallet.name}</h3>
                    <p>{Object.keys(wallet.accounts).length} account(s)</p>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => handleDeleteWallet(wallet.name)}
                  disabled={loading || wallets.length === 1}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {wallets.length === 0 && (
            <div className="loading">No wallets found</div>
          )}

          <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', fontSize: '13px' }}>
            <strong>Note:</strong> To create or import a new wallet, lock the current wallet first.
          </div>
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
