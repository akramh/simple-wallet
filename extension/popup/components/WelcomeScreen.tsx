import React, { useState } from 'react';

interface Props {
  onWalletCreated: () => void;
}

type Tab = 'create' | 'import';

function WelcomeScreen({ onWalletCreated }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [walletName, setWalletName] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [step, setStep] = useState<'form' | 'show-mnemonic'>('form');

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
        setStep('show-mnemonic');
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

  if (step === 'show-mnemonic') {
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

  return (
    <div className="container">
      <div className="header">
        <h1>Simple Crypto Wallet</h1>
      </div>
      <div className="content">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            Create Wallet
          </button>
          <button
            className={`tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            Import Wallet
          </button>
        </div>

        {activeTab === 'create' ? (
          <>
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
          </>
        ) : (
          <>
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
                placeholder="Enter your 12-word recovery phrase"
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
              onClick={handleImport}
              disabled={loading}
            >
              {loading ? 'Importing...' : 'Import Wallet'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default WelcomeScreen;
