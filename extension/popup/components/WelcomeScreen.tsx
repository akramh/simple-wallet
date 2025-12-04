import React, { useState } from 'react';
import { ethers } from 'ethers';

interface Props {
  onWalletCreated: () => void;
}

type Screen = 'choice' | 'create-mnemonic' | 'import-mnemonic';

const DEFAULT_EXTENSION_PASSWORD = 'session-extension-password';

function WelcomeScreen({ onWalletCreated }: Props) {
  const [screen, setScreen] = useState<Screen>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [walletName, setWalletName] = useState('wallet1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

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
    const random = ethers.Wallet.createRandom();
    setGeneratedMnemonic(random.mnemonic.phrase);
    setCopyState('idle');
    const nextName = await getNextWalletName();
    setWalletName(nextName);
    setScreen('create-mnemonic');
  };

  const handleCreateFinalize = async () => {
    setError('');
    if (!generatedMnemonic) {
      setError('Missing generated recovery phrase. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: generatedMnemonic, password: DEFAULT_EXTENSION_PASSWORD, name: walletName }
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

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: mnemonic.trim(), password: DEFAULT_EXTENSION_PASSWORD, name: walletName }
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
              onClick={() => goToCreateFlow()}
            >
              Create a Wallet
            </button>
            <button
              className="btn btn-secondary btn-large"
              onClick={async () => {
                const nextName = await getNextWalletName();
                setWalletName(nextName);
                setScreen('import-mnemonic');
              }}
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
            <strong>Save these 12 words.</strong> Save to a password manager, or write down and store in a secure place. Do not share with anyone.
          </div>

          <div className="mnemonic-box">
            {generatedMnemonic}
          </div>

          <div className="action-buttons">
            <button className="btn btn-secondary" onClick={handleCopyMnemonic} disabled={!generatedMnemonic}>
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-primary" onClick={handleCreateFinalize} disabled={loading}>
              {loading ? 'Creating...' : 'Continue'}
            </button>
          </div>

          {copyState === 'error' && (
            <div className="alert alert-error" style={{ marginTop: '10px' }}>
              Could not copy. Please manually copy the words.
            </div>
          )}
          {error && <div className="error" style={{ marginTop: '10px' }}>{error}</div>}
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
          <p style={{ marginBottom: '20px', color: '#666' }}>
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
