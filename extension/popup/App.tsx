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

type PendingRequest =
  | { id: string; type: 'connect'; origin: string; createdAt: number }
  | { id: string; type: 'transaction'; origin: string; createdAt: number; tx: any }
  | { id: string; type: 'signature'; origin: string; createdAt: number; method: string; params: any[] };

function App() {
  const [state, setState] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);

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

  const loadPending = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_REQUESTS' });
      setPendingRequests(response?.pending || []);
    } catch (error) {
      console.error('Failed to load pending requests:', error);
    }
  }, []);

  useEffect(() => {
    loadState();
    loadPending();

    // Periodically resync state in case the service worker restarted and lost in-memory state
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadState();
      }
    }, 10000);

    // Refresh state when the popup becomes visible again
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        loadState();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    // Listen for wallet lock events via message
    const messageListener = (message: any) => {
      if (message.type === 'WALLET_LOCKED') {
        handleLockEvent();
      }
      if (message.type === 'PENDING_REQUESTS_UPDATED') {
        setPendingRequests(message.pending || []);
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
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visibilityHandler);
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.session?.onChanged.removeListener(storageListener);
    };
  }, [loadState, handleLockEvent, loadPending]);

  const handleWalletCreated = () => {
    loadState();
  };

  const handleUnlocked = () => {
    loadState();
  };

  const handleResolve = async (id: string, approved: boolean) => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESOLVE_PENDING_REQUEST', payload: { id, approved } });
      await loadPending();
    } catch (error) {
      console.error('Failed to resolve request', error);
    }
  };

  const currentRequest = pendingRequests[0];

  const renderApprovalModal = () => {
    if (!currentRequest) return null;

    const renderBody = () => {
      switch (currentRequest.type) {
        case 'connect':
          return (
            <>
              <p className="approval-label">Connection request</p>
              <p className="approval-value">Origin: {currentRequest.origin}</p>
              <p className="approval-value">Account: {state?.address}</p>
            </>
          );
        case 'transaction':
          return (
            <>
              <p className="approval-label">Transaction request</p>
              <p className="approval-value">Origin: {currentRequest.origin}</p>
              <p className="approval-value">To: {currentRequest.tx?.to || 'N/A'}</p>
              <p className="approval-value">Value: {currentRequest.tx?.value || '0'} wei</p>
            </>
          );
        case 'signature':
          return (
            <>
              <p className="approval-label">Signature request</p>
              <p className="approval-value">Origin: {currentRequest.origin}</p>
              <p className="approval-value">Method: {currentRequest.method}</p>
              <p className="approval-box">{JSON.stringify(currentRequest.params, null, 2)}</p>
            </>
          );
        default:
          return null;
      }
    };

    return (
      <div className="approval-backdrop">
        <div className="approval-modal">
          {renderBody()}
          <div className="approval-actions">
            <button className="btn btn-secondary" onClick={() => handleResolve(currentRequest.id, false)}>Reject</button>
            <button className="btn btn-primary" onClick={() => handleResolve(currentRequest.id, true)}>Approve</button>
          </div>
        </div>
      </div>
    );
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
    <>
      <MainWallet
        address={state.address!}
        network={state.network}
        onLock={loadState}
        onStateChange={loadState}
      />
      {renderApprovalModal()}
    </>
  );
}

export default App;
