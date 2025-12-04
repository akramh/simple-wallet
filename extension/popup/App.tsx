import React, { useState, useEffect } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import UnlockScreen from './components/UnlockScreen';
import MainWallet from './components/MainWallet';

interface WalletState {
  isUnlocked: boolean;
  hasWallet: boolean;
  network: string;
  address: string | null;
}

function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadState();

    // Listen for wallet lock events
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'WALLET_LOCKED') {
        setState(prev => prev ? { ...prev, isUnlocked: false, address: null } : null);
      }
    });
  }, []);

  const loadState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      setState(response);
    } catch (error) {
      console.error('Failed to load state:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWalletCreated = () => {
    loadState();
  };

  const handleUnlocked = () => {
    loadState();
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="container">
        <div className="loading">Error loading wallet</div>
      </div>
    );
  }

  // Show welcome screen for new users
  if (!state.hasWallet) {
    return <WelcomeScreen onWalletCreated={handleWalletCreated} />;
  }

  // Show unlock screen if wallet exists but is locked
  if (!state.isUnlocked) {
    return <UnlockScreen onUnlocked={handleUnlocked} />;
  }

  // Show main wallet interface
  return <MainWallet address={state.address!} network={state.network} onLock={loadState} />;
}

export default App;
