/**
 * @file service-worker.ts
 * @description Chrome extension background service worker for the Simple Crypto Wallet.
 * 
 * Acts as the central message handler for all wallet operations in the extension context.
 * Manages wallet state, handles dApp communication via EIP-1193 messages, and coordinates
 * between the side panel UI and content scripts.
 * 
 * @responsibilities
 * - Initialize and manage WalletAppService for the extension
 * - Handle all message types from popup, sidepanel, and content scripts
 * - Manage wallet lock/unlock state with auto-lock timeout (15 minutes)
 * - Process dApp requests (eth_accounts, eth_sendTransaction, personal_sign, etc.)
 * - Maintain transaction history and monitor pending transactions
 * - Manage approved dApp origins for connection persistence
 * - Configure Chrome Side Panel API for the wallet UI
 * 
 * @message-types
 * - GET_STATE, CREATE_WALLET, IMPORT_WALLET, UNLOCK_WALLET, LOCK_WALLET
 * - GET_BALANCE, GET_PORTFOLIO, SEND_TRANSACTION, GET_TRANSACTION_HISTORY
 * - SWITCH_WALLET, SWITCH_ACCOUNT, SWITCH_NETWORK
 * - ETH_ACCOUNTS, ETH_REQUEST_ACCOUNTS, ETH_SEND_TRANSACTION
 * - PERSONAL_SIGN, ETH_SIGN_TYPED_DATA_V4, PERSONAL_EC_RECOVER
 * - GET_SECRET_PHRASE, GET_PRIVATE_KEY
 * 
 * @security
 * - Session password stored in memory only
 * - Auto-lock after 15 minutes of inactivity
 * - Password required for secret/private key retrieval
 * - dApp approval required before exposing accounts
 * 
 * @dependencies
 * - Buffer polyfill for browser compatibility
 * - Wallet, WalletAppService, ChromeStorageAdapter
 * - WebCrypto adapter for encryption
 * - ethers for signing and transaction handling
 */

import '../../src/buffer-polyfill.js'; // Install Buffer polyfill
import { Wallet } from '../../src/wallet.js';
import { WalletAppService } from '../../src/app-service.js';
import { ChromeStorageAdapter } from '../../src/chrome-storage.js';
import { createProviderFactory } from '../../src/providers.js';
import { setCryptoAdapter } from '../../src/crypto-utils.js';
import { createWebCryptoAdapter } from '../../src/crypto-adapter.js';
import { TransactionHistoryManager, TransactionStatus, TransactionType } from '../../src/transaction-history.js';
import { explorerAPI } from '../../src/explorer-api.js';
import type { Config } from '../../src/types/index.js';
import { ethers } from 'ethers';

// ============================================================================
// Crypto Environment Setup
// ============================================================================

/** Configure WebCrypto adapter for browser environment (uses asmcrypto.js) */
setCryptoAdapter(createWebCryptoAdapter());

// ============================================================================
// Global State
// ============================================================================

/** Wallet service instance for all wallet operations */
let walletService: WalletAppService | null = null;

/** Whether the wallet is currently unlocked */
let isUnlocked = false;

/** Name of the currently loaded wallet */
let currentWalletName = 'default';

/** Timer for auto-lock functionality */
let autoLockTimer: NodeJS.Timeout | null = null;

/** Auto-lock timeout: 15 minutes of inactivity */
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000;

/** Transaction history manager for the current wallet */
let transactionHistory: TransactionHistoryManager | null = null;

/** Cached session password (in-memory only, cleared on lock) */
let sessionPassword: string | null = null;

/** Set of approved dApp origins that don't require re-approval */
let approvedDappOrigins = new Set<string>();
// ============================================================================
// Pending Request Management
// ============================================================================

/**
 * Types of pending approval requests from dApps.
 * Stored until user approves/rejects in the UI.
 */
type PendingRequest =
  | { id: string; type: 'connect'; origin: string; createdAt: number }
  | { id: string; type: 'transaction'; origin: string; createdAt: number; tx: any }
  | { id: string; type: 'signature'; origin: string; createdAt: number; method: string; params: any[] };

/** Queue of pending approval requests */
const pendingRequests: PendingRequest[] = [];

