import React, { useState } from 'react';
import { ethers } from 'ethers';

interface Props {
  onWalletCreated: () => void;
}

type Screen =
  | 'choice'
  | 'create-mnemonic'
  | 'create-password'
  | 'import-mnemonic'
  | 'import-password';

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

  const validateMnemonicInput = (phrase: string) => {
    const words = phrase.trim().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      setError('Recovery phrase must be 12, 15, 18, 21, or 24 words');
      return false;
    }
    return true;
  };

  const goToCreateFlow = () => {
    const random = ethers.Wallet.createRandom();
    setGeneratedMnemonic(random.mnemonic.phrase);
    setPassword('');
    setConfirmPassword('');
    setWalletName('default');
    setScreen('create-mnemonic');
  };

  const handleCreateAfterPassword = async () => {
    setError('');
    if (!validatePassword()) return;
    if (!generatedMnemonic) {
      setError('Missing generated recovery phrase. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: generatedMnemonic, password, name: walletName }
      });

      if (response.error) {
        setError(response.error);
      } else {
        onWalletCreated();
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
    if (!mnemonic.trim() || !validateMnemonicInput(mnemonic)) return;

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
              onClick={goToCreateFlow}
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

  // Create Wallet - Show Mnemonic
  if (screen === 'create-mnemonic') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('choice')}>
            ← Back
          </button>
          <h1>Create Wallet</h1>
        </div>
        <div className="content">
          <div className="mnemonic-warning">
            <strong>Save this recovery phrase.</strong> Anyone with this phrase can access your wallet.
          </div>

          <div className="mnemonic-box">
            {generatedMnemonic}
          </div>

          <div className="action-buttons">
            <button className="btn btn-secondary" onClick={handleCopyMnemonic}>
              Copy
            </button>
            <button className="btn btn-primary" onClick={() => setScreen('create-password')}>
              Continue
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
          <button className="btn-back" onClick={() => setScreen('create-mnemonic')}>
            ← Back
          </button>
          <h1>Secure Wallet</h1>
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
            onClick={handleCreateAfterPassword}
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Wallet'}
          </button>
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
            Enter the recovery phrase for the wallet you want to import.
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
            <label>Recovery Phrase</label>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="Enter your recovery phrase"
              rows={4}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="btn btn-primary"
            onClick={() => {
              setError('');
              if (!mnemonic.trim() || !validateMnemonicInput(mnemonic)) return;
              setScreen('import-password');
            }}
          >
            Next: Set Password
          </button>
        </div>
      </div>
    );
  }

  // Import Wallet - Password Screen (Step 2)
  if (screen === 'import-password') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('import-mnemonic')}>
            ← Back
          </button>
          <h1>Secure Imported Wallet</h1>
        </div>
        <div className="content">
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Set a master password to encrypt this wallet. Use the same password across wallets.
          </p>

          {error && <div className="error">{error}</div>}

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
