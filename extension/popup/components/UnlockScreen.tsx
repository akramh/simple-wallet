import React, { useState, useEffect } from 'react';
import lockIcon from '../../assets/icons/lock.svg';
import { PasswordField } from './ui';
import { detectChain, chainAccentVar } from '../utils/address';

interface Props {
  onUnlocked: () => void;
}

interface WalletMeta {
  name: string;
  importType?: 'mnemonic' | 'privateKey';
  /** One or more addresses across chains — used to pick an accent. */
  addresses?: string[];
}

function UnlockScreen({ onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [walletName, setWalletName] = useState('default');
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load available wallets on mount
  useEffect(() => {
    const loadWallets = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
        if (response?.wallets) {
          const walletsList: WalletMeta[] = Object.entries(response.wallets).map(
            ([name, meta]: [string, any]) => ({
              name,
              importType: meta?.importType,
              addresses: Object.values(meta?.accounts ?? {})
                .map((a: any) => a?.address)
                .filter(Boolean),
            }),
          );
          setWallets(walletsList);
          const names = walletsList.map((w) => w.name);
          if (names.length > 0 && !names.includes('default')) {
            setWalletName(names[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load wallets:', err);
      }
    };
    loadWallets();
  }, []);

  const selectedWallet = wallets.find((w) => w.name === walletName);
  const selectedAccent = chainAccentVar(
    detectChain(selectedWallet?.addresses?.[0]),
  );

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
          {wallets.length > 0 && (
            <div className="form-group">
              <label>Wallet</label>
              {wallets.length > 1 ? (
                <div className="unlock-wallet-picker" role="radiogroup" aria-label="Select wallet">
                  {wallets.map((w) => {
                    const accent = chainAccentVar(detectChain(w.addresses?.[0]));
                    const active = w.name === walletName;
                    return (
                      <button
                        key={w.name}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`unlock-wallet-option${active ? ' is-active' : ''}`}
                        onClick={() => setWalletName(w.name)}
                        style={{ ['--chip-accent' as any]: accent }}
                      >
                        <span className="unlock-wallet-option__dot" />
                        <span className="unlock-wallet-option__name">{w.name}</span>
                        {w.importType === 'privateKey' && (
                          <span className="unlock-wallet-option__badge">PK</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="unlock-wallet-single"
                  style={{ ['--chip-accent' as any]: selectedAccent }}
                >
                  <span className="unlock-wallet-option__dot" />
                  <span>{walletName}</span>
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
