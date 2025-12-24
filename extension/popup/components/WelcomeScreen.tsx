import React, { useState } from 'react';
import * as bip39 from 'bip39';
import { MnemonicDisplay } from './ui';
import logoIcon from '../../assets/img/logo.svg';

interface Props {
  onWalletCreated: () => void;
}

type Screen = 'choice' | 'set-password' | 'create-mnemonic' | 'import-wallet' | 'verify-mnemonic';

function WelcomeScreen({ onWalletCreated }: Props) {
  const [screen, setScreen] = useState<Screen>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [chainType, setChainType] = useState('evm');
  const [importType, setImportType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  
  const [suggestedWalletName, setSuggestedWalletName] = useState('wallet1');
  const [walletNameInput, setWalletNameInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [flowType, setFlowType] = useState<'create' | 'import'>('create');
  const [showMnemonic, setShowMnemonic] = useState(false);
  
  // Verification state
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = useState<string[]>(['', '', '']);

  const validateMnemonicInput = (phrase: string) => {
    const words = phrase.trim().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      setError('Recovery phrase must be 12, 15, 18, 21, or 24 words');
      return false;
    }
    return true;
  };

  // Keep wallet names consistent with storage keys and background validation rules.
  const isValidWalletName = (name: string) => /^[A-Za-z0-9]{1,12}$/.test(name);

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
    setSuggestedWalletName(nextName);
    setWalletNameInput('');
    setFlowType('create');
    setScreen('set-password');
  };

  const goToImportFlow = async () => {
    const nextName = await getNextWalletName();
    setSuggestedWalletName(nextName);
    setWalletNameInput('');
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
      // Generate 24-word mnemonic (256-bit entropy) for maximum security
      const mnemonic = bip39.generateMnemonic(256);
      setGeneratedMnemonic(mnemonic);
      setCopyState('idle');
      setScreen('create-mnemonic');
    } else {
      setScreen('import-wallet');
    }
  };

  const goToVerifyStep = () => {
    const wordCount = generatedMnemonic.split(' ').length;
    const indices = new Set<number>();
    while(indices.size < 3) {
      indices.add(Math.floor(Math.random() * wordCount));
    }
    const sortedIndices = Array.from(indices).sort((a, b) => a - b);
    setVerifyIndices(sortedIndices);
    setVerifyInputs(['', '', '']);
    setScreen('verify-mnemonic');
    setError('');
  };

  const handleVerifyAndCreate = async () => {
    setError('');
    const words = generatedMnemonic.split(' ');
    
    for (let i = 0; i < 3; i++) {
      const index = verifyIndices[i];
      const inputWord = verifyInputs[i].trim().toLowerCase();
      const actualWord = words[index];
      
      if (inputWord !== actualWord) {
        setError(`Word #${index + 1} is incorrect. Please try again.`);
        return;
      }
    }
    
    await createWallet();
  };

  const createWallet = async () => {
    setError('');
    if (!generatedMnemonic) {
      setError('Missing generated recovery phrase. Please try again.');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }
    const finalWalletName = walletNameInput.trim() || suggestedWalletName;
    if (!isValidWalletName(finalWalletName)) {
      setError('Wallet name must be 1-12 characters and contain only letters and numbers');
      return;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload: { mnemonic: generatedMnemonic, password: password, name: finalWalletName }
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
    const finalWalletName = walletNameInput.trim() || suggestedWalletName;
    if (!isValidWalletName(finalWalletName)) {
      setError('Wallet name must be 1-12 characters and contain only letters and numbers');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    let payload: any = { password, name: finalWalletName };

    if (importType === 'mnemonic') {
        if (!mnemonic.trim() || !validateMnemonicInput(mnemonic)) return;
        payload.mnemonic = mnemonic.trim();
    } else {
        if (!privateKey.trim()) {
            setError('Private key is required');
            return;
        }
        payload.privateKey = privateKey.trim();
        payload.chainType = chainType;
    }

    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_WALLET',
        payload
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
          <div className="info-box">
            <p>
              This password encrypts your wallet on this device. You'll need it to unlock your wallet.
            </p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handlePasswordSet(); }}>
            <div className="form-group">
              <label>Wallet name (optional)</label>
              <input
                value={walletNameInput}
                onChange={(e) => setWalletNameInput(e.target.value)}
                placeholder={`Default: ${suggestedWalletName}`}
              />
              <div className="text-sm text-text-secondary mt-2">
                1-12 letters/numbers (no spaces or symbols)
              </div>
            </div>
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
                  setWalletNameInput('');
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
          <img src={logoIcon} alt="Simple Wallet" className="welcome-logo" />
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
            <button className="btn btn-primary" onClick={goToVerifyStep}>
              I've Saved It
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

  // Verify Mnemonic Screen
  if (screen === 'verify-mnemonic') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('create-mnemonic')}>
            ← Back
          </button>
          <h1>Verify Phase</h1>
        </div>
        <div className="content">
          <div className="info-box">
            <p>
              Please select the following words from your recovery phrase to verify you've saved it.
            </p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleVerifyAndCreate(); }}>
            {verifyIndices.map((wordIndex, i) => (
              <div className="form-group" key={wordIndex}>
                <label>Word #{wordIndex + 1}</label>
                <input
                  value={verifyInputs[i]}
                  onChange={(e) => {
                    const newInputs = [...verifyInputs];
                    newInputs[i] = e.target.value;
                    setVerifyInputs(newInputs);
                  }}
                  placeholder={`Enter word #${wordIndex + 1}`}
                  autoComplete="off"
                />
              </div>
            ))}

            {error && <div className="error">{error}</div>}

            <div className="action-buttons">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || verifyInputs.some(input => !input.trim())}
              >
                {loading ? 'Creating...' : 'Verify & Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Import Wallet
  if (screen === 'import-wallet') {
    return (
      <div className="container">
        <div className="header">
          <button className="btn-back" onClick={() => setScreen('choice')}>
            ← Back
          </button>
          <h1>Import Wallet</h1>
        </div>
        <div className="content">
          
          <div className="tabs">
            <button 
                className={`tab ${importType === 'mnemonic' ? 'active' : ''}`}
                onClick={() => { setImportType('mnemonic'); setError(''); }}
            >
                Recovery Phrase
            </button>
            <button 
                className={`tab ${importType === 'privateKey' ? 'active' : ''}`}
                onClick={() => { setImportType('privateKey'); setError(''); }}
            >
                Private Key
            </button>
          </div>

          {importType === 'mnemonic' ? (
            <div className="form-group mt-4">
                <label>Recovery Phrase</label>
                <textarea
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="Enter your 12-24 word phrase"
                rows={3}
                />
                <p className="text-sm text-text-secondary mt-2">
                    Standard BIP-39 recovery phrase
                </p>
            </div>
          ) : (
            <>
                <div className="form-group mt-4">
                    <label>Chain Type</label>
                    <select 
                        value={chainType}
                        onChange={(e) => setChainType(e.target.value)}
                    >
                        <option value="evm">Ethereum / EVM</option>
                        <option value="bitcoin">Bitcoin</option>
                        <option value="solana">Solana</option>
                        <option value="xrp">XRP Ledger</option>
                        <option value="ton">TON</option>
                    </select>
                </div>
                <div className="form-group">
                    <label>Private Key</label>
                    <textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Enter raw private key"
                    rows={3}
                    />
                    <p className="text-sm text-text-secondary mt-2">
                        {chainType === 'evm' ? 'Hex string (0x...)' : 
                         chainType === 'solana' ? 'Base58 string' : 
                         chainType === 'bitcoin' ? 'WIF format' : 
                         'Raw key format'}
                    </p>
                </div>
            </>
          )}

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