/** Map of request IDs to resolve/reject callbacks */
const approvalResolvers = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
/**
 * Extracts the origin (protocol + host) from a message sender or payload.
 * Used to identify dApp origins for approval tracking.
 * 
 * @param sender - Chrome runtime message sender
 * @param payload - Message payload that may contain origin
 * @returns Origin string or undefined if not determinable
 */
const resolveOrigin = (sender: chrome.runtime.MessageSender, payload?: any): string | undefined => {
  const fromPayload = payload?.origin;
  if (typeof fromPayload === 'string' && fromPayload.startsWith('http')) {
    return new URL(fromPayload).origin;
  }
  if (sender.origin) return sender.origin;
  if (sender.url) {
    try {
      return new URL(sender.url).origin;
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Loads the list of approved dApp origins from chrome.storage.local.
 * Called during service worker initialization.
 */
async function loadApprovedOrigins(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('approvedDapps');
    const list: string[] = stored?.approvedDapps || [];
    approvedDappOrigins = new Set(list);
  } catch (err) {
    console.warn('Failed to load approved origins', err);
  }
}

/**
 * Persists the current set of approved dApp origins to chrome.storage.local.
 * Called after granting a new dApp connection.
 */
async function saveApprovedOrigins(): Promise<void> {
  try {
    await chrome.storage.local.set({ approvedDapps: Array.from(approvedDappOrigins) });
  } catch (err) {
    console.warn('Failed to save approved origins', err);
  }
}

// ============================================================================
// Provider Event Broadcasting
// ============================================================================

/**
 * Emits an EIP-1193 provider event to all extension contexts.
 * Events are forwarded to content scripts for dApp notification.
 * 
 * @param event - Event type: 'connect', 'accountsChanged', 'chainChanged'
 * @param data - Event payload (accounts array, chain ID, etc.)
 */
function emitProviderEvent(event: 'connect' | 'accountsChanged' | 'chainChanged', data: any): void {
  chrome.runtime.sendMessage({ type: 'PROVIDER_EVENT', event, data }).catch(() => {});
}

/**
 * Broadcasts updated pending requests list to UI contexts.
 * Called when requests are added or resolved.
 */
function broadcastPendingRequests(): void {
  chrome.runtime.sendMessage({ type: 'PENDING_REQUESTS_UPDATED', pending: pendingRequests }).catch(() => {});
}

/**
 * Broadcasts account change to dApps via content scripts.
 * @param accounts - Array of account addresses (usually single address)
 */
function broadcastAccountsChanged(accounts: string[]): void {
  emitProviderEvent('accountsChanged', accounts);
}

/**
 * Broadcasts chain change to dApps via content scripts.
 * @param chainIdHex - Hex-encoded chain ID (e.g., '0x1' for mainnet)
 */
function broadcastChainChanged(chainIdHex: string): void {
  emitProviderEvent('chainChanged', chainIdHex);
}

/**
 * Generates a unique request ID for pending approval tracking.
 * @returns UUID or timestamp-based fallback ID
 */
function createRequestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ============================================================================
// EIP-712 Typed Data Helpers
// ============================================================================

/**
 * Prunes EIP-712 types to only include those reachable from the primary type.
 * Required because ethers.js signTypedData rejects unreferenced types.
 * 
 * @param primaryType - The main type being signed
 * @param types - Full types object from typed data
 * @returns Pruned types containing only referenced types
 */
function pruneTypedDataTypes(primaryType: string, types: Record<string, Array<{ name: string; type: string }>>): Record<string, Array<{ name: string; type: string }>> {
  if (!primaryType || !types) return types || {};
  const keep = new Set<string>();
  const stack = [primaryType];
  while (stack.length) {
    const type = stack.pop()!;
    if (keep.has(type)) continue;
    keep.add(type);
    const fields = types[type] || [];
    for (const field of fields) {
      const base = field.type.replace(/\[[^\]]*\]$/, ''); // strip array suffix
      if (types[base] && !keep.has(base)) stack.push(base);
    }
  }
  const pruned: Record<string, Array<{ name: string; type: string }>> = {};
  for (const key of keep) {
    if (types[key]) pruned[key] = types[key];
  }
  return pruned;
}

/**
 * Parses typed data input from various formats dApps may send.
 * Handles stringified JSON, double-escaped strings, and raw objects.
 * 
 * @param input - Raw input from dApp (string or object)
 * @returns Parsed typed data object
 * @throws Error if parsing fails for all attempted formats
 */
function parseTypedDataInput(input: any): any {
  if (typeof input !== 'string') return input;

  const trimmed = input.trim();
  console.log('[parseTypedDataInput] input length', trimmed.length, 'first 200:', trimmed.slice(0, 200));

  // If already looks like array or object literal, try directly
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      // continue to other approaches
    }
  }

  // Try stripping outer string wrapper (single or double quotes)
  const stripWrapper = (val: string) =>
    ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ? val.slice(1, -1)
      : val;
  const base = stripWrapper(trimmed);

  const candidates: string[] = [];
  candidates.push(base);
  candidates.push(base.replace(/\\"/g, '"'));
  candidates.push(base.replace(/\\'/g, "'"));
  candidates.push(base.replace(/\\\\/g, '\\'));

  for (const cand of candidates) {
    try {
      const first = JSON.parse(cand);
      if (typeof first === 'string') {
        try {
          return JSON.parse(stripWrapper(first));
        } catch {
          return first;
        }
      }
      return first;
    } catch (_) {
      continue;
    }
  }

  throw new Error('Failed to parse typed data');
}

/**
 * Adds a pending approval request and waits for user response.
 * Returns a promise that resolves when user approves or rejects.
 * 
 * @param request - Pending request to enqueue
 * @returns Promise that resolves when approved or rejects when denied
 */
function enqueueApproval(request: PendingRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    pendingRequests.push(request);
    approvalResolvers.set(request.id, { resolve, reject });
    broadcastPendingRequests();
  });
}

// ============================================================================
// Chrome Side Panel Configuration
// ============================================================================

/** Path to the side panel HTML file */
const SIDE_PANEL_PATH = 'extension/sidepanel/sidepanel.html';

/**
 * Configures Chrome Side Panel API to open on extension icon click.
 * Sets up the side panel behavior and path.
 * 
 * @param tabId - Optional tab ID for tab-specific panel configuration
 */
const configureSidePanel = async (tabId?: number) => {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (tabId && chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH });
    }
  } catch (error) {
    console.error('Failed to configure side panel:', error);
  }
};

