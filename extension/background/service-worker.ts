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

import '../../src/process-polyfill.js'; // Install process shim early (readable-stream expects it)
import '../../src/buffer-polyfill.js'; // Install Buffer polyfill
import { Wallet } from '../../src/wallet.js';
import { WalletAppService } from '../../src/app-service.js';
import { ChromeStorageAdapter } from '../../src/chrome-storage.js';
import { createProviderFactory } from '../../src/providers.js';
import { setCryptoAdapter } from '../../src/crypto-utils.js';
import { createWebCryptoAdapter } from '../../src/crypto-adapter.js';
import { TransactionHistoryManager, TransactionStatus, TransactionType } from '../../src/transaction-history.js';
import { explorerAPI } from '../../src/explorer-api.js';
import { getTokenPrices, calculateTotalValue, formatUSDValue, getBitcoinPrice, getSolanaPrice, isBitcoinNetworkKey, isSolanaNetworkKey, type TokenInfo } from '../../src/price-service.js';
import { isBitcoinNetworkConfig, isEVMNetworkConfig, isSolanaNetworkConfig } from '../../src/types/config.js';
import { applyExplorerApiKeys } from '../../src/config-utils.js';
import type { Config } from '../../src/types/index.js';
import { getBitcoinExplorer, getBitcoinProvider, satoshisToBtc } from '../../src/bitcoin/index.js';
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
// Balance Cache
// ============================================================================

/**
 * Cached token balance entry
 */
interface CachedBalance {
  balance: string;
  lastUpdated: number;
}

/**
 * Balance cache structure: network -> tokenKey -> CachedBalance
 * tokenKey is 'native' for native currency or lowercase token address
 */
interface BalanceCache {
  [network: string]: {
    [tokenKey: string]: CachedBalance;
  };
}

/** In-memory balance cache */
let balanceCache: BalanceCache = {};

/** Balance polling interval timer */
let balancePollingTimer: NodeJS.Timeout | null = null;

/** Balance polling interval: 30 seconds */
const BALANCE_POLLING_INTERVAL = 30 * 1000;

/** Balance cache TTL: 5 minutes (used to determine if cache is stale) */
const BALANCE_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get token cache key
 */
function getTokenCacheKey(token: { type?: string; address?: string }): string {
  return token.type === 'native' ? 'native' : (token.address || '').toLowerCase();
}

/**
 * Get cached balance for a token
 */
function getCachedBalance(network: string, token: { type?: string; address?: string }): CachedBalance | null {
  const key = getTokenCacheKey(token);
  return balanceCache[network]?.[key] || null;
}

/**
 * Update cached balance for a token
 */
function setCachedBalance(network: string, token: { type?: string; address?: string }, balance: string): void {
  if (!balanceCache[network]) {
    balanceCache[network] = {};
  }
  const key = getTokenCacheKey(token);
  balanceCache[network][key] = {
    balance,
    lastUpdated: Date.now()
  };
}

/**
 * Clear balance cache for a network (or all networks)
 */
function clearBalanceCache(network?: string): void {
  if (network) {
    delete balanceCache[network];
  } else {
    balanceCache = {};
  }
}

/**
 * Load balance cache from persistent storage
 */
async function loadBalanceCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('balanceCache');
    if (result.balanceCache) {
      balanceCache = result.balanceCache;
      console.log('[BalanceCache] Loaded from storage');
    }
  } catch (err) {
    console.warn('[BalanceCache] Failed to load from storage:', err);
  }
}

/**
 * Save balance cache to persistent storage
 */
async function saveBalanceCache(): Promise<void> {
  try {
    await chrome.storage.local.set({ balanceCache });
  } catch (err) {
    console.warn('[BalanceCache] Failed to save to storage:', err);
  }
}

/**
 * Broadcast balance update to all UI contexts
 */
function broadcastBalanceUpdate(network: string, balances: { token: any; balance: string }[]): void {
  chrome.runtime.sendMessage({
    type: 'BALANCES_UPDATED',
    network,
    balances
  }).catch(() => {});
}

/**
 * Start balance polling
 */
function startBalancePolling(): void {
  if (balancePollingTimer) return;
  
  balancePollingTimer = setInterval(async () => {
    if (!isUnlocked || !walletService) return;
    
    try {
      await refreshBalancesForCurrentNetwork();
    } catch (err) {
      console.warn('[BalancePolling] Error:', err);
    }
  }, BALANCE_POLLING_INTERVAL);
  
  console.log('[BalancePolling] Started');
}

/**
 * Stop balance polling
 */
