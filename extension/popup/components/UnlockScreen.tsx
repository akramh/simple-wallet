import React, { useState } from 'react';

interface Props {
  onUnlocked: () => void;
}

function UnlockScreen({ onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [walletName] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        <form onSubmit={handleUnlock}>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoFocus
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary"
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
