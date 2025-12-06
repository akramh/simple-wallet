/**
 * @file App.tsx
 * @description Root React component for the Chrome extension UI (sidepanel/popup).
 * 
 * Manages the top-level application state machine and renders the appropriate
 * screen based on wallet state: welcome (no wallet), unlock (locked), or main.
 * Also handles dApp approval modals for connection/transaction/signature requests.
 * 
 * @responsibilities
 * - Poll and display current wallet state from service worker
 * - Route to appropriate screen: WelcomeScreen, UnlockScreen, or MainWallet
 * - Display and handle pending dApp approval requests
 * - Listen for wallet lock events and state changes
 * - Maintain visibility-aware state refresh
 * 
 * @state-machine
 * ```
 * [loading] -> [error] | [no wallet] | [locked] | [unlocked]
 *                          |               |            |
 *                    WelcomeScreen   UnlockScreen   MainWallet
 * ```
 * 
 * @events
 * - WALLET_LOCKED: Triggered when auto-lock or manual lock occurs
 * - PENDING_REQUESTS_UPDATED: New dApp request needs approval
 */

import React, { useState, useEffect, useCallback } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import UnlockScreen from './components/UnlockScreen';
import MainWallet from './components/MainWallet';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Current wallet state from the background service worker.
 */
interface WalletState {
  /** Whether the wallet is currently unlocked */
  isUnlocked: boolean;
  /** Whether any wallet has been created/imported */
  hasWallet: boolean;
  /** Current network identifier (e.g., 'mainnet', 'sepolia') */
  network: string;
  /** Current wallet address (null if locked) */
  address: string | null;
}

/**
 * Types of pending approval requests from dApps.
 */
type PendingRequest =
  | { id: string; type: 'connect'; origin: string; createdAt: number }
  | { id: string; type: 'transaction'; origin: string; createdAt: number; tx: any }
  | { id: string; type: 'signature'; origin: string; createdAt: number; method: string; params: any[] };

// ============================================================================
// App Component
// ============================================================================

/**
 * Root application component for the wallet extension UI.
 * Manages state machine for wallet screens and dApp approval flows.
 */
function App() {
  /** Current wallet state from background */
  const [state, setState] = useState<WalletState | null>(null);
  
  /** Loading state during initial state fetch */
  const [loading, setLoading] = useState(true);
  
  /** Queue of pending dApp approval requests */
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);

  /**
   * Handles wallet lock events by resetting unlocked state.
   * Called when auto-lock triggers or user manually locks.
   */
  const handleLockEvent = useCallback(() => {
    setState(prev => prev ? { ...prev, isUnlocked: false, address: null } : null);
  }, []);

  /**
   * Fetches current wallet state from the background service worker.
   */
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

  /**
   * Fetches pending dApp approval requests from the background service worker.
   */
  const loadPending = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_PENDING_REQUESTS' });
      setPendingRequests(response?.pending || []);
    } catch (error) {
      console.error('Failed to load pending requests:', error);
    }
  }, []);

  /**
   * Main effect for initializing state and setting up event listeners.
   * - Loads initial state and pending requests
   * - Sets up periodic state refresh (every 10s when visible)
   * - Listens for visibility changes, wallet lock, and pending request updates
   */
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

  /**
   * Callback when a new wallet is successfully created.
   * Refreshes state to transition to main wallet view.
   */
  const handleWalletCreated = () => {
    loadState();
  };

  /**
   * Callback when wallet is successfully unlocked.
   * Refreshes state to transition to main wallet view.
   */
  const handleUnlocked = () => {
    loadState();
  };

  /**
   * Resolves a pending dApp approval request.
   * 
   * @param id - Request ID to resolve
   * @param approved - Whether to approve (true) or reject (false)
   */
  const handleResolve = async (id: string, approved: boolean) => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESOLVE_PENDING_REQUEST', payload: { id, approved } });
      await loadPending();
    } catch (error) {
      console.error('Failed to resolve request', error);
    }
  };

  /** Currently active approval request (first in queue) */
  const currentRequest = pendingRequests[0];

  /**
   * Renders the approval modal for the current pending request.
   * Shows different content based on request type:
   * - connect: dApp connection request
   * - transaction: Transaction signing request
   * - signature: Message signing request
   * 
   * @returns Modal JSX or null if no pending requests
   */
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

  // ============================================================================
  // Render Logic
  // ============================================================================

  // Show loading spinner during initial state fetch
  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // Show error state if state fetch failed
  if (!state) {
    return (
      <div className="container">
        <div className="loading">Error loading wallet</div>
      </div>
    );
  }

  // State machine: route to appropriate screen based on wallet state
  
  // No wallet exists -> show welcome/create screen
  if (!state.hasWallet) {
    return <WelcomeScreen onWalletCreated={handleWalletCreated} />;
  }

  // Wallet exists but locked -> show unlock screen
  if (!state.isUnlocked) {
    return <UnlockScreen onUnlocked={handleUnlocked} />;
  }

  // Wallet unlocked -> show main interface with optional approval modal
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