function stopBalancePolling(): void {
  if (balancePollingTimer) {
    clearInterval(balancePollingTimer);
    balancePollingTimer = null;
    console.log('[BalancePolling] Stopped');
  }
}

// ============================================================================
// Balance Refresh (Network-Aware)
// ============================================================================

async function refreshBalancesForCurrentNetwork(): Promise<void> {
  if (!isUnlocked || !walletService) return;

  const network = walletService.config.network;
  const networkConfig = walletService.config.networks[network];

  if (isBitcoinNetworkConfig(networkConfig) || isSolanaNetworkConfig(networkConfig)) {
    const portfolio = await walletService.getPortfolioForNetwork(network);

    for (const item of portfolio) {
      if (!item.error) {
        setCachedBalance(network, item.token, item.balance);
      }
    }

    await saveBalanceCache();
    broadcastBalanceUpdate(network, portfolio);
    return;
  }

  const tokens = walletService.getTokensForNetwork(network);
  const balances = await walletService.fetchBalances(tokens);

  for (const item of balances) {
    if (!item.error) {
      setCachedBalance(network, item.token, item.balance);
    }
  }

  await saveBalanceCache();
  broadcastBalanceUpdate(network, balances);
}

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
 * Broadcasts transaction status update to the UI.
 * @param hash - Transaction hash
 * @param status - Current status: 'pending' | 'confirmed' | 'failed'
 * @param network - Network identifier
 * @param blockNumber - Block number (for confirmed transactions)
 * @param error - Error message (for failed transactions)
 */
function broadcastTransactionStatus(
  hash: string,
  status: 'pending' | 'confirmed' | 'failed',
  network: string,
  blockNumber?: number,
  error?: string
): void {
  chrome.runtime.sendMessage({
    type: 'TRANSACTION_STATUS_UPDATE',
    payload: { hash, status, network, blockNumber, error }
  }).catch(() => {
    // Popup may not be open - ignore
  });
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

/** Path to the side panel HTML file (at root after build) */
const SIDE_PANEL_PATH = 'sidepanel.html';

/**
 * Configures Chrome Side Panel API to open on extension icon click.
 */
const configureSidePanel = async () => {
  console.log('[SidePanel] Configuring side panel...');

  if (!chrome.sidePanel) {
    console.error('[SidePanel] chrome.sidePanel API not available');
    return;
  }

  try {
    // Set the default panel path globally
    if (chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH });
      console.log('[SidePanel] Set options with path:', SIDE_PANEL_PATH);
    }

    // Enable opening panel on action click
    if (chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      console.log('[SidePanel] Set openPanelOnActionClick: true');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to configure:', error);
  }
};

// Configure side panel on various lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  console.log('[SidePanel] onInstalled event');
  configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[SidePanel] onStartup event');
  configureSidePanel();
});

// IMPORTANT: Also configure immediately when service worker loads
configureSidePanel();

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

  // IMPORTANT: deep-merge network configs so older stored configs don't wipe new bundled fields.
  // - bundledConfig.networks is the source of truth
  // - storedConfig.network is a user preference (selected network)
  // - storedConfig.networks can override specific fields or add custom networks
  const mergedNetworks: Record<string, any> = { ...bundledConfig.networks };
  if (storedConfig.networks) {
    for (const [networkKey, storedNetwork] of Object.entries(storedConfig.networks)) {
      const bundledNetwork = (bundledConfig.networks as any)[networkKey];
      mergedNetworks[networkKey] = bundledNetwork
        ? { ...bundledNetwork, ...storedNetwork }
        : storedNetwork;
    }
  }

  const mergedConfig = { ...bundledConfig, ...storedConfig, networks: mergedNetworks };
  const { config, globalApiKey } = applyExplorerApiKeys(mergedConfig, import.meta.env as Record<string, string | undefined>);

  // Register explorer API URLs from network config (pass global API key)
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
  
  // Stop balance polling
  stopBalancePolling();

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
// Bitcoin Confirmation Polling (best-effort)
// ============================================================================

const bitcoinConfirmationPollers = new Map<string, NodeJS.Timeout>();

