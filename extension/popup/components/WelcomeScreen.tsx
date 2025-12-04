import React, { useState } from 'react';

interface Props {
  onWalletCreated: () => void;
}

type Screen = 'choice' | 'create-password' | 'import-password' | 'import-mnemonic' | 'show-mnemonic';

function WelcomeScreen({ onWalletCreated }: Props) {
  const [screen, setScreen] = useState<Screen>('choice');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [walletName, setWalletName] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');

  const validatePassword = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    setError('');

    if (!validatePassword()) return;

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WALLET',
        payload: { password, name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        setGeneratedMnemonic(response.mnemonic);
        setScreen('show-mnemonic');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setError('');

    if (!validatePassword()) return;
    if (!mnemonic.trim()) {
      setError('Please enter your recovery phrase');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: mnemonic.trim(), password, name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        onWalletCreated();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyMnemonic = () => {
    navigator.clipboard.writeText(generatedMnemonic);
  };

  const handleContinue = () => {
    onWalletCreated();
  };

  // Choice Screen - Initial selection
  if (screen === 'choice') {
    return (
      <div className="container">
        <div className="header">
          <h1>Simple Crypto Wallet</h1>
        </div>
        <div className="content">
          <div className="welcome-message">
            <p>Welcome to Simple Crypto Wallet</p>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
              Manage your crypto assets securely
            </p>
          </div>

          <div className="choice-buttons">
            <button
              className="btn btn-primary btn-large"
              onClick={() => setScreen('create-password')}
            >
              Create a Wallet
            </button>
            <button
              className="btn btn-secondary btn-large"
              onClick={() => setScreen('import-password')}
            >
              Import your own
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Create Wallet - Password Screen
  if (screen === 'create-password') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('choice')}>
            ← Back
          </button>
          <h1>Create Wallet</h1>
        </div>
        <div className="content">
          <div className="form-group">
            <label>Wallet Name</label>
            <input
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="default"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password (min 8 characters)"
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Wallet'}
          </button>
        </div>
      </div>
    );
  }

  // Show Mnemonic Screen
  if (screen === 'show-mnemonic') {
    return (
      <div className="container">
        <div className="header">
          <h1>Backup Recovery Phrase</h1>
        </div>
        <div className="content">
          <div className="mnemonic-warning">
            <strong>Warning:</strong> Write down this recovery phrase and keep it safe.
            Anyone with this phrase can access your wallet.
          </div>

          <div className="mnemonic-box">
            {generatedMnemonic}
          </div>

          <div className="action-buttons">
            <button className="btn btn-secondary" onClick={handleCopyMnemonic}>
              Copy
            </button>
            <button className="btn btn-primary" onClick={handleContinue}>
              I've Saved It
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Import Wallet - Password Screen (Step 1)
  if (screen === 'import-password') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('choice')}>
            ← Back
          </button>
          <h1>Import Wallet</h1>
        </div>
        <div className="content">
          <p style={{ marginBottom: '20px', color: '#666' }}>
            First, create a password to secure your wallet
          </p>

          <div className="form-group">
            <label>Wallet Name</label>
            <input
              type="text"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="default"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password (min 8 characters)"
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="btn btn-primary"
            onClick={() => {
              setError('');
              if (!validatePassword()) return;
              setScreen('import-mnemonic');
            }}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  // Import Wallet - Mnemonic Screen (Step 2)
  if (screen === 'import-mnemonic') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('import-password')}>
            ← Back
          </button>
          <h1>Import Wallet</h1>
        </div>
        <div className="content">
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Enter your 12-word recovery phrase
          </p>

          <div className="form-group">
            <label>Recovery Phrase</label>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="Enter your 12-word recovery phrase separated by spaces"
              rows={4}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={loading}
          >
            {loading ? 'Importing...' : 'Import Wallet'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default WelcomeScreen;
