/**
 * SettingsView Component
 * 
 * Simplified settings page that directs users to the AccountMenu
 * for all wallet and account management operations.
 * 
 * Note: Account management has been moved to the main AccountMenu dropdown
 * to provide a unified interface for wallet/account operations.
 */
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
    loadWallets();

    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

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

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div style={{ padding: '16px' }}>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>
          Wallet and account management is available in the main menu (top-left dropdown).
        </p>
      </div>
    </div>
  );
    }

    export default SettingsView;
