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
import { sendMessageWithRetry } from './utils/messaging';
import WelcomeScreen from './components/WelcomeScreen';
import UnlockScreen from './components/UnlockScreen';
import MainWallet from './components/MainWallet';
import ApprovalModal, { type ApprovalRequest } from './components/ApprovalModal';
import { applyTheme, getStoredTheme, subscribeSystemTheme } from './theme';

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
  /** Current wallet name (null if locked) */
  currentWalletName?: string | null;
  /** Import type: 'mnemonic' or 'privateKey' */
  importType?: 'mnemonic' | 'privateKey' | null;
  /** For private key imports, the chain type (evm, bitcoin, solana, xrp, ton) */
  privateKeyType?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton' | null;
}

/** Pending approval request from the dApp provider. */
type PendingRequest = ApprovalRequest;

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

  /** Networks metadata (populated lazily so approval modal can show human names). */
  const [networks, setNetworks] = useState<Record<string, { name?: string; nativeSymbol?: string }>>({});

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
      const response = await sendMessageWithRetry({ type: 'GET_STATE' });
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
      const response = await sendMessageWithRetry({ type: 'GET_PENDING_REQUESTS' });
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
    // Apply persisted UI theme preference (light/dark/auto) as early as possible.
    // When preference is 'auto', subscribe to OS-level color-scheme changes so
    // the UI flips live without requiring a popup reload.
    let unsubscribeSystemTheme: (() => void) | null = null;
    getStoredTheme()
      .then((pref) => {
        applyTheme(pref);
        if (pref === 'auto') {
          unsubscribeSystemTheme = subscribeSystemTheme(() => applyTheme('auto'));
        }
      })
      .catch(() => { });

    // React to preference changes persisted from other popup instances
    // (e.g. user toggles theme in Settings while side panel is open).
    const themeStorageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (!changes.uiTheme) return;
      const pref = changes.uiTheme.newValue as 'light' | 'dark' | 'auto' | undefined;
      if (!pref) return;
      applyTheme(pref);
      if (unsubscribeSystemTheme) { unsubscribeSystemTheme(); unsubscribeSystemTheme = null; }
      if (pref === 'auto') {
        unsubscribeSystemTheme = subscribeSystemTheme(() => applyTheme('auto'));
      }
    };
    chrome.storage.local?.onChanged.addListener(themeStorageListener);

    loadState();
    loadPending();
    // Best-effort: fetch network metadata so the approval modal can resolve
    // a human-readable network name + native symbol. Failures fall back to
    // the raw network key.
    sendMessageWithRetry({ type: 'GET_NETWORKS' })
      .then((res) => {
        if (res?.networks) setNetworks(res.networks);
      })
      .catch(() => { });

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
      chrome.storage.local?.onChanged.removeListener(themeStorageListener);
      if (unsubscribeSystemTheme) unsubscribeSystemTheme();
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

  /** Currently active approval request (first in queue). */
  const currentRequest = pendingRequests[0];

  // ============================================================================
  // Render Logic
  // ============================================================================

  // Initial boot state — show a compact centered spinner rather than bare text.
  if (loading) {
    return (
      <div className="container app-boot">
        <div className="app-boot__spinner" aria-label="Loading" />
        <div className="app-boot__label">Loading wallet…</div>
      </div>
    );
  }

  // Background-service failure. Tell the user we're stuck and offer to retry.
  if (!state) {
    return (
      <div className="container app-boot">
        <div className="app-boot__label is-error">We couldn't reach the wallet.</div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => { setLoading(true); loadState(); }}
        >
          Retry
        </button>
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
        importType={state.importType}
        privateKeyType={state.privateKeyType}
        onLock={loadState}
        onStateChange={loadState}
      />
      {currentRequest && (
        <ApprovalModal
          request={currentRequest}
          wallet={{
            name: state.currentWalletName,
            address: state.address,
            network: state.network,
          }}
          networks={networks}
          onResolve={handleResolve}
        />
      )}
    </>
  );
}

export default App;