chrome.runtime.onInstalled.addListener(() => configureSidePanel());
chrome.runtime.onStartup.addListener(() => configureSidePanel());

chrome.action.onClicked.addListener(async (tab) => {
  if (!chrome.sidePanel?.open || !tab) return;
  try {
    if (chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH });
    }
    // Try tab-scoped open first
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    }
    // Fallback to window-scoped open
    if (tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
});

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Minimal fallback configuration if bundled config.json fails to load.
 * Only includes Sepolia testnet for basic functionality.
 */
const fallbackConfig: Config & { network: string } = {
  network: 'sepolia',
  networks: {
    sepolia: {
      name: 'Sepolia Testnet',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      nativeSymbol: 'ETH',
      nativeName: 'Sepolia Ether',
      blockExplorer: 'https://sepolia.etherscan.io',
      explorerApiUrl: 'https://api-sepolia.etherscan.io/api'
    }
  }
};

/**
 * Loads the bundled config.json from the extension assets.
 * Falls back to minimal config if loading fails.
 * 
 * @returns Loaded configuration or fallback
 */
async function loadBundledConfig(): Promise<Config & { network: string }> {
  try {
    const configUrl = chrome.runtime.getURL('config.json');
    const response = await fetch(configUrl);
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.warn('Failed to load bundled config.json:', err);
  }
  return fallbackConfig;
}

// ============================================================================
// Wallet Service Initialization
// ============================================================================

/**
 * Initializes the wallet service for the extension.
 * Sets up storage, loads config, registers explorer APIs, and creates
 * the WalletAppService instance.
 * 
 * Called on extension install, startup, and when service worker wakes up.
 */
