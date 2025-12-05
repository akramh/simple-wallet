import React, { useState } from 'react';
import { ethers } from 'ethers';
import { MnemonicDisplay } from './ui';

interface Props {
  onWalletCreated: () => void;
}

type Screen = 'choice' | 'set-password' | 'create-mnemonic' | 'import-mnemonic';

function WelcomeScreen({ onWalletCreated }: Props) {
  const [screen, setScreen] = useState<Screen>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [walletName, setWalletName] = useState('wallet1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [flowType, setFlowType] = useState<'create' | 'import'>('create');
  const [showMnemonic, setShowMnemonic] = useState(false);

  const validateMnemonicInput = (phrase: string) => {
    const words = phrase.trim().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      setError('Recovery phrase must be 12, 15, 18, 21, or 24 words');
      return false;
    }
    return true;
  };

  const getNextWalletName = async (): Promise<string> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_WALLETS' });
      const names = response?.wallets ? Object.keys(response.wallets) : [];
      const base = 'wallet';
      let max = 0;
      names.forEach((name: string) => {
        const match = name.match(/^wallet(\d+)$/);
        if (match) {
          max = Math.max(max, parseInt(match[1], 10));
        }
      });
      return `${base}${max + 1 || 1}`;
    } catch (err) {
      console.warn('Failed to load wallets for naming, defaulting to wallet1', err);
      return 'wallet1';
    }
  };

  const goToCreateFlow = async () => {
    const nextName = await getNextWalletName();
    setWalletName(nextName);
    setFlowType('create');
    setScreen('set-password');
  };

  const goToImportFlow = async () => {
    const nextName = await getNextWalletName();
    setWalletName(nextName);
    setFlowType('import');
    setScreen('set-password');
  };

  const handlePasswordSet = async () => {
    setError('');
    
    if (!password) {
      setError('Please enter a password');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (flowType === 'create') {
      // Generate mnemonic and go to create-mnemonic screen
      const random = ethers.Wallet.createRandom();
      setGeneratedMnemonic(random.mnemonic.phrase);
      setCopyState('idle');
      setScreen('create-mnemonic');
    } else {
      // Go to import-mnemonic screen
      setScreen('import-mnemonic');
    }
  };

  const handleCreateFinalize = async () => {
    setError('');
    if (!generatedMnemonic) {
      setError('Missing generated recovery phrase. Please try again.');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: generatedMnemonic, password: password, name: walletName }
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
    if (!mnemonic.trim() || !validateMnemonicInput(mnemonic)) return;

    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: mnemonic.trim(), password: password, name: walletName }
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
    if (!generatedMnemonic) return;
    navigator.clipboard.writeText(generatedMnemonic)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('error'));
  };

  // Password Setup Screen
  if (screen === 'set-password') {
    return (
      <div className="container">
        <div className="header">
          <h1>🔒 Set Your Password</h1>
        </div>
        <div className="content">
          <div className="info-box bg-primary-50 border border-primary-100 rounded-wallet-sm p-3 mb-5">
            <p className="m-0 text-sm text-primary-700">
              This password encrypts your wallet on this device. You'll need it to unlock your wallet.
            </p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handlePasswordSet(); }}>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password (min 8 characters)"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
              />
            </div>

            {error && <div className="error">{error}</div>}

            <div className="action-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setScreen('choice');
                  setPassword('');
                  setConfirmPassword('');
                  setError('');
                }}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!password || !confirmPassword}
              >
                Continue
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

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
            <p className="text-sm text-text-secondary mt-2">
              Manage your crypto assets securely
            </p>
          </div>

          <div className="choice-buttons">
            <button
              className="btn btn-primary btn-large"
              onClick={() => goToCreateFlow()}
            >
              Create a Wallet
            </button>
            <button
              className="btn btn-secondary btn-large"
              onClick={() => goToImportFlow()}
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
            <strong>⚠️ Save your recovery phrase!</strong>
            <span>Save to a password manager, or write down and store in a secure place. Do not share with anyone.</span>
          </div>

          <div className="mnemonic-panel">
            <div className="mnemonic-panel-header">
              <span>Recovery phrase</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="section-cta"
                  onClick={handleCopyMnemonic}
                  disabled={!generatedMnemonic}
                >
                  {copyState === 'copied' ? '✓ Copied' : '📋 Copy'}
                </button>
                <button
                  className="section-cta"
                  onClick={() => setShowMnemonic(v => !v)}
                >
                  {showMnemonic ? '👁️ Hide' : '👁️ Reveal'}
                </button>
              </div>
            </div>
            <MnemonicDisplay mnemonic={generatedMnemonic} isRevealed={showMnemonic} />
          </div>

          <div className="action-buttons">
            <button className="btn btn-primary" onClick={handleCreateFinalize} disabled={loading}>
              {loading ? 'Creating...' : 'Continue'}
            </button>
          </div>

          {copyState === 'error' && (
            <div className="alert alert-error mt-2.5">
              Could not copy. Please manually copy the words.
            </div>
          )}
          {error && <div className="error mt-2.5">{error}</div>}
        </div>
      </div>
    );
  }

  // Import Wallet
  if (screen === 'import-mnemonic') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('choice')}>
            ← Back
          </button>
          <h1>Import Wallet</h1>
        </div>
        <div className="content">
          <p className="mb-5 text-text-secondary">
            Enter the recovery phrase for the wallet you want to import.
          </p>

          <div className="form-group">
            <label>Recovery Phrase</label>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="Enter your 12-24 word phrase"
              rows={3}
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
