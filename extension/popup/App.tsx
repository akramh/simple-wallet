import React, { useState, useEffect, useCallback } from 'react';
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

  const handleLockEvent = useCallback(() => {
    setState(prev => prev ? { ...prev, isUnlocked: false, address: null } : null);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      setState(response);
    } catch (error) {
      console.error('Failed to load state:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();

    // Listen for wallet lock events via message
    const messageListener = (message: any) => {
      if (message.type === 'WALLET_LOCKED') {
        handleLockEvent();
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Listen for wallet lock events via storage (more reliable for side panel)
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.walletLocked) {
        handleLockEvent();
      }
    };
    chrome.storage.session?.onChanged.addListener(storageListener);

    // Cleanup listeners on unmount
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.session?.onChanged.removeListener(storageListener);
    };
  }, [loadState, handleLockEvent]);

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
  return (
    <MainWallet
      address={state.address!}
      network={state.network}
      onLock={loadState}
      onStateChange={loadState}
    />
  );
}

export default App;