function startBitcoinConfirmationPolling(txid: string, networkKey: string): void {
  if (bitcoinConfirmationPollers.has(txid)) return;

  const explorer = getBitcoinExplorer(networkKey);
  const startedAt = Date.now();
  const maxMs = 2 * 60 * 1000; // 2 minutes
  const intervalMs = 10 * 1000; // 10 seconds

  const timer = setInterval(async () => {
    try {
      if (Date.now() - startedAt > maxMs) {
        clearInterval(timer);
        bitcoinConfirmationPollers.delete(txid);
        return;
      }

      const tx = await explorer.getTransaction(txid);
      if (!tx) return;

      if (tx.status?.confirmed) {
        clearInterval(timer);
        bitcoinConfirmationPollers.delete(txid);

        const blockNumber = tx.status.block_height;
        if (transactionHistory) {
          transactionHistory.updateTransactionStatus(txid, TransactionStatus.CONFIRMED, blockNumber);
        }
        broadcastTransactionStatus(txid, 'confirmed', networkKey, blockNumber);
        refreshBalancesForCurrentNetwork().catch(() => {});
      }
    } catch {
      // Ignore transient errors; keep polling until timeout.
    }
  }, intervalMs);

  bitcoinConfirmationPollers.set(txid, timer);
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
        address: walletService!.getAddress(),
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
        address: walletService!.getAddress()
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

      // Load balance cache and start polling
      await loadBalanceCache();
      // Immediately refresh balances for the active network to avoid stale cache
      refreshBalancesForCurrentNetwork().catch(err => {
        console.warn('[BalanceRefresh] Error:', err);
      });
      startBalancePolling();

      resetAutoLockTimer();
      return {
        success: true,
        address: walletService!.getAddress(),
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
        address: walletService!.getAddress(),
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

    case 'GET_TOKENS':
      // Returns token list immediately without fetching balances
      // Includes cached balances if available
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const currentNetwork = walletService!.config.network;
      const tokenList = walletService!.getTokensForNetwork(currentNetwork);
      
      // Attach cached balances to tokens
      const tokensWithCachedBalances = tokenList.map(token => {
        const cached = getCachedBalance(currentNetwork, token);
        return {
          token,
          balance: cached?.balance || null,
          lastUpdated: cached?.lastUpdated || null,
          isLoading: cached === null
        };
      });
      
      return { tokens: tokensWithCachedBalances, network: currentNetwork };

    case 'REFRESH_BALANCES':
      // Trigger async balance refresh for current network
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      refreshBalancesForCurrentNetwork().catch(err => {
        console.warn('[REFRESH_BALANCES] Error:', err);
      });
      return { success: true, message: 'Balance refresh started' };

    case 'GET_CACHED_BALANCES':
      // Returns only cached balances for a network
      if (!isUnlocked) throw new Error('Wallet is locked');
      const cacheNetwork = payload?.network || walletService!.config.network;
      return { 
        balances: balanceCache[cacheNetwork] || {},
        network: cacheNetwork
      };

    case 'GET_TOKEN_PRICES': {
      // Fetch prices for tokens and calculate total portfolio value
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const priceNetwork = walletService!.config.network;
      const networkConfig = walletService!.config.networks[priceNetwork];

      // Handle Bitcoin networks differently
      if (isBitcoinNetworkKey(priceNetwork)) {
        try {
          const btcPrice = await getBitcoinPrice();
          const cached = getCachedBalance(priceNetwork, { type: 'native' });
          const balance = cached?.balance || '0';
          const btcAmount = parseFloat(balance);
          const totalValue = btcPrice ? btcAmount * btcPrice : 0;

          return {
            prices: { native: btcPrice },
            totalValue,
            formattedTotal: formatUSDValue(totalValue),
            network: priceNetwork,
            isBitcoin: true
          };
        } catch (error) {
          console.warn('[GET_TOKEN_PRICES] Bitcoin price error:', error);
          return {
            prices: {},
            totalValue: 0,
            formattedTotal: '$0.00',
            network: priceNetwork,
            isBitcoin: true,
            error: 'Failed to fetch Bitcoin price'
          };
        }
      }

      // Handle Solana networks (native SOL only in Phase 1)
      if (isSolanaNetworkKey(priceNetwork)) {
        try {
          const solPrice = await getSolanaPrice();
          const cached = getCachedBalance(priceNetwork, { type: 'native' });
          const balance = cached?.balance || '0';
          const solAmount = parseFloat(balance);
          const totalValue = solPrice ? solAmount * solPrice : 0;

          return {
            prices: { native: solPrice },
            totalValue,
            formattedTotal: formatUSDValue(totalValue),
            network: priceNetwork,
            isSolana: true
          };
        } catch (error) {
          console.warn('[GET_TOKEN_PRICES] Solana price error:', error);
          return {
            prices: {},
            totalValue: 0,
            formattedTotal: '$0.00',
            network: priceNetwork,
            isSolana: true,
            error: 'Failed to fetch Solana price'
          };
        }
      }

      // EVM networks
      const chainId = 'chainId' in networkConfig ? networkConfig.chainId : 1;

      // Get tokens with balances
      const priceTokens = walletService!.getTokensForNetwork(priceNetwork);
      const tokenInfos: TokenInfo[] = priceTokens.map(t => ({
        type: t.type,
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals
      }));

      // Build balances array from cache
      const balancesForCalc = priceTokens.map(token => {
        const cached = getCachedBalance(priceNetwork, token);
        return {
          token: {
            type: token.type as 'native' | 'erc20',
            symbol: token.symbol,
            address: token.address,
            decimals: token.decimals
          },
          balance: cached?.balance || '0'
        };
      });

      try {
        // Fetch prices from CoinGecko
        const prices = await getTokenPrices(chainId, tokenInfos);

        // Calculate total value
        const totalValue = calculateTotalValue(balancesForCalc, prices);

        // Convert prices map to object for response
        const pricesObj: Record<string, number | null> = {};
        prices.forEach((value, key) => {
          pricesObj[key] = value;
        });

        return {
          prices: pricesObj,
          totalValue,
          formattedTotal: formatUSDValue(totalValue),
          network: priceNetwork,
          chainId
        };
      } catch (error) {
        console.warn('[GET_TOKEN_PRICES] Error:', error);
        return {
          prices: {},
          totalValue: 0,
          formattedTotal: '$0.00',
          network: priceNetwork,
          chainId,
          error: 'Failed to fetch prices'
        };
      }
    }

    case 'SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const fromAddress = walletService!.getAddress();
      const network = walletService!.config.network;
      const sendNetworkConfig = walletService!.config.networks[network];

      try {
        if (isSolanaNetworkConfig(sendNetworkConfig)) {
          throw new Error('Sending SOL is not supported yet');
        }

        // Bitcoin send path (broadcast + pending)
        if (isBitcoinNetworkConfig(sendNetworkConfig)) {
          if (!sessionPassword) {
            throw new Error('Session password not available. Please unlock wallet again.');
          }

          const result = await walletService!.sendBitcoinTransaction(
            payload.toAddress,
            payload.amount,
            sessionPassword
          );

          // Track transaction in history as pending
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
              tokenSymbol: sendNetworkConfig.nativeSymbol || 'BTC',
              tokenAddress: ''
            });
          }

          broadcastTransactionStatus(result.hash, 'pending', network);
          startBitcoinConfirmationPolling(result.hash, network);

          return {
            result: {
              hash: result.hash,
              status: 'pending',
              feeBtc: result.feeBtc,
              feeSats: result.feeSats,
              vbytes: result.vbytes
            }
          };
        }

        // EVM path: call sendToken - this waits for confirmation
        const result = await walletService!.sendToken(payload.token, payload.toAddress, payload.amount);

        // Track transaction in history as confirmed
        if (transactionHistory && result.hash) {
          transactionHistory.addTransaction({
            hash: result.hash,
            from: fromAddress,
            to: payload.toAddress,
            value: payload.amount,
            network: network,
            status: TransactionStatus.CONFIRMED,
            type: TransactionType.SEND,
            timestamp: Date.now(),
            tokenSymbol: payload.token.symbol,
            tokenAddress: payload.token.address,
            blockNumber: result.blockNumber
          });

          // Broadcast confirmation
          broadcastTransactionStatus(result.hash, 'confirmed', network, result.blockNumber);
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
          broadcastTransactionStatus(error.transactionHash, 'failed', network, undefined, error.message);
        }
        throw error;
      }

    case 'GET_NETWORK_CONFIG': {
      if (!walletService) throw new Error('Wallet not initialized');
      const netConfigNetwork = walletService.config.network;
      const netConfigData = walletService.config.networks[netConfigNetwork];
      const isBitcoin = isBitcoinNetworkConfig(netConfigData);
      const isSolana = isSolanaNetworkConfig(netConfigData);
      return {
        network: netConfigNetwork,
        blockExplorer: netConfigData?.blockExplorer || null,
        chainId: isEVMNetworkConfig(netConfigData) ? netConfigData.chainId : undefined,
        isBitcoin,
        isSolana,
        bitcoinNetwork: isBitcoin ? (netConfigData as any).bitcoinNetwork : undefined,
        solanaCluster: isSolana ? (netConfigData as any).solanaCluster : undefined
      };
    }

    case 'GET_GAS_ESTIMATE': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      if (!walletService) throw new Error('Wallet not initialized');
      resetAutoLockTimer();

      const { token, toAddress, amount } = payload;
      // Use shared gas estimation from WalletAppService
      return walletService.getGasEstimate(token, toAddress, amount);
    }

    case 'SWITCH_NETWORK':
      await walletService!.setNetwork(payload.network);
      const switchNetworkConfig = walletService!.config.networks[payload.network];
      // Clear cached balances for the target network to avoid stale data bleed
      clearBalanceCache(payload.network);
      saveBalanceCache().catch(() => {});
      // Kick off a refresh for the new network (non-blocking)
      refreshBalancesForCurrentNetwork().catch(() => {});
      // Only broadcast chainChanged for EVM networks (Bitcoin doesn't have chainId)
      if (isEVMNetworkConfig(switchNetworkConfig)) {
        const chainHex = '0x' + switchNetworkConfig.chainId.toString(16);
        broadcastChainChanged(chainHex);
      }
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
        const explorerNetworkConfig = walletService!.config.networks[explorerNetwork];

        // Bitcoin networks use Mempool.space API via the Bitcoin module
        if (isBitcoinNetworkConfig(explorerNetworkConfig)) {
          const provider = getBitcoinProvider(explorerNetwork);
          const limit = payload.pageSize || 25;
          const btcTxs = await provider.getTransactionHistory(explorerAddress, limit);

          const nativeSymbol = explorerNetworkConfig.nativeSymbol || (explorerNetwork === 'bitcoin-testnet' ? 'tBTC' : 'BTC');

          const transactions = btcTxs.map((tx) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to || null,
            // Convert sats → BTC string so ActivityView doesn't treat it as wei
            value: satoshisToBtc(Number(tx.value) || 0),
            network: explorerNetwork,
            status: tx.status,
            type: tx.type,
            timestamp: tx.timestamp,
            blockNumber: tx.blockNumber || undefined,
            tokenSymbol: nativeSymbol,
            // Optional enhancement: include fee in BTC for tooltip display
            fee: satoshisToBtc(Number(tx.fee) || 0)
          }));

          return { transactions, supported: true };
        }

        // Solana explorer fetching not supported yet (Phase 2+)
        if (isSolanaNetworkConfig(explorerNetworkConfig)) {
          return { transactions: [], supported: false };
        }

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
      return { success: true, address: walletService!.getAddress(), index: newAccount.accountIndex };

    case 'SWITCH_ACCOUNT':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const switchedAccount = walletService!.switchAccount(payload.index);
      walletService!.saveWallet(currentWalletName); // Save the wallet with new active account
      broadcastAccountsChanged([switchedAccount.address]);
      return { success: true, address: walletService!.getAddress(), index: switchedAccount.accountIndex };

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
      {
        const evmConfig = walletService!.config.networks[walletService!.config.network];
        if (!isEVMNetworkConfig(evmConfig)) {
          return { accounts: [] };
        }
        return { accounts: [walletService!.getAddress()] };
      }

    case 'ETH_REQUEST_ACCOUNTS': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const ethReqNetworkConfig = walletService!.config.networks[walletService!.config.network];
      if (!isEVMNetworkConfig(ethReqNetworkConfig)) {
        throw new Error('eth_requestAccounts is only supported on EVM networks');
      }
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
      emitProviderEvent('connect', { chainId: '0x' + ethReqNetworkConfig.chainId.toString(16) });
      broadcastAccountsChanged([addr]);
      return { accounts: [addr] };
    }

    case 'ETH_NET_VERSION': {
      const netVersionConfig = walletService!.config.networks[walletService!.config.network];
      if (!isEVMNetworkConfig(netVersionConfig)) {
        throw new Error('eth_net_version is only supported on EVM networks');
      }
      return netVersionConfig.chainId.toString(10);
    }

    case 'GENERIC_RPC': {
      const { method, params } = payload || {};
      if (!method) throw new Error('Missing RPC method');
      const rpcNetworkConfig = walletService!.config.networks[walletService!.config.network];
      if (!isEVMNetworkConfig(rpcNetworkConfig)) {
        throw new Error('RPC passthrough is only supported on EVM networks');
      }
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

    case 'ETH_CHAIN_ID': {
      const chainIdConfig = walletService!.config.networks[walletService!.config.network];
      if (!isEVMNetworkConfig(chainIdConfig)) {
        throw new Error('eth_chainId is only supported on EVM networks');
      }
      return { chainId: '0x' + chainIdConfig.chainId.toString(16) };
    }

    case 'ETH_SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      {
        const evmSendConfig = walletService!.config.networks[walletService!.config.network];
        if (!isEVMNetworkConfig(evmSendConfig)) {
          throw new Error('eth_sendTransaction is only supported on EVM networks');
        }
      }
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
      {
        const evmSignConfig = walletService!.config.networks[walletService!.config.network];
        if (!isEVMNetworkConfig(evmSignConfig)) {
          throw new Error('Signing is only supported on EVM networks');
        }
      }
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