async function initializeWalletService(): Promise<void> {
  const storage = new ChromeStorageAdapter();
  await storage.initialize();

  await loadApprovedOrigins();

  // Load config from bundled asset (source of truth), with minimal fallback
  const bundledConfig = await loadBundledConfig();
  console.log('[Config] Loaded bundled config, networks:', Object.keys(bundledConfig.networks));
  
  // User overrides from storage (e.g., selected network) merged with bundled config
  const storedConfig = storage.readJSON<Partial<Config & { network: string; explorerApiKey?: string }>>('config.json', {});
  const config = { ...bundledConfig, ...storedConfig, networks: { ...bundledConfig.networks, ...storedConfig.networks } };

  // Register explorer API URLs from network config (pass global API key)
  const globalApiKey = (config as any).explorerApiKey;
  explorerAPI.registerNetworks(config.networks, globalApiKey);
  console.log('[Explorer] Registered networks:', explorerAPI.getRegisteredNetworks(), 'API key:', globalApiKey ? 'set' : 'not set');

  // Load bundled tokens.json (static asset)
  let builtInTokens = {};
  try {
    const tokensUrl = chrome.runtime.getURL('tokens.json');
    const response = await fetch(tokensUrl);
    if (response.ok) {
      builtInTokens = await response.json();
    }
  } catch (err) {
    console.warn('Failed to load bundled tokens.json:', err);
  }

  const wallet = new Wallet(config, storage, createProviderFactory());
  walletService = new WalletAppService(wallet, config, {
    storage,
    builtInTokens,
    customTokenPath: 'tokens-user.json',
    configPath: 'config.json'
  });

  await walletService.initialize();
}

// ============================================================================
// Auto-Lock Functionality
// ============================================================================

/**
 * Resets the auto-lock timer.
 * Called on every user interaction to extend the session.
 */
function resetAutoLockTimer(): void {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
  }

  autoLockTimer = setTimeout(() => {
    lockWallet();
  }, AUTO_LOCK_TIMEOUT);
}

/**
 * Locks the wallet and clears session state.
 * Broadcasts lock event to all extension contexts.
 */
function lockWallet(): void {
  isUnlocked = false;
  sessionPassword = null;
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  // Notify all extension contexts (popup, side panel, etc.) that wallet is locked
  // Use storage change event as a reliable broadcast mechanism
  chrome.storage.session.set({ walletLocked: Date.now() }).catch(() => {
    // Fallback for browsers without session storage
  });
  
  // Also try direct message (works for popup)
  chrome.runtime.sendMessage({ type: 'WALLET_LOCKED' }).catch(() => {
    // Ignore errors if no listeners
  });
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Chrome runtime message listener.
 * Routes all messages to handleMessage and sends async responses.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    sendResponse({ error: error.message });
  });
  return true; // Keep channel open for async response
});

/**
 * Main message handler for all extension communication.
 * Processes wallet operations, dApp requests, and state queries.
 * 
 * @param message - Message object with type and optional payload
 * @param sender - Chrome runtime message sender info
 * @returns Response object specific to message type
 * @throws Error for unknown types or operation failures
 */
