import React, { useState, useEffect } from 'react';

interface Account {
  index: number;
  address: string;
  createdAt?: string;
}

interface Props {
  currentAddress: string;
  onClose: () => void;
  onAccountSwitch: () => void;
  onOpenSettings: () => void;
  onStateChange?: () => void;
}

function AccountMenu({ currentAddress, onClose, onAccountSwitch, onOpenSettings, onStateChange }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAccounts();
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
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  const handleSwitchAccount = async (index: number) => {
    const account = accounts.find(a => a.index === index);
    if (account?.address === currentAddress) {
      return; // Already active
    }

    setLoading(true);
    try {
      await chrome.runtime.sendMessage({
        type: 'SWITCH_ACCOUNT',
        payload: { index }
      });
      onAccountSwitch();
      onStateChange?.();
      onClose();
    } catch (err) {
      console.error('Failed to switch account:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const handleCopyAddress = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
  };

  return (
    <div className="account-menu-overlay" onClick={onClose}>
      <div className="account-menu" onClick={(e) => e.stopPropagation()}>
        <div className="account-menu-header">
          <h3>My Accounts</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="account-list">
          {accounts.map((account) => (
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
        </div>

        <button
          className="create-account-btn"
          onClick={handleCreateAccount}
          disabled={loading}
        >
          {loading ? 'Creating...' : '+ Create Account'}
        </button>

        <div className="account-menu-footer">
          <button className="menu-action-btn" onClick={() => { onOpenSettings(); onClose(); }}>
            ⚙️ Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default AccountMenu;
