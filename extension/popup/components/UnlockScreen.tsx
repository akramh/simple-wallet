import React, { useState, useEffect } from 'react';
import lockIcon from '../../assets/icons/lock.svg';
import { PasswordField } from './ui';

interface Props {
  onUnlocked: () => void;
}

function UnlockScreen({ onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [walletName, setWalletName] = useState('default');
  const [availableWallets, setAvailableWallets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load available wallets on mount
  useEffect(() => {
    const loadWallets = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
        if (response.wallets) {
          const walletNames = Object.keys(response.wallets);
          setAvailableWallets(walletNames);
          if (walletNames.length > 0 && !walletNames.includes('default')) {
            setWalletName(walletNames[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load wallets:', err);
      }
    };
    loadWallets();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UNLOCK_WALLET',
        payload: { password, name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        onUnlocked();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to unlock wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Welcome Back</h1>
      </div>
      <div className="content">
        <div className="text-center mb-8">
          <div className="unlock-icon-container">
            <img src={lockIcon} alt="Locked" className="unlock-icon" />
          </div>
          <p className="text-text-secondary text-base">Enter your password to unlock</p>
        </div>

        <form onSubmit={handleUnlock}>
          {availableWallets.length > 0 && (
            <div className="form-group">
              <label>Wallet</label>
              {availableWallets.length > 1 ? (
                <select
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                >
                  {availableWallets.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
                  {walletName}
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="Enter your password"
              autoFocus
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary btn-large mt-3"
            disabled={loading}
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default UnlockScreen;
