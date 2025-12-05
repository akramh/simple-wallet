import React, { useState, useEffect } from 'react';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';

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
    <div className="flex flex-col h-full bg-white">
      <div className="px-5 py-5 bg-primary text-white">
        <h1 className="text-xl font-semibold">Welcome Back</h1>
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🔐</div>
          <p className="text-text-secondary text-base">Enter your password to unlock</p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-5">
          {availableWallets.length > 1 && (
            <Select
              label="Wallet"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              options={availableWallets.map(name => ({ value: name, label: name }))}
            />
          )}

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            error={error}
            autoFocus
          />

          <Button type="submit" fullWidth loading={loading} className="mt-4">
            {loading ? 'Unlocking...' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default UnlockScreen;