async function handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { type, payload } = message;
  const origin = resolveOrigin(sender, payload);

  // Initialize if needed
  if (!walletService) {
    await initializeWalletService();
  }

  switch (type) {
    case 'GET_PENDING_REQUESTS':
      return { pending: pendingRequests };

    case 'RESOLVE_PENDING_REQUEST': {
      const { id, approved } = payload;
      const resolver = approvalResolvers.get(id);
      const idx = pendingRequests.findIndex(p => p.id === id);
      if (idx >= 0) pendingRequests.splice(idx, 1);
      if (resolver) {
        approvalResolvers.delete(id);
        if (approved) {
          resolver.resolve(true);
        } else {
          const err = new Error('User rejected request');
          (err as any).code = 4001;
          resolver.reject(err);
        }
      }
      broadcastPendingRequests();
      return { success: true };
    }

    case 'GET_STATE':
      return {
        isUnlocked,
        hasWallet: walletService!.getAllWallets() && Object.keys(walletService!.getAllWallets()).length > 0,
        network: walletService!.config.network,
        address: isUnlocked ? walletService!.getAddress() : null,
        currentWalletName: isUnlocked ? currentWalletName : null
      };

    case 'CREATE_WALLET':
      const walletName = payload.name || 'default';
      const createPassword = payload.password ?? sessionPassword;
      if (!createPassword) {
        throw new Error('Master password required');
      }
      sessionPassword = createPassword;
      const newWallet = walletService!.createWallet(createPassword);
      walletService!.saveWallet(walletName);
      currentWalletName = walletName;
      isUnlocked = true;

      broadcastAccountsChanged([newWallet.address]);

      // Initialize transaction history for this wallet
      const createStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(createStorage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: newWallet.address,
        mnemonic: newWallet.mnemonic
      };

    case 'IMPORT_WALLET':
      const importWalletName = payload.name || 'default';
      const importPassword = payload.password ?? sessionPassword;
      if (!importPassword) {
        throw new Error('Master password required');
      }
      sessionPassword = importPassword;
      const importedWallet = walletService!.importWallet(
        payload.mnemonic,
        importPassword,
        payload.accountIndex || 0
      );
      walletService!.saveWallet(importWalletName);
      currentWalletName = importWalletName;
      isUnlocked = true;

      broadcastAccountsChanged([importedWallet.address]);

      // Initialize transaction history for this wallet
      const importStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(importStorage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: importedWallet.address
      };

    case 'UNLOCK_WALLET':
      const unlockWalletName = payload.name || 'default';
      const unlockPassword = payload.password ?? sessionPassword;
      const loaded = walletService!.loadWallet(unlockWalletName, unlockPassword);
      if (!loaded) {
        throw new Error('Invalid password or wallet not found');
      }
      sessionPassword = unlockPassword || null;
      currentWalletName = unlockWalletName;
      isUnlocked = true;

      broadcastAccountsChanged([loaded.address]);

      // Initialize transaction history for this wallet
      const storage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(storage, currentWalletName);

      resetAutoLockTimer();
      return {
        success: true,
        address: loaded.address,
        walletName: currentWalletName
      };

    case 'LOCK_WALLET':
      lockWallet();
      return { success: true };

    case 'SWITCH_WALLET':
      const switchWalletName = payload.name;
      if (!switchWalletName) {
        throw new Error('Wallet name is required');
      }
      const switchPassword = sessionPassword;
      if (!switchPassword) {
        throw new Error('Session password not available. Please unlock wallet first.');
      }
      const switchedWallet = walletService!.loadWallet(switchWalletName, switchPassword);
      if (!switchedWallet) {
        throw new Error('Failed to load wallet or invalid password');
      }
      currentWalletName = switchWalletName;
      isUnlocked = true;
      
      // Initialize transaction history for the switched wallet
      const switchStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(switchStorage, currentWalletName);
      
      resetAutoLockTimer();
      return {
        success: true,
        address: switchedWallet.address,
        walletName: currentWalletName
      };

    case 'GET_BALANCE':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const balance = await walletService!.getBalance();
      return { balance };

    case 'GET_PORTFOLIO':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const portfolio = await walletService!.getPortfolioForNetwork(walletService!.config.network);
      return { portfolio };

    case 'SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const fromAddress = walletService!.getAddress();
      const network = walletService!.config.network;

      try {
        const result = await walletService!.sendToken(
          payload.token,
          payload.toAddress,
          payload.amount
        );

        // Track transaction in history
        if (transactionHistory && result.hash) {
          transactionHistory.addTransaction({
            hash: result.hash,
            from: fromAddress,
            to: payload.toAddress,
            value: payload.amount,
            network: network,
            status: TransactionStatus.PENDING,
            type: TransactionType.SEND,
            timestamp: Date.now(),
            tokenSymbol: payload.token.symbol,
            tokenAddress: payload.token.address
          });

          // Start monitoring for confirmation
          monitorTransaction(result.hash, network);
        }

        return { result };
      } catch (error: any) {
        // If transaction was submitted but failed, still track it
        if (error.transactionHash) {
          transactionHistory?.addTransaction({
            hash: error.transactionHash,
            from: fromAddress,
            to: payload.toAddress,
            value: payload.amount,
            network: network,
            status: TransactionStatus.FAILED,
            type: TransactionType.SEND,
            timestamp: Date.now(),
            tokenSymbol: payload.token.symbol,
            tokenAddress: payload.token.address,
            error: error.message
          });
        }
        throw error;
      }

    case 'SWITCH_NETWORK':
      await walletService!.setNetwork(payload.network);
      const chainHex = '0x' + walletService!.config.networks[payload.network].chainId.toString(16);
      broadcastChainChanged(chainHex);
      return { success: true, network: payload.network };

    case 'GET_NETWORKS':
      return { networks: walletService!.config.networks };

    case 'GET_TRANSACTION_HISTORY':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const transactions = transactionHistory?.getAllTransactions() || [];
      return { transactions };

    case 'GET_TRANSACTIONS_BY_NETWORK':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const networkTxs = transactionHistory?.getTransactionsByNetwork(payload.network) || [];
      return { transactions: networkTxs };

    case 'GET_EXPLORER_TRANSACTIONS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      try {
        const explorerAddress = payload.address || walletService!.getAddress();
        const explorerNetwork = payload.network || walletService!.config.network;
        const isSupported = explorerAPI.isSupported(explorerNetwork);
        
        console.log('[Explorer] Request:', { network: explorerNetwork, address: explorerAddress, isSupported });
        
        if (!isSupported) {
          console.log('[Explorer] Network not supported, registered networks:', explorerAPI.getRegisteredNetworks?.() || 'unknown');
          return { transactions: [], supported: false };
        }
        
        const explorerTxs = await explorerAPI.getAllTransactions(
          explorerAddress,
          explorerNetwork,
          payload.page || 1,
          payload.pageSize || 25
        );
        console.log('[Explorer] Fetched transactions:', explorerTxs.length);
        return { transactions: explorerTxs, supported: true };
      } catch (err: any) {
        console.error('Failed to fetch explorer transactions:', err);
        return { transactions: [], error: err.message, supported: true };
      }

    case 'ADD_CUSTOM_TOKEN':
      walletService!.addCustomToken(walletService!.config.network, payload.token);
      return { success: true };

    case 'GET_TOKEN_METADATA':
      if (!isUnlocked) throw new Error('Wallet is locked');
      try {
        const metadata = await walletService!.wallet.getTokenMetadata(payload.address);
        return { metadata };
      } catch (err: any) {
        return { error: err.message || 'Failed to fetch token metadata' };
      }

    case 'GET_TOKENS':
      const tokens = walletService!.getTokensForNetwork(payload.network || walletService!.config.network);
      return { tokens };

    case 'GET_ADDRESS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      return { address: walletService!.getAddress() };

    case 'GET_SECRET_PHRASE':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      if (!payload.password) throw new Error('Password required');
      try {
        const mnemonic = walletService!.getMnemonic(payload.password);
        return { mnemonic };
      } catch (err: any) {
        return { error: err.message || 'Failed to retrieve secret phrase' };
      }

    case 'GET_PRIVATE_KEY':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      if (!payload.password) throw new Error('Password required');
      try {
        const privateKey = walletService!.getPrivateKey(payload.password);
        return { privateKey };
      } catch (err: any) {
        return { error: err.message || 'Failed to retrieve private key' };
      }

    case 'GET_ACCOUNTS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const accounts = walletService!.getWalletAccounts(currentWalletName);
      const currentAccountIndex = walletService!.getCurrentAccountIndex();
      return { accounts, currentWalletName, currentAccountIndex };

    case 'CREATE_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const currentAccounts = walletService!.getWalletAccounts(currentWalletName);
      const nextIndex = Object.keys(currentAccounts).length;
      const newAccount = walletService!.switchAccount(nextIndex);
      walletService!.saveWallet(currentWalletName);
      return { success: true, address: newAccount.address, index: newAccount.accountIndex };

    case 'SWITCH_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const switchedAccount = walletService!.switchAccount(payload.index);
      walletService!.saveWallet(currentWalletName); // Save the wallet with new active account
      broadcastAccountsChanged([switchedAccount.address]);
      return { success: true, address: switchedAccount.address, index: switchedAccount.accountIndex };

    case 'GET_ALL_WALLETS':
      // Allow getting wallet list even when locked (needed for unlock screen)
      const allWallets = walletService!.getAllWallets();
      return { wallets: allWallets };

    case 'DELETE_WALLET':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const deleted = walletService!.deleteWallet(payload.name);
      return { success: deleted };

    // dApp provider methods
    case 'ETH_ACCOUNTS':
      if (!isUnlocked) return { accounts: [] };
      resetAutoLockTimer();
      return { accounts: [walletService!.getAddress()] };

    case 'ETH_REQUEST_ACCOUNTS':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      if (pendingRequests.some(r => r.type === 'connect')) {
        throw new Error('Connection request already pending');
      }
      await enqueueApproval({
        id: createRequestId(),
        type: 'connect',
        origin: origin || 'unknown',
        createdAt: Date.now()
      });
      const addr = walletService!.getAddress();
      if (origin) {
        approvedDappOrigins.add(origin);
        saveApprovedOrigins();
      }
      emitProviderEvent('connect', { chainId: '0x' + walletService!.config.networks[walletService!.config.network].chainId.toString(16) });
      broadcastAccountsChanged([addr]);
      return { accounts: [addr] };

    case 'ETH_NET_VERSION': {
      const chainId = walletService!.config.networks[walletService!.config.network].chainId;
      return chainId.toString(10);
    }

    case 'GENERIC_RPC': {
      const { method, params } = payload || {};
      if (!method) throw new Error('Missing RPC method');
      // Block signing/transaction methods from generic passthrough
      const blocked = new Set([
        'eth_sendTransaction',
        'eth_sign',
        'personal_sign',
        'eth_signTypedData',
        'eth_signTypedData_v4',
        'personal_ecRecover',
        'eth_requestAccounts',
        'eth_accounts'
      ]);
      if (blocked.has(method)) {
        throw new Error('Method not supported');
      }
      const provider = walletService!.wallet?.provider;
      if (!provider) throw new Error('Provider not available');
      // Allow read-only RPCs while locked
      return provider.send(method, params || []);
    }

    case 'ETH_CHAIN_ID':
      const networkConfig = walletService!.config.networks[walletService!.config.network];
      return { chainId: '0x' + networkConfig.chainId.toString(16) };

    case 'ETH_SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      if (!payload?.params || !Array.isArray(payload.params) || payload.params.length === 0) {
        throw new Error('Invalid transaction params');
      }
      const tx = payload.params[0];
      const currentAddress = walletService!.getAddress();
      if (!tx.from || tx.from.toLowerCase() !== currentAddress.toLowerCase()) {
        throw new Error('Transaction from address must match current account');
      }
      const pendingId = createRequestId();
      await enqueueApproval({ id: pendingId, type: 'transaction', origin: sender.origin || 'unknown', createdAt: Date.now(), tx });

      const signer = walletService!.wallet.wallet;
      if (!signer) throw new Error('No signer available');
      const txRequest: ethers.TransactionRequest = {
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gasLimit: tx.gas || tx.gasLimit,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        gasPrice: tx.gasPrice
      };
      const resp = await signer.sendTransaction(txRequest);
      return resp;

    case 'PERSONAL_SIGN':
    case 'ETH_SIGN':
    case 'ETH_SIGN_TYPED_DATA':
    case 'ETH_SIGN_TYPED_DATA_V4': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const params = payload?.params || [];
      const addr = walletService!.getAddress();
      const pendingId = createRequestId();
      await enqueueApproval({ id: pendingId, type: 'signature', origin: sender.origin || 'unknown', createdAt: Date.now(), method: type, params });

      const signer = walletService!.wallet.wallet;
      if (!signer) throw new Error('No signer available');

      if (type === 'PERSONAL_SIGN' || type === 'ETH_SIGN') {
        const message = params[0];
        const bytes = typeof message === 'string' && message.startsWith('0x') ? ethers.getBytes(message) : new TextEncoder().encode(String(message));
        const sig = await signer.signMessage(bytes);
        return sig;
      }

      // Typed data (legacy and v4)
      // Legacy eth_signTypedData sends [msgParams, from] where msgParams is an array
      // V3/V4 send [from, msgParamsStringified]
      let dataStr: any;
      if (Array.isArray(params[0])) {
        // Legacy v1 format: params[0] is the typed data array
        dataStr = params[0];
      } else if (typeof params[1] === 'string' && !params[1].startsWith('0x')) {
        // v3/v4 format: params[1] is stringified typed data
        dataStr = params[1];
      } else if (typeof params[0] === 'string' && !params[0].startsWith('0x')) {
        // Fallback: params[0] might be stringified typed data
        dataStr = params[0];
      } else {
        // Try params[1] first (v3/v4), then params[0]
        dataStr = params[1] ?? params[0];
      }
      if (!dataStr) {
        throw new Error('Invalid typed data params');
      }

      let parsed: any = dataStr;
      if (typeof dataStr === 'string') {
        parsed = parseTypedDataInput(dataStr);
      }

      // Legacy array format: [{ type, name, value }, ...]
      // eth-sig-util V1: typedSignatureHash then raw EC sign (no Ethereum prefix)
      if (Array.isArray(parsed)) {
        const items = parsed as Array<{ type: string; name: string; value: any }>;
        const types = items.map(i => i.type);
        const values = items.map(i => i.value);
        const hash = ethers.solidityPackedKeccak256(types as any, values as any);
        // V1 signs the raw hash without the Ethereum message prefix
        const signingKey = (signer as any).signingKey;
        if (signingKey && typeof signingKey.sign === 'function') {
          const sig = signingKey.sign(hash);
          return ethers.Signature.from(sig).serialized;
        }
        // Fallback if signingKey not accessible - this may not verify correctly
        const sig = await signer.signMessage(ethers.getBytes(hash));
        return typeof sig === 'string' ? sig : ethers.Signature.from(sig).serialized;
      }

      const { domain, types, message: msg, primaryType } = parsed || {};
      const { EIP712Domain, ...restTypes } = types || {};
      const resolvedPrimary = primaryType || parsed.primaryType || Object.keys(restTypes || {}).find(k => k);
      if (!resolvedPrimary) {
        throw new Error('Typed data primaryType is required');
      }
      if (!restTypes?.[resolvedPrimary]) {
        throw new Error(`primaryType "${resolvedPrimary}" not found in types`);
      }
      const prunedTypes = pruneTypedDataTypes(resolvedPrimary, restTypes || {});
      const sig = await signer.signTypedData(domain || {}, prunedTypes, msg ?? parsed.message ?? {}, resolvedPrimary);
      return typeof sig === 'string' ? sig : ethers.Signature.from(sig).serialized;
    }

    case 'PERSONAL_EC_RECOVER': {
      const params = payload?.params || [];
      const message = params[0];
      const signature = params[1];
      if (!message || !signature) {
        throw new Error('Invalid params for personal_ecRecover');
      }
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      // If message is hex-prefixed, interpret as bytes; else as utf8 of the stringified value
      const bytes = messageStr.startsWith('0x') ? ethers.getBytes(messageStr) : new TextEncoder().encode(messageStr);
      const recovered = ethers.verifyMessage(bytes, signature);
      return recovered.toLowerCase();
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// ============================================================================
// Transaction Monitoring
// ============================================================================

/**
 * Monitors a pending transaction for confirmation.
 * Polls the blockchain every 5 seconds for up to 5 minutes.
 * Updates transaction history when confirmed or failed.
 * 
 * @param txHash - Transaction hash to monitor
 * @param network - Network identifier for the transaction
 */
async function monitorTransaction(txHash: string, network: string) {
  if (!walletService || !transactionHistory) return;

  const maxAttempts = 60; // Monitor for up to 5 minutes (60 * 5 seconds)
  let attempts = 0;

  const checkTransaction = async () => {
    try {
      const provider = walletService!.wallet?.provider;
      if (!provider) return;

      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt) {
        // Transaction confirmed
        const status = receipt.status === 1 ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED;

        transactionHistory!.updateTransactionStatus(
          txHash,
          status,
          receipt.blockNumber,
          receipt.status === 0 ? 'Transaction reverted' : undefined
        );

        console.log(`Transaction ${txHash} ${status}`);
      } else if (attempts < maxAttempts) {
        // Still pending, check again in 5 seconds
        attempts++;
        setTimeout(checkTransaction, 5000);
      }
    } catch (error) {
      console.error('Error monitoring transaction:', error);
      // Retry on error
      if (attempts < maxAttempts) {
        attempts++;
        setTimeout(checkTransaction, 5000);
      }
    }
  };

  // Start monitoring
  setTimeout(checkTransaction, 5000);
}

// ============================================================================
// Extension Lifecycle Events
// ============================================================================

/** Initialize wallet service when extension is first installed */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Simple Crypto Wallet extension installed');
  initializeWalletService();
});

/** Initialize wallet service on browser startup */
initializeWalletService();

console.log('Simple Crypto Wallet background service worker loaded');
