/**
 * @file service-worker.ts
 * @description Chrome extension background service worker for the Simple Wallet.
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
 * - GET_NETWORKS, GET_SHOW_TESTNETS, SET_SHOW_TESTNETS
 * - ETH_ACCOUNTS, ETH_REQUEST_ACCOUNTS, ETH_SEND_TRANSACTION
 * - PERSONAL_SIGN, ETH_SIGN_TYPED_DATA_V4, PERSONAL_EC_RECOVER
 * - GET_SECRET_PHRASE, GET_PRIVATE_KEY, CHANGE_PASSWORD
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

// Polyfills must be imported first (before any code using Buffer/process runs).
// These are lightweight shims that only set globals if missing - no startup delay.
import '../../src/process-polyfill.js'; // process + window shims for @solana/web3.js, readable-stream
import '../../src/buffer-polyfill.js'; // Buffer for crypto-utils, bitcoin module
import { applyNetworkGuard } from '../../src/utils/network-guard.js';

// Apply network security guard immediately
applyNetworkGuard();

import { Wallet } from '../../src/wallet.js';
import { WalletAppService } from '../../src/app-service.js';
import { getWalletNameValidationMessage, isValidWalletName } from '../../src/wallet-name.js';
import { ChromeStorageAdapter } from '../../src/chrome-storage.js';
import { createProviderFactory } from '../../src/providers.js';
import { setCryptoAdapter } from '../../src/crypto-utils.js';
import { createWebCryptoAdapter } from '../../src/crypto-adapter.js';
import { TransactionHistoryManager, TransactionStatus, TransactionType } from '../../src/transaction-history.js';
import { explorerAPI } from '../../src/explorer-api.js';
import { getTokenPrices, getTokenPriceBySymbol, calculateTotalValue, formatUSDValue, getBitcoinPrice, getSolanaPrice, getXRPPrice, getTonPrice, getPriceHistory, getTokenMetadata, isBitcoinNetworkKey, isSolanaNetworkKey, isXRPNetworkKey, isTonNetworkKey, type TokenInfo } from '../../src/price-service.js';
import { isBitcoinNetworkConfig, isEVMNetworkConfig, isSolanaNetworkConfig, isXRPNetworkConfig, isTonNetworkConfig } from '../../src/types/config.js';
import { applyExplorerApiKeys } from '../../src/config-utils.js';
import { getVisibleNetworkEntries, isNetworkUsable, pricesAvailableForNetwork } from '../../src/network-visibility.js';
import { buildUnifiedPortfolio } from '../../src/unified-portfolio.js';
import {
  fetchAlchemyPortfolio,
  isPortfolioSupported,
  type PortfolioAddressGroup,
} from '../../src/portfolio-api.js';
import type {
  BuildUnifiedPortfolioOptions,
  NetworkPortfolioInput,
  UnifiedPortfolioSnapshot,
} from '../../src/types/unified-portfolio.js';
import type { Token } from '../../src/types/token.js';
import { installConsoleRedactor } from '../../src/utils/redact-logs.js';

// Install console redactor as early as possible so any downstream init that
// logs will already be sanitized. Registers the Alchemy key (and Helius, for
// legacy configs) as secrets. Does nothing if the var is unset.
installConsoleRedactor(import.meta.env.VITE_ALCHEMY_API_KEY);
installConsoleRedactor(import.meta.env.VITE_HELIUS_API_KEY);
import type { Config } from '../../src/types/index.js';
import { getBitcoinExplorer, getBitcoinProvider, satoshisToBtc } from '../../src/bitcoin/index.js';
import { ethers } from 'ethers';

type PrivateKeyChain = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
type PrivateKeyFormat = 'hex' | 'wif' | 'base58' | 'seed' | 'secretKey';

function isPrivateKeyChain(value: any): value is PrivateKeyChain {
  return value === 'evm' || value === 'bitcoin' || value === 'solana' || value === 'xrp' || value === 'ton';
}

// ============================================================================
// Crypto Environment Setup
// ============================================================================

/** Configure WebCrypto adapter for browser environment (uses asmcrypto.js) */
setCryptoAdapter(createWebCryptoAdapter());

// ============================================================================
// Price Provider Setup
// ============================================================================

import { setAlchemyApiKey, setCoingeckoApiKey } from '../../src/price-providers/index.js';
import {
  looksLikeAlchemyKey,
  maskAlchemyKey,
  validateAlchemyKey,
} from '../../src/alchemy-key.js';

/** Configure Alchemy Prices API key (primary provider for current prices) */
const alchemyApiKey = import.meta.env.VITE_ALCHEMY_API_KEY;
if (alchemyApiKey) {
  setAlchemyApiKey(alchemyApiKey);
}

// ============================================================================
// Runtime Alchemy Key (user-entered, stored in chrome.storage.local)
// ============================================================================

/** chrome.storage.local key holding a user-entered Alchemy API key. */
const ALCHEMY_KEY_STORAGE_KEY = 'alchemyApiKey';

/**
 * User-entered Alchemy key loaded from chrome.storage.local. Takes
 * precedence over the build-time VITE_ALCHEMY_API_KEY. Held only in the
 * service worker; UI surfaces receive masked/boolean status, never the raw
 * key.
 */
let runtimeAlchemyKey: string | undefined;

/**
 * Pre-substitution merged config (bundled + stored overrides) captured by
 * initializeWalletService. Retains `${ALCHEMY_API_KEY}` placeholders so a
 * runtime key change can re-substitute without a full re-init (which would
 * drop the unlocked wallet state).
 */
let pristineMergedConfig: (Config & { network: string }) | null = null;

/** Effective key: user-entered wins over build-time env. */
function getEffectiveAlchemyKey(): string | undefined {
  if (runtimeAlchemyKey) return runtimeAlchemyKey;
  const buildTime = import.meta.env.VITE_ALCHEMY_API_KEY;
  return typeof buildTime === 'string' && buildTime.length > 0 ? buildTime : undefined;
}

/** Loads the stored key (if any) into module state. Never throws. */
async function loadStoredAlchemyKey(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(ALCHEMY_KEY_STORAGE_KEY);
    const value = stored?.[ALCHEMY_KEY_STORAGE_KEY];
    runtimeAlchemyKey =
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  } catch {
    runtimeAlchemyKey = undefined;
  }
}

/**
 * Applies the current effective key to every consumer on the running
 * worker: console redaction, the Prices provider, RPC URL re-substitution
 * from the pristine config, explorer re-registration, and provider-cache
 * resets. Preserves unlocked wallet state (no service re-construction).
 */
async function applyAlchemyKeyToServices(): Promise<void> {
  const effective = getEffectiveAlchemyKey();
  installConsoleRedactor(effective);
  setAlchemyApiKey(effective);

  if (!walletService || !pristineMergedConfig) {
    // Worker not initialized yet — initializeWalletService picks the key up.
    return;
  }

  const fresh = applyExplorerApiKeys(pristineMergedConfig, {
    ...(import.meta.env as Record<string, string | undefined>),
    ALCHEMY_API_KEY: effective,
  });
  // Splice into the live config object shared by wallet + service.
  walletService.config.networks = fresh.config.networks;
  explorerAPI.registerNetworks(walletService.config.networks, fresh.globalApiKey);
  explorerAPI.clearCache();
  walletService.wallet.resetProviderCache();
  try {
    // Rebuild the cached per-chain provider for the active network.
    await walletService.setNetwork(walletService.config.network, { persist: false });
  } catch {
    // Providers rebuild lazily on next use with the updated config.
  }
}

/** Configure CoinGecko API key (fallback for current prices + primary for history/metadata) */
const coingeckoApiKey = import.meta.env.VITE_COINGECKO_API_KEY;
if (coingeckoApiKey) {
  setCoingeckoApiKey(coingeckoApiKey);
}

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

// ============================================================================
// Session Password Protection
// ============================================================================

/**
 * Session password storage with basic obfuscation.
 *
 * Security notes:
 * - The password is XOR'd with a random key to prevent trivial memory scanning
 * - This is NOT encryption - it's obfuscation to raise the bar for memory dump attacks
 * - True protection would require hardware security modules or OS-level secure storage
 * - The password is still in memory and can be extracted by determined attackers
 */
interface ObfuscatedPassword {
  /** XOR'd password bytes */
  data: Uint8Array;
  /** Random key used for XOR */
  key: Uint8Array;
}

let obfuscatedPassword: ObfuscatedPassword | null = null;

/**
 * Store session password with obfuscation.
 * @param password - Plain text password to store
 */
function setSessionPassword(password: string | null): void {
  if (password === null) {
    // Clear the obfuscated password
    if (obfuscatedPassword) {
      // Overwrite memory before clearing
      obfuscatedPassword.data.fill(0);
      obfuscatedPassword.key.fill(0);
      obfuscatedPassword = null;
    }
    return;
  }

  // Convert password to bytes
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Generate random key of same length
  const key = new Uint8Array(passwordBytes.length);
  crypto.getRandomValues(key);

  // XOR password with key
  const data = new Uint8Array(passwordBytes.length);
  for (let i = 0; i < passwordBytes.length; i++) {
    data[i] = passwordBytes[i] ^ key[i];
  }

  // Clear original password bytes
  passwordBytes.fill(0);

  obfuscatedPassword = { data, key };
}

/**
 * Retrieve session password (de-obfuscate).
 * @returns Plain text password or null if not set
 */
function getSessionPassword(): string | null {
  if (!obfuscatedPassword) return null;

  // XOR data with key to recover password
  const passwordBytes = new Uint8Array(obfuscatedPassword.data.length);
  for (let i = 0; i < obfuscatedPassword.data.length; i++) {
    passwordBytes[i] = obfuscatedPassword.data[i] ^ obfuscatedPassword.key[i];
  }

  // Convert to string
  const decoder = new TextDecoder();
  const password = decoder.decode(passwordBytes);

  // Clear temporary bytes
  passwordBytes.fill(0);

  return password;
}

/**
 * Check if session password is set.
 */
function hasSessionPassword(): boolean {
  return obfuscatedPassword !== null;
}

// ============================================================================
// dApp Approval Management (with expiration support)
// ============================================================================

/** Approval expiration time: 24 hours (in milliseconds) */
const DAPP_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Structure for persisted dApp approvals with timestamps.
 * Approvals expire after DAPP_APPROVAL_EXPIRY_MS for security.
 */
interface DappApproval {
  origin: string;
  approvedAt: number;
  /** If true, approval only lasts for current session (cleared on lock/browser close) */
  sessionOnly: boolean;
}

/** Map of approved dApp origins to their approval info */
let approvedDappOrigins = new Map<string, DappApproval>();

/** Session-only approvals (cleared on wallet lock) */
let sessionOnlyApprovals = new Set<string>();

/**
 * Check if a dApp origin is currently approved (not expired).
 * @param origin - The dApp origin to check
 * @returns true if approved and not expired
 */
function isDappApproved(origin: string): boolean {
  const approval = approvedDappOrigins.get(origin);
  if (!approval) return false;

  // Check if session-only approval was cleared
  if (approval.sessionOnly && !sessionOnlyApprovals.has(origin)) {
    approvedDappOrigins.delete(origin);
    return false;
  }

  // Check if approval has expired
  const now = Date.now();
  if (now - approval.approvedAt > DAPP_APPROVAL_EXPIRY_MS) {
    approvedDappOrigins.delete(origin);
    saveApprovedOrigins();
    console.log(`[DappApproval] Expired approval for ${origin}`);
    return false;
  }

  return true;
}

/**
 * Add a dApp approval with timestamp.
 * @param origin - The dApp origin to approve
 * @param sessionOnly - If true, approval only lasts for current session
 */
function approveDapp(origin: string, sessionOnly: boolean = false): void {
  const approval: DappApproval = {
    origin,
    approvedAt: Date.now(),
    sessionOnly
  };
  approvedDappOrigins.set(origin, approval);

  if (sessionOnly) {
    sessionOnlyApprovals.add(origin);
  }

  // Only persist non-session-only approvals
  if (!sessionOnly) {
    saveApprovedOrigins();
  }

  console.log(`[DappApproval] Approved ${origin} (sessionOnly: ${sessionOnly})`);
}

/**
 * Revoke a dApp approval.
 * @param origin - The dApp origin to revoke
 */
function revokeDappApproval(origin: string): void {
  approvedDappOrigins.delete(origin);
  sessionOnlyApprovals.delete(origin);
  saveApprovedOrigins();
  console.log(`[DappApproval] Revoked approval for ${origin}`);
}

/**
 * Clear all session-only approvals (called on wallet lock).
 */
function clearSessionOnlyApprovals(): void {
  for (const origin of sessionOnlyApprovals) {
    approvedDappOrigins.delete(origin);
  }
  sessionOnlyApprovals.clear();
  console.log('[DappApproval] Cleared session-only approvals');
}

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
/**
 * Per-wallet cache of per-network token balances.
 *
 * Keyed by `walletName` → `network` → `tokenKey` so that switching wallets
 * never serves the prior wallet's balances. Each wallet's subtree is
 * independent and survives wallet switches, which makes re-selecting a
 * previously opened wallet render instantly from cache while the background
 * fan-out refresh confirms freshness.
 */
interface NetworkBalances {
  [tokenKey: string]: CachedBalance;
}
interface BalanceCache {
  [walletName: string]: {
    [network: string]: NetworkBalances;
  };
}

/** In-memory balance cache (keyed by wallet, then network). */
let balanceCache: BalanceCache = {};

/** Sentinel storage key used for the persisted cache blob. */
const BALANCE_CACHE_STORAGE_KEY = 'balanceCache';

/**
 * Read-only view of the active wallet's network cache. Returns an empty
 * object (not a cache reference) when no wallet is active, so callers can
 * iterate without null checks but cannot accidentally mutate storage before
 * a wallet is unlocked.
 */
function getActiveWalletCache(): { [network: string]: NetworkBalances } {
  if (!currentWalletName) return {};
  return balanceCache[currentWalletName] || {};
}

/**
 * Writable reference to the active wallet's network cache. Lazily allocates
 * the subtree so `setCachedBalance` never has to do it. Throws if called
 * before a wallet is active — that would indicate a bug: no code should be
 * writing balances for a nameless wallet.
 */
function ensureActiveWalletCache(): { [network: string]: NetworkBalances } {
  if (!currentWalletName) {
    throw new Error('Cannot write balance cache before a wallet is active');
  }
  let bucket = balanceCache[currentWalletName];
  if (!bucket) {
    bucket = {};
    balanceCache[currentWalletName] = bucket;
  }
  return bucket;
}

/** Balance polling interval timer */
let balancePollingTimer: NodeJS.Timeout | null = null;

/** Balance polling interval: 30 seconds */
const BALANCE_POLLING_INTERVAL = 30 * 1000;

/** Balance cache TTL: 5 minutes (used to determine if cache is stale) */
const BALANCE_CACHE_TTL = 5 * 60 * 1000;

/** Price history cache TTL: 5 minutes */
const PRICE_HISTORY_TTL = 5 * 60 * 1000;

/** In-memory price history cache: symbol-range -> result */
const priceHistoryCache = new Map<string, { result: any; fetchedAt: number }>();

/**
 * Get token cache key
 */
function getTokenCacheKey(token: { type?: string; address?: string }): string {
  return token.type === 'native' ? 'native' : (token.address || '').toLowerCase();
}

/**
 * Get cached balance for a token on the active wallet.
 */
function getCachedBalance(network: string, token: { type?: string; address?: string }): CachedBalance | null {
  const key = getTokenCacheKey(token);
  return getActiveWalletCache()[network]?.[key] || null;
}

/**
 * Update cached balance for a token. When `walletName` is supplied, the
 * write lands in that wallet's bucket regardless of which wallet is
 * currently active — essential for in-flight refreshes that started before
 * the user switched wallets, so A's balances never leak into B's cache.
 * Omitting `walletName` falls back to the active wallet.
 */
function setCachedBalance(
  network: string,
  token: { type?: string; address?: string },
  balance: string,
  walletName?: string
): void {
  const walletKey = walletName ?? currentWalletName;
  if (!walletKey) {
    throw new Error('Cannot write balance cache before a wallet is active');
  }
  let bucket = balanceCache[walletKey];
  if (!bucket) {
    bucket = {};
    balanceCache[walletKey] = bucket;
  }
  if (!bucket[network]) {
    bucket[network] = {};
  }
  const key = getTokenCacheKey(token);
  bucket[network][key] = {
    balance,
    lastUpdated: Date.now()
  };
}

/**
 * Clear cache entries. Scope is narrowed by the options:
 *  - `{}` / no args: wipes every wallet's cache (used on full reset).
 *  - `{ wallet }`: drops a single wallet's entire cache (e.g. wallet deleted).
 *  - `{ network }` (no wallet): drops that network for the active wallet only.
 *  - `{ wallet, network }`: drops a specific wallet+network pair.
 */
function clearBalanceCache(opts: { wallet?: string; network?: string } = {}): void {
  const { wallet, network } = opts;
  if (!wallet && !network) {
    balanceCache = {};
    return;
  }
  const walletKey = wallet ?? currentWalletName;
  if (!walletKey) return;
  if (!network) {
    delete balanceCache[walletKey];
    return;
  }
  const bucket = balanceCache[walletKey];
  if (!bucket) return;
  delete bucket[network];
  if (Object.keys(bucket).length === 0) {
    delete balanceCache[walletKey];
  }
}

/**
 * Detect the legacy `{[network]: {[token]: CachedBalance}}` shape so we can
 * migrate it into the per-wallet form on first load after upgrade.
 *
 * Returns true when every top-level value looks like a network bucket whose
 * leaves carry `balance` + `lastUpdated`. Safe against the new shape because
 * per-wallet buckets contain network sub-objects whose leaves match the same
 * shape, but the *second* level in the new shape is always networks, never
 * tokens — we probe a leaf at depth 2 vs depth 3 to disambiguate.
 */
function isLegacyBalanceCache(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const topValues = Object.values(raw);
  if (topValues.length === 0) return false;
  for (const level2 of topValues) {
    if (!level2 || typeof level2 !== 'object') return false;
    const level2Values = Object.values(level2);
    if (level2Values.length === 0) continue;
    for (const leaf of level2Values) {
      if (!leaf || typeof leaf !== 'object') return false;
      // Legacy leaf: { balance, lastUpdated }. New shape's level-2 leaf is a
      // tokenKey → CachedBalance map, i.e. an object with nested objects.
      const l: any = leaf;
      if (typeof l.balance === 'string' && typeof l.lastUpdated === 'number') {
        return true;
      }
      return false;
    }
  }
  return false;
}

/**
 * Load balance cache from persistent storage. Migrates the legacy network-
 * keyed blob to the per-wallet shape by attributing the legacy data to the
 * currently active wallet. If no wallet is active yet (cold start before
 * unlock), legacy data is discarded — we can't safely attribute it.
 */
async function loadBalanceCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(BALANCE_CACHE_STORAGE_KEY);
    const raw = result[BALANCE_CACHE_STORAGE_KEY];
    if (!raw) return;
    if (isLegacyBalanceCache(raw)) {
      if (currentWalletName) {
        balanceCache = { [currentWalletName]: raw };
        console.log('[BalanceCache] Migrated legacy cache into per-wallet shape for', currentWalletName);
        await saveBalanceCache();
      } else {
        balanceCache = {};
        await chrome.storage.local.remove(BALANCE_CACHE_STORAGE_KEY);
        console.log('[BalanceCache] Discarded legacy cache (no active wallet to attribute)');
      }
      return;
    }
    balanceCache = raw as BalanceCache;
    console.log('[BalanceCache] Loaded from storage');
  } catch (err) {
    console.warn('[BalanceCache] Failed to load from storage:', err);
  }
}

/**
 * Save balance cache to persistent storage
 */
async function saveBalanceCache(): Promise<void> {
  try {
    await chrome.storage.local.set({ [BALANCE_CACHE_STORAGE_KEY]: balanceCache });
  } catch (err) {
    console.warn('[BalanceCache] Failed to save to storage:', err);
  }
}

// ============================================================================
// Per-Wallet Preferences (active network per wallet)
// ============================================================================

/**
 * Per-wallet UI preferences persisted across sessions.
 *
 * `lastNetwork` records which chain the user was viewing when they last had
 * this wallet active. Restoring it on wallet switch (or on import/unlock)
 * means each wallet "remembers" its own chain — no more bleed-through from
 * the previously active wallet and no more flash-of-bundled-default (the
 * repo's config.json ships with `solana-mainnet` as the cross-wallet default,
 * which surprised every mnemonic import that landed on a non-Solana chain).
 */
interface WalletPreferences {
  lastNetwork?: string;
}

/** In-memory prefs keyed by wallet name. */
let walletPreferences: { [walletName: string]: WalletPreferences } = {};

/** Persisted storage key for the wallet preferences blob. */
const WALLET_PREFS_STORAGE_KEY = 'walletPreferences';

/**
 * Load persisted wallet preferences into memory. Idempotent — safe to call on
 * every SW wake-up. Failures leave the in-memory map empty so fallbacks still
 * apply.
 */
async function loadWalletPreferences(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(WALLET_PREFS_STORAGE_KEY);
    const raw = result[WALLET_PREFS_STORAGE_KEY];
    if (raw && typeof raw === 'object') {
      walletPreferences = raw as typeof walletPreferences;
    }
  } catch (err) {
    console.warn('[WalletPrefs] Failed to load from storage:', err);
  }
}

/**
 * Persist the in-memory wallet preferences blob. Best-effort — never throws.
 */
async function saveWalletPreferences(): Promise<void> {
  try {
    await chrome.storage.local.set({ [WALLET_PREFS_STORAGE_KEY]: walletPreferences });
  } catch (err) {
    console.warn('[WalletPrefs] Failed to save to storage:', err);
  }
}

/**
 * Return the network this wallet was last viewing, or null if none stored.
 * Callers use this to restore the wallet's chain on switch/unlock/import so
 * the bundled default never leaks across wallets.
 */
function getWalletPreferredNetwork(walletName: string): string | null {
  return walletPreferences[walletName]?.lastNetwork ?? null;
}

/**
 * Persist the given network as this wallet's last-viewed chain. Writes through
 * to chrome.storage so the preference survives SW eviction.
 */
async function setWalletPreferredNetwork(walletName: string, network: string): Promise<void> {
  if (!walletName || !network) return;
  const existing = walletPreferences[walletName] ?? {};
  if (existing.lastNetwork === network) return;
  walletPreferences[walletName] = { ...existing, lastNetwork: network };
  await saveWalletPreferences();
}

/**
 * Drop any stored preferences for a wallet. Called from DELETE_WALLET so the
 * prefs blob doesn't accumulate entries for wallets that no longer exist.
 */
async function removeWalletPreferences(walletName: string): Promise<void> {
  if (!walletName) return;
  if (!(walletName in walletPreferences)) return;
  delete walletPreferences[walletName];
  await saveWalletPreferences();
}

/**
 * Pick a sensible default network for a newly imported wallet. Mnemonic
 * wallets default to EVM mainnet (most users expect EVM); private-key
 * imports default to the chain family of their key. Falls back to the
 * caller-supplied fallback (the current `config.network`) if nothing else
 * fits, which preserves pre-existing behavior for edge cases.
 */
function defaultNetworkForImport(
  importType: 'mnemonic' | 'privateKey',
  chainType: PrivateKeyChain | undefined,
  fallback: string
): string {
  if (importType === 'privateKey' && chainType) {
    const chainToNetwork: Record<PrivateKeyChain, string> = {
      evm: 'mainnet',
      bitcoin: 'bitcoin-mainnet',
      solana: 'solana-mainnet',
      xrp: 'xrp-mainnet',
      ton: 'ton-mainnet',
    };
    return chainToNetwork[chainType] ?? fallback;
  }
  // Mnemonic imports can span every chain — pick a universally useful default
  // (EVM mainnet) rather than inheriting whatever happened to be active.
  return 'mainnet';
}

// ============================================================================
// Broadcasts
// ============================================================================

/**
 * Broadcast the full active-wallet context to the popup/sidepanel in a single
 * envelope. Consumers apply every field in one `setState` so the UI never
 * re-renders with a mix of old and new fields (which caused visible flashes
 * — e.g. the address/walletName updating before the network caught up).
 *
 * Fired by every handler that mutates the active-wallet identity or its
 * network: IMPORT_WALLET, UNLOCK_WALLET, SWITCH_WALLET, SWITCH_ACCOUNT,
 * SWITCH_NETWORK. Guarded on `isUnlocked` — locked transitions use their own
 * `WALLET_LOCKED` message.
 */
function broadcastWalletContext(): void {
  if (!isUnlocked || !walletService) return;
  let address: string | null = null;
  try {
    address = walletService.getAddress();
  } catch {
    // Non-EVM private-key wallets may not expose a direct address via
    // getAddress on the wrong network; the popup tolerates null.
  }
  chrome.runtime.sendMessage({
    type: 'WALLET_CONTEXT_CHANGED',
    context: {
      isUnlocked: true,
      hasWallet: true,
      network: walletService.config.network,
      address,
      currentWalletName,
      importType: walletService.wallet.importType ?? null,
      privateKeyType: walletService.wallet.privateKeyType ?? null,
    },
  }).catch(() => { });
}

/**
 * Broadcast balance update to all UI contexts.
 *
 * `extra` is a merged into the envelope — used to attach an aggregate unified
 * snapshot block after a per-network refresh so the popup's unified-view hook
 * can update its hero total without re-querying.
 */
function broadcastBalanceUpdate(
  network: string,
  balances: { token: any; balance: string }[],
  extra?: Record<string, unknown>
): void {
  chrome.runtime.sendMessage({
    type: 'BALANCES_UPDATED',
    network,
    balances,
    ...(extra || {}),
  }).catch(() => { });
}

/**
 * Broadcast a full unified-portfolio snapshot to UI contexts.
 * Fires once at the end of a fan-out refresh across all enabled chains.
 */
function broadcastUnifiedPortfolio(snapshot: UnifiedPortfolioSnapshot): void {
  chrome.runtime.sendMessage({
    type: 'UNIFIED_PORTFOLIO_UPDATED',
    snapshot,
  }).catch(() => { });
}

/**
 * Legacy popup-driven polling timer. Superseded by the alarm + popup-port
 * hybrid, but retained as the engine for the popup-port fast path below.
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

type RefreshResult = Awaited<ReturnType<WalletAppService['getPortfolioForNetwork']>>;

/**
 * Refresh balances for a single network and update the cache.
 *
 * Skips networks the current wallet cannot use (e.g. an EVM private-key
 * import viewing a Bitcoin network), returning an empty array instead of
 * throwing. `suppressBroadcast` is used by the fan-out refresh to avoid
 * per-network re-render storms; callers that want per-network UI updates
 * (the legacy single-network refresh path) pass false.
 */
async function refreshBalancesForNetwork(
  networkKey: string,
  opts: { suppressBroadcast?: boolean; targetWallet?: string } = {}
): Promise<RefreshResult> {
  if (!isUnlocked || !walletService) return [];

  const networkConfig = walletService.config.networks[networkKey];
  if (!networkConfig) return [];

  const wallet = walletService.wallet;
  const usable = isNetworkUsable(networkKey, networkConfig, {
    importType: wallet.importType ?? null,
    privateKeyType: wallet.privateKeyType ?? null,
  });
  if (!usable) return [];

  let portfolio: RefreshResult;
  try {
    portfolio = await walletService.getPortfolioForNetwork(networkKey);
  } catch (err) {
    console.warn(`[BalanceRefresh] ${networkKey} failed:`, err);
    return [];
  }

  for (const item of portfolio) {
    if (!item.error) {
      setCachedBalance(networkKey, item.token, item.balance, opts.targetWallet);
    }
  }

  await saveBalanceCache();
  // Only broadcast per-network updates when they are still relevant to the
  // active wallet — routing them to an already-switched-away wallet would
  // confuse single-network UI that keys off the active wallet.
  if (!opts.suppressBroadcast && (!opts.targetWallet || opts.targetWallet === currentWalletName)) {
    broadcastBalanceUpdate(networkKey, portfolio);
  }
  return portfolio;
}

/**
 * Thin wrapper preserving the legacy `REFRESH_BALANCES` contract — refreshes
 * whichever single network is active in `walletService.config.network`.
 */
async function refreshBalancesForCurrentNetwork(): Promise<void> {
  if (!isUnlocked || !walletService) return;
  await refreshBalancesForNetwork(walletService.config.network);
}

/**
 * Return the list of networks the current wallet can both see and use.
 *
 * - Visibility: respects `showTestnets` (overridable per-call).
 * - Anti-lockout: by default always includes `config.network` even if it's a
 *   hidden testnet. This matters for the network-selector dropdown (the user
 *   must be able to see "where they are" and switch away) but is WRONG for
 *   the unified cross-chain view — when the user says "hide testnets", the
 *   solana-devnet balance row shouldn't linger just because solana-devnet
 *   happens to be the last chain they viewed. The unified snapshot caller
 *   therefore passes `includeCurrentNetwork: false`.
 * - Usability: chain type matches any private-key import restriction.
 *
 * @param overrides - Optional per-call overrides. When the caller knows the
 *   exact filter the *user* is looking at right now (e.g. the popup passing
 *   `showTestnets` through snapshot options), they should override the
 *   persisted default so the render matches the live toggle. Background
 *   callers that operate on long-running state (scheduled refreshes, lock
 *   timers, etc.) should omit `overrides` and rely on the persisted config.
 */
function getEnabledNetworksForWallet(
  overrides: { showTestnets?: boolean; includeCurrentNetwork?: boolean } = {}
): Array<[string, any]> {
  if (!walletService) return [];
  const wallet = walletService.wallet;
  const showTestnets =
    overrides.showTestnets ?? walletService.config.showTestnets ?? false;
  const includeCurrentNetwork = overrides.includeCurrentNetwork ?? true;
  const visible = getVisibleNetworkEntries(walletService.config.networks, {
    showTestnets,
    // Intentionally omit `currentNetwork` when the caller opts out of the
    // anti-lockout rule — otherwise an active testnet chain would slip past
    // the showTestnets filter.
    currentNetwork: includeCurrentNetwork ? walletService.config.network : undefined,
  });
  return visible.filter(([key, config]) =>
    isNetworkUsable(key, config, {
      importType: wallet.importType ?? null,
      privateKeyType: wallet.privateKeyType ?? null,
    })
  );
}

/**
 * Per-wallet in-flight fan-out refreshes. Keyed by walletName so concurrent
 * refreshes for *different* wallets can run — a refresh for wallet A must
 * never block a freshly-imported wallet B from populating its own cache.
 * Same-wallet reentrancy is deduped by returning the existing promise.
 */
const activeRefreshesByWallet = new Map<string, Promise<void>>();

/**
 * Prices sourced from the Alchemy Portfolio API on the most recent refresh.
 * Keyed by `${networkKey}:${tokenKey}`. Read by the snapshot builder before
 * falling back to the live price provider — makes the unified view zero-hop
 * for prices on the 9 chains the Portfolio API covers. Refreshed wholesale
 * on each fan-out; never mutated piecewise.
 */
const portfolioPriceCache = new Map<string, number | null>();

/**
 * Refresh EVM + Solana balances and prices in a single batched call.
 *
 * Uses Alchemy's Portfolio API (`POST /assets/tokens/by-address`) which
 * returns native + ERC-20 + SPL balances, prices, and metadata for up to
 * 2 addresses × 5 networks each. For our 8 EVM + Solana mainnet, that's
 * ~2 round-trips (1 – 2 s) instead of the 24 s serial fan-out.
 *
 * Returns the set of network keys this path successfully covered, so the
 * main refresh orchestrator knows which chains still need the per-chain
 * fallback path. On total failure (Portfolio API down / rate-limited /
 * no API key configured) returns an empty set, and the caller falls back
 * to the legacy per-chain loop for every enabled network.
 *
 * Networks the wallet can't use (private-key wallets restricted to one
 * chain type) are filtered out by `isNetworkUsable` at the group-building
 * stage, so calling this for a BTC-only wallet is a no-op.
 */
async function refreshViaPortfolioApi(
  apiKey: string,
  targetNetworks: Array<[string, any]>,
  targetWallet: string,
): Promise<Set<string>> {
  const covered = new Set<string>();
  if (!walletService || targetNetworks.length === 0) return covered;

  const wallet = walletService.wallet;
  const usabilityCtx = {
    importType: wallet.importType ?? null,
    privateKeyType: wallet.privateKeyType ?? null,
  };

  // Collect one address-group per chain family this wallet can use.
  const groups: PortfolioAddressGroup[] = [];

  const evmNetworks: string[] = [];
  for (const [key, config] of targetNetworks) {
    if (!isPortfolioSupported(key)) continue;
    if (key.startsWith('solana-')) continue;
    if (!isNetworkUsable(key, config, usabilityCtx)) continue;
    evmNetworks.push(key);
  }
  if (evmNetworks.length > 0) {
    try {
      // Go through the raw wallet (not `walletService.getAddress()`) because
      // the latter is network-aware — if the wallet's current network is
      // Solana/Bitcoin/XRP/TON, `walletService.getAddress()` returns THAT
      // chain's address (base58 / bech32 / r... / EQ...), not the EVM 0x
      // address we need for the Alchemy Portfolio API call. For a fresh
      // mnemonic import where `config.network` happens to be the bundled
      // default (`solana-mainnet`), this bug caused every EVM chain to be
      // queried with a Solana address — Alchemy returned nothing, and only
      // the Solana group succeeded.
      const evmAddress = wallet.getAddress();
      if (evmAddress) {
        groups.push({ address: evmAddress, networkKeys: evmNetworks });
      }
    } catch {
      // `wallet.getAddress()` throws for non-EVM private-key imports — that's
      // correct: we can't sign on EVM chains without an EVM key, so skipping
      // the Portfolio EVM call is the right behavior.
    }
  }

  const solanaNetworks = targetNetworks
    .map(([key]) => key)
    .filter(key => key.startsWith('solana-') && isPortfolioSupported(key) && isNetworkUsable(key, walletService!.config.networks[key], usabilityCtx));
  if (solanaNetworks.length > 0) {
    try {
      const solInfo = wallet.getSolanaAddress(wallet.getCurrentAccountIndex());
      if (solInfo?.address) {
        groups.push({ address: solInfo.address, networkKeys: solanaNetworks });
      }
    } catch {
      // Wallet has no Solana address.
    }
  }

  if (groups.length === 0) return covered;

  const entries = await fetchAlchemyPortfolio(apiKey, groups);
  if (entries.length === 0) {
    // Non-empty groups but zero entries: either the wallet holds nothing on
    // these chains or the API failed. Don't mark these networks as covered
    // so the orchestrator falls back to per-chain fetches; that path will
    // correctly produce zero balances for tokens in our allowlist.
    return covered;
  }

  // Index entries by (networkKey, tokenKey) for fast lookup.
  const now = Date.now();
  const byNetwork = new Map<string, Map<string, (typeof entries)[number]>>();
  for (const entry of entries) {
    let bucket = byNetwork.get(entry.networkKey);
    if (!bucket) { bucket = new Map(); byNetwork.set(entry.networkKey, bucket); }
    bucket.set(entry.tokenKey, entry);
  }

  // For every queried network, fill balanceCache + portfolioPriceCache from
  // what the API returned. Tokens in our allowlist that the API didn't
  // return are set to "0" — Alchemy omits zero balances, and rendering them
  // as 0 keeps the hide-zero toggle correct.
  //
  // CRITICAL: if Alchemy returned zero entries for a specific network, we
  // do NOT mark it `covered`. This lets the orchestrator's stage-2 fallback
  // re-query that network via the legacy per-chain path — the same path
  // the per-network view uses successfully. Previously we'd stamp zeros
  // for every allowlist token and mark the network covered, which hid
  // real balances (notably on Solana, where the Portfolio API sometimes
  // returns empty sets for wallets that the native RPC happily reports
  // tokens for). Skipping `covered.add` here means a second, authoritative
  // fetch runs and writes real balances into the same cache.
  const queriedNetworks = new Set<string>([...evmNetworks, ...solanaNetworks]);
  for (const networkKey of queriedNetworks) {
    const bucket = byNetwork.get(networkKey) ?? new Map();
    if (bucket.size === 0) {
      // Portfolio API returned nothing for this network — don't cache zeros
      // and don't mark it covered; defer to the per-chain fallback.
      continue;
    }
    const allowlist = walletService.getTokensForNetwork(networkKey);
    const networkConfig = walletService.config.networks[networkKey];
    const allowPrices = pricesAvailableForNetwork(networkConfig);
    for (const token of allowlist) {
      const tokenKey = getTokenCacheKey(token);
      const entry = bucket.get(tokenKey);
      setCachedBalance(networkKey, token, entry?.balance ?? '0', targetWallet);
      // For testnets, cache a null price even if Alchemy returned a value —
      // the Portfolio API sometimes quotes testnet assets at their mainnet
      // counterpart's ticker, which is meaningless for the user's balance.
      portfolioPriceCache.set(
        `${networkKey}:${tokenKey}`,
        allowPrices ? (entry?.priceUsd ?? null) : null
      );
    }
    covered.add(networkKey);
    // Silence the unused-warn on `now` — kept for future staleness tracking.
    void now;
  }

  await saveBalanceCache();
  return covered;
}

/**
 * Fan-out refresh across every enabled network.
 *
 * Fast path: one batched call via the Alchemy Portfolio API covers the 8 EVM
 * chains plus Solana mainnet. Slow path: legacy per-chain fetches handle BTC,
 * XRP, TON, and any Portfolio-unsupported testnet — or everything, if the
 * Portfolio call failed.
 *
 * A single `UNIFIED_PORTFOLIO_UPDATED` fires at the end with the fresh
 * snapshot. Per-network `BALANCES_UPDATED` broadcasts are suppressed during
 * the fan-out so the popup doesn't re-render 12 times; legacy UI code still
 * receives them from the single-network refresh path.
 */
async function refreshAllEnabledNetworks(): Promise<void> {
  if (!isUnlocked || !walletService || !currentWalletName) return;

  // Capture the wallet identity at entry. Every write and the terminal
  // broadcast are tagged with this identity so a switch mid-flight can't
  // cause A's balances to land in B's cache or to be broadcast as B's data.
  const targetWallet = currentWalletName;

  // Dedupe: if the same wallet already has a refresh running, share it.
  const existing = activeRefreshesByWallet.get(targetWallet);
  if (existing) return existing;

  const promise = runRefreshForWallet(targetWallet);
  activeRefreshesByWallet.set(targetWallet, promise);
  try {
    await promise;
  } finally {
    if (activeRefreshesByWallet.get(targetWallet) === promise) {
      activeRefreshesByWallet.delete(targetWallet);
    }
  }
}

/**
 * Execute a fan-out refresh for a specific wallet. Each balance write is
 * routed to `targetWallet`'s cache bucket regardless of the currently active
 * wallet, so a slow refresh that finishes after a wallet switch still
 * populates the correct bucket (and won't pollute another wallet's).
 *
 * The final `UNIFIED_PORTFOLIO_UPDATED` broadcast is only emitted when
 * `targetWallet` is still active — otherwise the popup would rehydrate with
 * a snapshot for a wallet the user has already left. A refresh started from
 * the new wallet path handles that side separately.
 */
async function runRefreshForWallet(targetWallet: string): Promise<void> {
  try {
    const networks = getEnabledNetworksForWallet();

    // Step 1: Portfolio API batch — covers EVM + Solana in ~2 round-trips.
    const apiKey = resolveAlchemyApiKey();
    const covered = apiKey
      ? await refreshViaPortfolioApi(apiKey, networks, targetWallet).catch(err => {
          console.warn('[UnifiedRefresh] Portfolio API failed, falling back:', err);
          return new Set<string>();
        })
      : new Set<string>();

    // Step 2: per-chain fallback for networks the batch didn't cover (always
    // BTC / XRP / TON; everything when the batch failed). Abort the loop if
    // the active wallet has flipped to something else *and* the target
    // wallet is no longer even loaded — continuing would waste work on data
    // that won't be broadcast.
    for (let i = 0; i < networks.length; i++) {
      const [networkKey] = networks[i];
      if (covered.has(networkKey)) continue;
      if (currentWalletName !== targetWallet) break;
      try {
        await refreshBalancesForNetwork(networkKey, { suppressBroadcast: true, targetWallet });
      } catch (err) {
        console.warn(`[UnifiedRefresh] ${networkKey} error:`, err);
      }
      await delay(PER_NETWORK_REFRESH_STAGGER_MS);
    }

    // Step 3: broadcast the consolidated snapshot — only if this wallet is
    // still active. If the user switched away, the new wallet's own refresh
    // will drive its own broadcast; we'd only be overwriting their view with
    // the previous wallet's totals.
    if (currentWalletName !== targetWallet) return;
    try {
      const snapshot = await buildUnifiedPortfolioSnapshot();
      broadcastUnifiedPortfolio(snapshot);
    } catch (err) {
      console.warn('[UnifiedRefresh] Snapshot build failed:', err);
    }
  } catch (err) {
    console.warn('[UnifiedRefresh] runRefreshForWallet failed:', err);
  }
}

/**
 * Resolve the Alchemy API key available to the service worker for the
 * Portfolio API: the user-entered runtime key wins over the build-time
 * VITE_ALCHEMY_API_KEY.
 */
function resolveAlchemyApiKey(): string | undefined {
  return getEffectiveAlchemyKey();
}

/** Resolve USD prices for all tokens on a single network. */
async function fetchPricesForNetwork(
  networkKey: string,
  tokens: Token[]
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (!walletService) return result;
  const networkConfig = walletService.config.networks[networkKey];
  if (!networkConfig) return result;

  // Testnet tokens have no market price. Short-circuit so the callers that
  // reach fetchPricesForNetwork directly (bypassing resolvePricesForNetwork's
  // portfolio-cache path) still get the right answer.
  if (!pricesAvailableForNetwork(networkConfig)) return result;

  try {
    if (isBitcoinNetworkConfig(networkConfig)) {
      result.set('native', await getBitcoinPrice().catch(() => null));
      return result;
    }
    if (isSolanaNetworkConfig(networkConfig)) {
      result.set('native', await getSolanaPrice().catch(() => null));
      for (const t of tokens) {
        if (t.type === 'spl' && t.address) {
          const p = await getTokenPriceBySymbol(t.symbol).catch(() => null);
          result.set(t.address.toLowerCase(), p);
        }
      }
      return result;
    }
    if (isXRPNetworkConfig(networkConfig)) {
      result.set('native', await getXRPPrice(networkKey).catch(() => null));
      return result;
    }
    if (isTonNetworkConfig(networkConfig)) {
      result.set('native', await getTonPrice().catch(() => null));
      return result;
    }
    if (isEVMNetworkConfig(networkConfig)) {
      const chainId = networkConfig.chainId;
      const tokenInfos: TokenInfo[] = tokens.map(t => ({
        type: t.type === 'native' ? 'native' : 'erc20',
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
      }));
      const prices = await getTokenPrices(chainId, tokenInfos);
      for (const [key, price] of prices.entries()) {
        result.set(key, price);
      }
    }
  } catch (err) {
    console.warn(`[UnifiedRefresh] Price fetch for ${networkKey} failed:`, err);
  }
  return result;
}

/**
 * Build a unified cross-chain snapshot from the current cache.
 *
 * Only tokens with a cached balance are rendered — first-time opens with an
 * empty cache return an empty snapshot, and the UI shows a loading skeleton
 * until the post-unlock refresh populates the cache.
 */
async function buildUnifiedPortfolioSnapshot(
  options: BuildUnifiedPortfolioOptions = {}
): Promise<UnifiedPortfolioSnapshot> {
  if (!isUnlocked || !walletService) {
    return {
      rows: [],
      totalUsd: 0,
      totalUsdFormatted: '$0.00',
      networkStaleness: {},
      updatedAt: Date.now(),
      locked: true,
    };
  }

  // Pass the caller's showTestnets preference through so the snapshot matches
  // whatever filter the user is currently looking at. Background callers that
  // don't supply the option fall back to the persisted default, so scheduled
  // refreshes still respect the saved value.
  //
  // `includeCurrentNetwork: false` disables the anti-lockout rule here —
  // that guard is for the network-selector dropdown (so an active testnet
  // chain stays visible + switchable), but in the unified view it lets a
  // lingering active testnet bypass the user's hide-testnets preference.
  const networks = getEnabledNetworksForWallet({
    showTestnets: options.showTestnets,
    includeCurrentNetwork: false,
  });
  const inputs: NetworkPortfolioInput[] = [];
  const walletCache = getActiveWalletCache();

  for (const [networkKey, config] of networks) {
    const tokens = walletService.getTokensForNetwork(networkKey);
    const prices = await resolvePricesForNetwork(networkKey, tokens);
    const cachedForNetwork = walletCache[networkKey] || {};

    const balances: NetworkPortfolioInput['balances'] = [];
    for (const token of tokens) {
      const tokenKey = getTokenCacheKey(token);
      const cached = cachedForNetwork[tokenKey];
      if (!cached) continue;
      balances.push({
        token,
        balance: cached.balance,
        lastUpdated: cached.lastUpdated,
        priceUsd: prices.get(tokenKey) ?? null,
      });
    }

    inputs.push({
      networkKey,
      networkLabel: config.name || networkKey,
      isTestnet: Boolean(config.isTestnet),
      balances,
    });
  }

  return buildUnifiedPortfolio(inputs, options);
}

/**
 * Resolve USD prices preferring the Portfolio API cache (populated during
 * the batch refresh) before falling back to individual price-provider calls.
 *
 * For the 9 chains the Portfolio API covers, this is a zero-RPC lookup —
 * prices come bundled with the batched balance fetch and are re-used for
 * every snapshot build until the next refresh. For BTC / XRP / TON, the
 * existing per-chain provider path runs unchanged.
 *
 * Testnets short-circuit to an empty map so testnet rows render with
 * `usdValue: null` and don't contribute to `totalUsd`.
 */
async function resolvePricesForNetwork(
  networkKey: string,
  tokens: Token[]
): Promise<Map<string, number | null>> {
  const prices = new Map<string, number | null>();

  const networkConfig = walletService?.config.networks[networkKey];
  if (!pricesAvailableForNetwork(networkConfig)) {
    // Testnet / unknown network: no prices. Returning an empty map makes
    // `buildRow` fall through to `priceUsd: null`, which the aggregator sums
    // as 0 (not "unknown"), so the row renders "—" and totalUsd stays clean.
    return prices;
  }

  const missing: Token[] = [];

  for (const token of tokens) {
    const tokenKey = getTokenCacheKey(token);
    const cacheKey = `${networkKey}:${tokenKey}`;
    if (portfolioPriceCache.has(cacheKey)) {
      prices.set(tokenKey, portfolioPriceCache.get(cacheKey) ?? null);
    } else {
      missing.push(token);
    }
  }

  // Anything not populated by the Portfolio API falls back to the legacy
  // provider path — notably BTC / XRP / TON natives, plus any token the API
  // didn't return (it may omit unknown tokens, though those also tend to
  // have balance=0 and get hidden by the zero-balance filter anyway).
  if (missing.length > 0) {
    const fallbackPrices = await fetchPricesForNetwork(networkKey, missing);
    for (const [tokenKey, price] of fallbackPrices.entries()) {
      prices.set(tokenKey, price);
    }
  }

  return prices;
}

// ============================================================================
// Background Refresh Orchestration (alarms + popup-port hybrid)
// ============================================================================

/** `chrome.alarms` alarm name for the idle cross-chain refresh cadence. */
const UNIFIED_REFRESH_ALARM_NAME = 'unifiedRefresh';

/** Period for the idle refresh alarm (minutes). Chrome enforces a 1 min floor. */
const UNIFIED_REFRESH_PERIOD_MIN = 2;

/** Delay between per-chain refreshes during a fan-out run (ms). */
const PER_NETWORK_REFRESH_STAGGER_MS = 2000;

/** Connect-port name used by the popup for fast-path polling while open. */
const POPUP_PORT_NAME = 'popup';

/** Polling interval driven by the popup port. Faster than the alarm. */
const POPUP_REFRESH_INTERVAL_MS = 30 * 1000;

/** Ports currently held open by the popup / sidepanel. */
const popupPorts = new Set<chrome.runtime.Port>();

/** Small sleep helper used by the fan-out stagger. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure the idle refresh alarm exists. Idempotent — creating an alarm with
 * the same name replaces it, so this is safe to call on unlock or startup.
 */
function ensureUnifiedRefreshAlarm(): void {
  try {
    chrome.alarms.create(UNIFIED_REFRESH_ALARM_NAME, {
      periodInMinutes: UNIFIED_REFRESH_PERIOD_MIN,
    });
  } catch (err) {
    console.warn('[UnifiedRefresh] alarm create failed:', err);
  }
}

function clearUnifiedRefreshAlarm(): void {
  try {
    chrome.alarms.clear(UNIFIED_REFRESH_ALARM_NAME);
  } catch { /* no-op */ }
}

/**
 * Start the popup-driven 30 s polling interval. Guards against double-starts
 * so multiple open UI surfaces share one timer.
 */
function startPopupDrivenPolling(): void {
  if (balancePollingTimer) return;
  balancePollingTimer = setInterval(() => {
    if (!isUnlocked || !walletService) return;
    refreshAllEnabledNetworks().catch(err =>
      console.warn('[PopupPolling] Error:', err)
    );
  }, POPUP_REFRESH_INTERVAL_MS);
  console.log('[PopupPolling] Started');
}

// Alarm handler — fires every UNIFIED_REFRESH_PERIOD_MIN minutes when the
// wallet is unlocked. Early-returns when locked (and never touches the
// auto-lock timer — idle alarms must not extend the unlock session).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== UNIFIED_REFRESH_ALARM_NAME) return;
  if (!isUnlocked || !walletService) return;
  refreshAllEnabledNetworks().catch(err =>
    console.warn('[UnifiedRefresh] alarm run failed:', err)
  );
});

// Popup port lifecycle — opening the popup connects a port named 'popup'.
// While any popup port is connected we run a faster setInterval; when the
// last one disconnects we fall back to the alarm-only cadence.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT_NAME) return;
  popupPorts.add(port);

  // Fast-path: if any cached entry for the *active* wallet is stale, kick off
  // an immediate refresh. Other wallets' caches are irrelevant here — we only
  // care about what the popup is about to render.
  if (isUnlocked && walletService) {
    const now = Date.now();
    const walletCache = getActiveWalletCache();
    let stale = false;
    for (const net of Object.values(walletCache)) {
      for (const entry of Object.values(net)) {
        if (now - entry.lastUpdated > BALANCE_CACHE_TTL) { stale = true; break; }
      }
      if (stale) break;
    }
    if (stale || Object.keys(walletCache).length === 0) {
      refreshAllEnabledNetworks().catch(() => { /* already logged */ });
    }
  }

  startPopupDrivenPolling();

  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
    if (popupPorts.size === 0) {
      stopBalancePolling();
    }
  });
});

function isChainMatch(chainType: PrivateKeyChain, config: Config['networks'][string]): boolean {
  switch (chainType) {
    case 'bitcoin':
      return isBitcoinNetworkConfig(config);
    case 'solana':
      return isSolanaNetworkConfig(config);
    case 'xrp':
      return isXRPNetworkConfig(config);
    case 'ton':
      return isTonNetworkConfig(config);
    case 'evm':
    default:
      return isEVMNetworkConfig(config);
  }
}

function getChainTypeForNetwork(networkKey: string, networks: Config['networks']): PrivateKeyChain {
  const config = networks[networkKey];
  if (!config) return 'evm';
  if (isBitcoinNetworkConfig(config)) return 'bitcoin';
  if (isSolanaNetworkConfig(config)) return 'solana';
  if (isXRPNetworkConfig(config)) return 'xrp';
  if (isTonNetworkConfig(config)) return 'ton';
  return 'evm';
}

function pickNetworkForChain(
  chainType: PrivateKeyChain,
  networks: Config['networks'],
  currentNetwork: string
): string {
  const currentConfig = networks[currentNetwork];
  if (currentConfig && isChainMatch(chainType, currentConfig)) {
    return currentNetwork;
  }

  const candidates = Object.entries(networks).filter(([, config]) => isChainMatch(chainType, config));
  if (!candidates.length) {
    return currentNetwork;
  }

  const mainnet = candidates.find(([, config]) => !config.isTestnet);
  return (mainnet ?? candidates[0])[0];
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
 * Migrates from old format (string[]) to new format (DappApproval[]) if needed.
 */
async function loadApprovedOrigins(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('approvedDapps');
    const data = stored?.approvedDapps;

    // Handle migration from old format (string[]) to new format (DappApproval[])
    if (Array.isArray(data)) {
      approvedDappOrigins = new Map();

      for (const item of data) {
        if (typeof item === 'string') {
          // Old format: just origin string - migrate with current timestamp
          approvedDappOrigins.set(item, {
            origin: item,
            approvedAt: Date.now(),
            sessionOnly: false
          });
        } else if (typeof item === 'object' && item.origin) {
          // New format: DappApproval object
          const approval = item as DappApproval;
          // Skip expired approvals during load
          if (Date.now() - approval.approvedAt <= DAPP_APPROVAL_EXPIRY_MS) {
            approvedDappOrigins.set(approval.origin, approval);
          }
        }
      }

      // Save in new format after migration
      await saveApprovedOrigins();
      console.log('[DappApproval] Loaded and migrated approved origins');
    }
  } catch (err) {
    console.warn('Failed to load approved origins', err);
  }
}

/**
 * Persists the current set of approved dApp origins to chrome.storage.local.
 * Only saves non-session-only approvals.
 */
async function saveApprovedOrigins(): Promise<void> {
  try {
    // Only persist non-session-only approvals
    const persistable: DappApproval[] = [];
    for (const approval of approvedDappOrigins.values()) {
      if (!approval.sessionOnly) {
        persistable.push(approval);
      }
    }
    await chrome.storage.local.set({ approvedDapps: persistable });
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
  chrome.runtime.sendMessage({ type: 'PROVIDER_EVENT', event, data }).catch(() => { });
}

/**
 * Broadcasts updated pending requests list to UI contexts.
 * Called when requests are added or resolved.
 */
function broadcastPendingRequests(): void {
  chrome.runtime.sendMessage({ type: 'PENDING_REQUESTS_UPDATED', pending: pendingRequests }).catch(() => { });
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

  // Load any user-entered Alchemy key BEFORE config substitution so its
  // RPC URLs are built with the effective key, and register it with the
  // redactor + Prices provider (user-entered key wins over build-time env).
  await loadStoredAlchemyKey();
  installConsoleRedactor(getEffectiveAlchemyKey());
  setAlchemyApiKey(getEffectiveAlchemyKey());

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
  // Keep the pre-substitution config so a runtime key change can
  // re-substitute in place (see applyAlchemyKeyToServices).
  pristineMergedConfig = mergedConfig as Config & { network: string };
  const { config, globalApiKey } = applyExplorerApiKeys(mergedConfig, {
    ...(import.meta.env as Record<string, string | undefined>),
    ALCHEMY_API_KEY: getEffectiveAlchemyKey(),
  });

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
  // Preload per-wallet preferences so any early lifecycle handler (e.g.
  // auto-unlock via persisted session) sees an already-populated map.
  await loadWalletPreferences();
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
 *
 * Security invariant: locking must destroy every decrypted secret in this
 * worker — the session password AND the Wallet's in-memory mnemonic/private
 * key/signer. `walletService` itself survives (the locked UI still needs the
 * wallet list and network config); UNLOCK_WALLET rebuilds the key material
 * from storage via `loadWallet(name, password)`.
 */
function lockWallet(): void {
  isUnlocked = false;
  setSessionPassword(null);

  // Drop decrypted mnemonic/private key/signer from the Wallet instance.
  walletService?.wallet.lock();
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  // Stop balance polling + clear the idle cross-chain refresh alarm.
  stopBalancePolling();
  clearUnifiedRefreshAlarm();

  // Security: Clear session-only dApp approvals on lock
  clearSessionOnlyApprovals();

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
        refreshBalancesForCurrentNetwork().catch(() => { });
      }
    } catch {
      // Ignore transient errors; keep polling until timeout.
    }
  }, intervalMs);

  bitcoinConfirmationPollers.set(txid, timer);
}

// ============================================================================
// Solana Confirmation Polling
// ============================================================================

const solanaConfirmationPollers = new Map<string, NodeJS.Timeout>();

function startSolanaConfirmationPolling(signature: string, networkKey: string): void {
  if (solanaConfirmationPollers.has(signature)) return;
  if (!walletService) return;

  const startedAt = Date.now();
  const maxMs = 60 * 1000; // 60 seconds (Solana is fast)
  const intervalMs = 2 * 1000; // 2 seconds

  const timer = setInterval(async () => {
    try {
      if (Date.now() - startedAt > maxMs) {
        clearInterval(timer);
        solanaConfirmationPollers.delete(signature);
        return;
      }

      // Get the Solana provider to check confirmation status
      const netConfig = walletService!.config.networks[networkKey];
      if (!netConfig || netConfig.type !== 'solana') {
        clearInterval(timer);
        solanaConfirmationPollers.delete(signature);
        return;
      }

      const rpcUrls = Array.isArray(netConfig.rpcUrl) ? netConfig.rpcUrl : [netConfig.rpcUrl];
      const { getSolanaProvider } = await import('../../src/solana/index.js');
      const provider = getSolanaProvider(networkKey, rpcUrls);

      const status = await provider.getSignatureStatus(signature);

      if (status.err) {
        // Transaction failed
        clearInterval(timer);
        solanaConfirmationPollers.delete(signature);
        if (transactionHistory) {
          transactionHistory.updateTransactionStatus(signature, TransactionStatus.FAILED, undefined, status.err);
        }
        broadcastTransactionStatus(signature, 'failed', networkKey, undefined, status.err);
        return;
      }

      if (status.confirmed) {
        clearInterval(timer);
        solanaConfirmationPollers.delete(signature);
        const slot = status.slot;
        if (transactionHistory) {
          transactionHistory.updateTransactionStatus(signature, TransactionStatus.CONFIRMED, slot);
        }
        broadcastTransactionStatus(signature, 'confirmed', networkKey, slot);
        refreshBalancesForCurrentNetwork().catch(() => { });
      }
    } catch {
      // Ignore transient errors; keep polling until timeout.
    }
  }, intervalMs);

  solanaConfirmationPollers.set(signature, timer);
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

    case 'GET_STATE': {
      let address: string | null = null;
      if (isUnlocked) {
        try {
          address = walletService!.getAddress();
        } catch (err) {
          // Address not available for current network/wallet type
        }
      }
      return {
        isUnlocked,
        hasWallet: walletService!.getAllWallets() && Object.keys(walletService!.getAllWallets()).length > 0,
        network: walletService!.config.network,
        address,
        currentWalletName: isUnlocked ? currentWalletName : null,
        importType: isUnlocked ? walletService!.wallet.importType : null,
        privateKeyType: isUnlocked ? walletService!.wallet.privateKeyType : null
      };
    }

    case 'CREATE_WALLET': {
      const walletName = payload.name || 'default';
      if (!isValidWalletName(walletName)) {
        throw new Error(getWalletNameValidationMessage());
      }
      const createPassword = payload.password ?? getSessionPassword();
      if (!createPassword) {
        throw new Error('Master password required');
      }
      setSessionPassword(createPassword);
      const newWallet = walletService!.createWallet(createPassword);
      walletService!.saveWallet(walletName);
      currentWalletName = walletName;
      isUnlocked = true;

      // Created wallets are mnemonic (multi-chain) — default them to EVM
      // mainnet rather than inheriting the previous wallet's network or the
      // bundled `solana-mainnet` default.
      await loadWalletPreferences();
      const createDefaultNetwork = defaultNetworkForImport(
        'mnemonic',
        undefined,
        walletService!.config.network
      );
      if (
        walletService!.config.networks[createDefaultNetwork] &&
        walletService!.config.network !== createDefaultNetwork
      ) {
        await walletService!.setNetwork(createDefaultNetwork);
      }
      await setWalletPreferredNetwork(walletName, walletService!.config.network);

      broadcastAccountsChanged([newWallet.address]);
      broadcastWalletContext();

      // Initialize transaction history for this wallet
      const createStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(createStorage, currentWalletName);

      resetAutoLockTimer();

      // Security: Only return mnemonic if explicitly requested (for initial backup display)
      // The mnemonic is stored encrypted and can be retrieved via GET_SECRET_PHRASE with password
      const response: { success: boolean; address: string; mnemonic?: string; requiresBackup: boolean } = {
        success: true,
        address: walletService!.getAddress(),
        requiresBackup: true // Signal to UI that user should backup their mnemonic
      };

      // Only include mnemonic if this is initial creation (showMnemonic flag)
      // This limits exposure - subsequent retrievals require password via GET_SECRET_PHRASE
      if (payload.showMnemonic === true) {
        response.mnemonic = newWallet.mnemonic;
      }

      return response;
    }

    case 'IMPORT_WALLET':
      const importWalletName = payload.name || 'default';
      if (!isValidWalletName(importWalletName)) {
        throw new Error(getWalletNameValidationMessage());
      }
      const importPassword = payload.password ?? getSessionPassword();
      if (!importPassword) {
        throw new Error('Master password required');
      }
      setSessionPassword(importPassword);

      let importedWallet;
      let importedChainType: PrivateKeyChain | undefined;
      if (payload.privateKey) {
        // Private Key Import
        if (!payload.chainType) {
          throw new Error('Chain type required for private key import');
        }
        if (!isPrivateKeyChain(payload.chainType)) {
          throw new Error('Unsupported chain type for private key import');
        }
        importedChainType = payload.chainType;
        importedWallet = walletService!.importFromPrivateKey(
          payload.privateKey,
          payload.chainType,
          importPassword
        );
      } else {
        // Mnemonic Import (Default)
        importedWallet = walletService!.importWallet(
          payload.mnemonic,
          importPassword,
          payload.accountIndex || 0
        );
      }

      walletService!.saveWallet(importWalletName);
      currentWalletName = importWalletName;
      isUnlocked = true;

      // Pick the target network for the fresh wallet BEFORE any broadcast. A
      // previously-stored preference (re-import into an existing name) wins;
      // otherwise pick a sensible default based on import type so the UI never
      // inherits the shared `config.network` leaked from the previous wallet
      // (which, for a fresh install, defaults to `solana-mainnet` from the
      // bundled config.json — the source of the visible "flash of Solana").
      await loadWalletPreferences();
      const importTargetNetwork =
        getWalletPreferredNetwork(importWalletName) ??
        defaultNetworkForImport(
          importedChainType ? 'privateKey' : 'mnemonic',
          importedChainType,
          walletService!.config.network
        );
      if (walletService!.config.networks[importTargetNetwork] && walletService!.config.network !== importTargetNetwork) {
        await walletService!.setNetwork(importTargetNetwork);
      }
      await setWalletPreferredNetwork(importWalletName, walletService!.config.network);

      broadcastAccountsChanged([importedWallet.address]);
      broadcastWalletContext();

      // Initialize transaction history for this wallet
      const importStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(importStorage, currentWalletName);

      // Restore any persisted per-wallet cache (SW eviction recovery) and then
      // wipe the import target's slot so the popup cannot see data left over
      // from a prior same-named wallet (e.g. user re-imports into an existing
      // wallet name). The per-wallet shape means *other* wallets' caches are
      // preserved untouched, so switching back to them stays instant.
      await loadBalanceCache();
      clearBalanceCache({ wallet: importWalletName });
      await saveBalanceCache();
      refreshAllEnabledNetworks().catch(err => {
        console.warn('[UnifiedRefresh] post-import fan-out failed:', err);
      });
      ensureUnifiedRefreshAlarm();

      resetAutoLockTimer();
      return {
        success: true,
        address: walletService!.getAddress(),
        walletName: currentWalletName
      };

    case 'UNLOCK_WALLET':
      const unlockWalletName = payload.name || 'default';
      const unlockPassword = payload.password ?? getSessionPassword();
      const loaded = walletService!.loadWallet(unlockWalletName, unlockPassword);
      if (!loaded) {
        throw new Error('Invalid password or wallet not found');
      }
      setSessionPassword(unlockPassword || null);
      currentWalletName = unlockWalletName;
      isUnlocked = true;

      // Restore this wallet's preferred network before we broadcast any state,
      // so the UI sees the right chain on first render. Silently no-ops if
      // the preference is missing or points at a network that's been removed.
      await loadWalletPreferences();
      const unlockPreferredNetwork = getWalletPreferredNetwork(unlockWalletName);
      if (
        unlockPreferredNetwork &&
        walletService!.config.networks[unlockPreferredNetwork] &&
        walletService!.config.network !== unlockPreferredNetwork
      ) {
        await walletService!.setNetwork(unlockPreferredNetwork);
      }

      broadcastAccountsChanged([loaded.address]);
      broadcastWalletContext();

      // Initialize transaction history for this wallet
      const storage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(storage, currentWalletName);

      // Load balance cache; kick off an immediate fan-out refresh across every
      // enabled chain so the unified view has data to render on first paint.
      // Popup-driven polling starts when a popup port connects; the idle
      // alarm keeps cadence when the popup is closed.
      await loadBalanceCache();
      refreshAllEnabledNetworks().catch(err => {
        console.warn('[UnifiedRefresh] post-unlock fan-out failed:', err);
      });
      ensureUnifiedRefreshAlarm();

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
      const switchPassword = getSessionPassword();
      if (!switchPassword) {
        throw new Error('Session password not available. Please unlock wallet first.');
      }
      const switchedWallet = walletService!.loadWallet(switchWalletName, switchPassword);
      if (!switchedWallet) {
        throw new Error('Failed to load wallet or invalid password');
      }
      currentWalletName = switchWalletName;
      isUnlocked = true;

      // Restore the target wallet's preferred network. Must happen before the
      // context broadcast so the popup receives one coherent envelope
      // (walletName + network together), not a flash where network lags the
      // walletName change by a round-trip.
      await loadWalletPreferences();
      const switchPreferredNetwork = getWalletPreferredNetwork(switchWalletName);
      if (
        switchPreferredNetwork &&
        walletService!.config.networks[switchPreferredNetwork] &&
        walletService!.config.network !== switchPreferredNetwork
      ) {
        await walletService!.setNetwork(switchPreferredNetwork);
      }

      // Initialize transaction history for the switched wallet
      const switchStorage = await ChromeStorageAdapter.create();
      transactionHistory = new TransactionHistoryManager(switchStorage, currentWalletName);

      // Notify the popup that the active address changed. The unified hook
      // refetches on walletName changes via its dep array, so this is
      // redundant for the portfolio view, but dApp provider consumers still
      // rely on accountsChanged.
      broadcastAccountsChanged([switchedWallet.address]);
      broadcastWalletContext();

      // Kick off a fan-out refresh so this wallet's cache — which may be
      // empty (first visit) or stale (returning after a long gap) — is
      // brought up to date. When it lands, broadcastUnifiedPortfolio pushes
      // the fresh snapshot to the popup. Non-blocking so the switch feels
      // instant even on slow chains.
      refreshAllEnabledNetworks().catch(err => {
        console.warn('[UnifiedRefresh] post-switch fan-out failed:', err);
      });
      ensureUnifiedRefreshAlarm();

      resetAutoLockTimer();
      return {
        success: true,
        address: walletService!.getAddress(),
        walletName: currentWalletName
      };

    case 'RENAME_WALLET': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const oldName = payload?.oldName;
      const newName = payload?.newName;
      if (!oldName || !newName) {
        throw new Error('Wallet name is required');
      }
      if (!isValidWalletName(newName)) {
        throw new Error(getWalletNameValidationMessage());
      }
      const allWallets = walletService!.getAllWallets();
      if (!allWallets[oldName]) {
        throw new Error('Wallet not found');
      }
      if (oldName !== newName && allWallets[newName]) {
        throw new Error('A wallet with this name already exists');
      }

      walletService!.renameWallet(oldName, newName);

      // Migrate transaction history to the new storage key (keep old key as backup).
      try {
        const storage = await ChromeStorageAdapter.create();
        const oldKey = `transactions_${oldName}`;
        const newKey = `transactions_${newName}`;
        const txs = storage.readJSON(oldKey, []);
        if (Array.isArray(txs)) {
          storage.writeJSON(newKey, txs);
        }
      } catch (err) {
        console.warn('[RENAME_WALLET] Failed to migrate tx history:', err);
      }

      if (currentWalletName === oldName) {
        currentWalletName = newName;
        const storage = await ChromeStorageAdapter.create();
        transactionHistory = new TransactionHistoryManager(storage, currentWalletName);
      }

      return { success: true, walletName: currentWalletName };
    }

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
      // Trigger balance refresh for current network.
      // IMPORTANT (MV3): await the refresh to keep the service worker alive long enough
      // for network calls + BALANCES_UPDATED broadcast to complete.
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      try {
        await refreshBalancesForCurrentNetwork();
        return { success: true, message: 'Balance refresh completed', network: walletService!.config.network };
      } catch (err: any) {
        console.warn('[REFRESH_BALANCES] Error:', err);
        return { success: false, error: err?.message || 'Balance refresh failed', network: walletService!.config.network };
      }

    case 'GET_CACHED_BALANCES':
      // Returns only cached balances for a network (scoped to active wallet)
      if (!isUnlocked) throw new Error('Wallet is locked');
      const cacheNetwork = payload?.network || walletService!.config.network;
      return {
        balances: getActiveWalletCache()[cacheNetwork] || {},
        network: cacheNetwork
      };

    case 'GET_UNIFIED_PORTFOLIO': {
      // Returns an aggregated cross-chain snapshot from the current cache.
      // Cache-only read — no network I/O. Locked wallets get an empty snapshot
      // with `locked: true` rather than throwing, so the popup can render a
      // locked state without triggering an error toast.
      if (!isUnlocked) {
        return {
          snapshot: {
            rows: [],
            totalUsd: 0,
            totalUsdFormatted: '$0.00',
            networkStaleness: {},
            updatedAt: Date.now(),
            locked: true,
          } satisfies UnifiedPortfolioSnapshot,
        };
      }
      resetAutoLockTimer();
      const snapshot = await buildUnifiedPortfolioSnapshot(payload?.options || {});
      return { snapshot };
    }

    case 'REFRESH_UNIFIED_PORTFOLIO': {
      // Force a fan-out refresh across every enabled chain and return the
      // freshly-built snapshot. Awaited so the popup can show a spinner until
      // completion; failures of individual chains are silent (per-row stale
      // indicators communicate them via the snapshot).
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      await refreshAllEnabledNetworks();
      const snapshot = await buildUnifiedPortfolioSnapshot(payload?.options || {});
      return { snapshot };
    }

    case 'GET_ENABLED_NETWORKS': {
      // Returns the list of networks this wallet can both see + use, used by
      // the scope modal and the unified view for chain-badge / label lookup.
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      const enabled = getEnabledNetworksForWallet().map(([key, config]: [string, any]) => ({
        key,
        label: config.name || key,
        nativeSymbol: config.nativeSymbol,
        isTestnet: Boolean(config.isTestnet),
        type: config.type ?? 'evm',
      }));
      return { networks: enabled };
    }

    case 'GET_TOKEN_PRICES': {
      // Fetch prices for tokens and calculate total portfolio value
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const priceNetwork = walletService!.config.network;
      const networkConfig = walletService!.config.networks[priceNetwork];

      // Testnet short-circuit: return null prices / $0 total. Mirrors the
      // data-layer guard in resolvePricesForNetwork so the single-network
      // view agrees with the unified view about what testnet balances are
      // worth (nothing).
      if (!pricesAvailableForNetwork(networkConfig)) {
        return {
          prices: {},
          totalValue: 0,
          formattedTotal: '$0.00',
          network: priceNetwork,
          isTestnet: true,
        };
      }

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

      // Handle Solana networks (native SOL + SPL token prices)
      if (isSolanaNetworkKey(priceNetwork)) {
        try {
          const solPrice = await getSolanaPrice();
          const cached = getCachedBalance(priceNetwork, { type: 'native' });
          const balance = cached?.balance || '0';
          const solAmount = parseFloat(balance);
          let totalValue = solPrice ? solAmount * solPrice : 0;

          const splTokens = walletService!.getTokensForNetwork(priceNetwork)
            .filter((token) => token.type === 'spl' && token.address);
          const prices: Record<string, number | null> = { native: solPrice };

          if (splTokens.length) {
            for (const token of splTokens) {
              let tokenPrice: number | null = null;
              try {
                tokenPrice = await getTokenPriceBySymbol(token.symbol);
              } catch (error) {
                console.warn('[GET_TOKEN_PRICES] SPL token price error:', token.symbol, error);
              }
              prices[token.address] = tokenPrice;

              const tokenCached = getCachedBalance(priceNetwork, token);
              const tokenAmount = parseFloat(tokenCached?.balance || '0');
              if (tokenPrice !== null && Number.isFinite(tokenAmount)) {
                totalValue += tokenAmount * tokenPrice;
              }
            }
          }

          return {
            prices,
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

      // Handle XRP networks (native XRP only)
      if (isXRPNetworkKey(priceNetwork)) {
        try {
          const xrpPrice = await getXRPPrice(priceNetwork);
          const cached = getCachedBalance(priceNetwork, { type: 'native' });
          const balance = cached?.balance || '0';
          const xrpAmount = parseFloat(balance);
          const totalValue = xrpPrice ? xrpAmount * xrpPrice : 0;

          return {
            prices: { native: xrpPrice },
            totalValue,
            formattedTotal: formatUSDValue(totalValue),
            network: priceNetwork,
            isXrp: true
          };
        } catch (error) {
          console.warn('[GET_TOKEN_PRICES] XRP price error:', error);
          return {
            prices: {},
            totalValue: 0,
            formattedTotal: '$0.00',
            network: priceNetwork,
            isXrp: true,
            error: 'Failed to fetch XRP price'
          };
        }
      }

      // Handle TON networks (native TON only)
      if (isTonNetworkKey(priceNetwork)) {
        try {
          const tonPrice = await getTonPrice();
          const cached = getCachedBalance(priceNetwork, { type: 'native' });
          const balance = cached?.balance || '0';
          const tonAmount = parseFloat(balance);
          const totalValue = tonPrice ? tonAmount * tonPrice : 0;

          return {
            prices: { native: tonPrice },
            totalValue,
            formattedTotal: formatUSDValue(totalValue),
            network: priceNetwork,
            isTon: true
          };
        } catch (error) {
          console.warn('[GET_TOKEN_PRICES] TON price error:', error);
          return {
            prices: {},
            totalValue: 0,
            formattedTotal: '$0.00',
            network: priceNetwork,
            isTon: true,
            error: 'Failed to fetch TON price'
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

    case 'GET_TOKEN_PRICE_HISTORY': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const symbol = payload?.symbol;
      const timeRange = payload?.timeRange;
      if (!symbol || !timeRange) {
        return { error: 'Missing symbol or timeRange' };
      }

      const cacheKey = `${String(symbol).toUpperCase()}-${String(timeRange)}`;
      const cached = priceHistoryCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < PRICE_HISTORY_TTL) {
        return { result: cached.result };
      }

      try {
        const result = await getPriceHistory(symbol, timeRange);
        if (!result) {
          return { error: 'Price history unavailable' };
        }
        priceHistoryCache.set(cacheKey, { result, fetchedAt: Date.now() });
        return { result };
      } catch (error) {
        console.warn('[GET_TOKEN_PRICE_HISTORY] Error:', error);
        return { error: 'Failed to fetch price history' };
      }
    }

    case 'GET_TOKEN_MARKET_DETAILS': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      const symbol = payload?.symbol;
      if (!symbol) {
        return { error: 'Missing symbol' };
      }

      try {
        const metadata = await getTokenMetadata(symbol);
        if (!metadata) {
          return { error: 'Market data unavailable' };
        }
        return { metadata };
      } catch (error) {
        console.warn('[GET_TOKEN_MARKET_DETAILS] Error:', error);
        return { error: 'Failed to fetch market details' };
      }
    }

    case 'SEND_TRANSACTION':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();

      // Allow the popup to target a network other than the wallet's globally
      // active one (multi-network Send). When omitted, falls back to active.
      const network = (payload?.networkKey && typeof payload.networkKey === 'string')
        ? payload.networkKey
        : walletService!.config.network;
      const sendNetworkConfig = walletService!.config.networks[network];
      if (!sendNetworkConfig) {
        throw new Error(`Unknown network: ${network}`);
      }
      // From-address is chain-specific, so derive it from the target network.
      const fromAddress = walletService!.getAddressForChain(
        isSolanaNetworkConfig(sendNetworkConfig) ? 'solana'
        : isBitcoinNetworkConfig(sendNetworkConfig) ? 'bitcoin'
        : isXRPNetworkConfig(sendNetworkConfig) ? 'xrp'
        : isTonNetworkConfig(sendNetworkConfig) ? 'ton'
        : 'evm'
      ) || walletService!.getAddress();

      try {
        // Solana send path (broadcast + pending)
        if (isSolanaNetworkConfig(sendNetworkConfig)) {
          const solanaPassword = getSessionPassword();
          if (!solanaPassword) {
            throw new Error('Session password not available. Please unlock wallet again.');
          }

          const isSplToken = payload.token?.type === 'spl';
          const result = isSplToken
            ? await walletService!.sendSolanaTokenTransaction(
              payload.token,
              payload.toAddress,
              payload.amount,
              solanaPassword,
              network
            )
            : await walletService!.sendSolanaTransaction(
              payload.toAddress,
              payload.amount,
              solanaPassword,
              network
            );

          // Track transaction in history as pending
          if (transactionHistory && result.signature) {
            transactionHistory.addTransaction({
              hash: result.signature,
              from: fromAddress,
              to: payload.toAddress,
              value: payload.amount,
              network: network,
              status: TransactionStatus.PENDING,
              type: TransactionType.SEND,
              timestamp: Date.now(),
              tokenSymbol: isSplToken ? payload.token.symbol : (sendNetworkConfig.nativeSymbol || 'SOL'),
              tokenAddress: isSplToken ? payload.token.address : ''
            });
          }

          broadcastTransactionStatus(result.signature, 'pending', network);
          startSolanaConfirmationPolling(result.signature, network);

          return {
            result: {
              hash: result.signature,
              status: 'pending',
              feeSol: result.feeSol,
              feeLamports: result.feeLamports
            }
          };
        }

        // Bitcoin send path (broadcast + pending)
        if (isBitcoinNetworkConfig(sendNetworkConfig)) {
          const bitcoinPassword = getSessionPassword();
          if (!bitcoinPassword) {
            throw new Error('Session password not available. Please unlock wallet again.');
          }

          const result = await walletService!.sendBitcoinTransaction(
            payload.toAddress,
            payload.amount,
            bitcoinPassword,
            network
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

        // XRP send path (broadcast + pending)
        if (isXRPNetworkConfig(sendNetworkConfig)) {
          const xrpPassword = getSessionPassword();
          if (!xrpPassword) {
            throw new Error('Session password not available. Please unlock wallet again.');
          }

          const result = await walletService!.sendXRPTransaction(
            payload.toAddress,
            payload.amount,
            xrpPassword,
            payload.destinationTag,
            network
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
              tokenSymbol: sendNetworkConfig.nativeSymbol || 'XRP',
              tokenAddress: '',
              destinationTag: payload.destinationTag
            });
          }

          broadcastTransactionStatus(result.hash, 'pending', network);

          return {
            result: {
              hash: result.hash,
              status: 'pending',
              feeXrp: result.feeXrp,
              feeDrops: result.feeDrops
            }
          };
        }

        // TON send path (broadcast + pending)
        if (isTonNetworkConfig(sendNetworkConfig)) {
          const tonPassword = getSessionPassword();
          if (!tonPassword) {
            throw new Error('Session password not available. Please unlock wallet again.');
          }

          const result = await walletService!.sendTonTransaction(
            payload.toAddress,
            payload.amount,
            tonPassword,
            payload.comment,
            network
          );

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
              tokenSymbol: sendNetworkConfig.nativeSymbol || 'TON',
              tokenAddress: ''
            });
          }

          broadcastTransactionStatus(result.hash, 'pending', network);

          return {
            result: {
              hash: result.hash,
              status: 'pending'
            }
          };
        }

        // EVM path: call sendToken - this waits for confirmation
        const result = await walletService!.sendToken(payload.token, payload.toAddress, payload.amount, network);

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
      // Optional `payload.networkKey` lets the Send confirmation view display
      // the chain + explorer for a cross-chain asset without switching the
      // wallet's active network.
      const requestedKey = payload?.networkKey;
      const netConfigNetwork = (typeof requestedKey === 'string' && walletService.config.networks[requestedKey])
        ? requestedKey
        : walletService.config.network;
      const netConfigData = walletService.config.networks[netConfigNetwork];
      const isBitcoin = isBitcoinNetworkConfig(netConfigData);
      const isSolana = isSolanaNetworkConfig(netConfigData);
      const isXrp = isXRPNetworkConfig(netConfigData);
      const isTon = isTonNetworkConfig(netConfigData);
      return {
        network: netConfigNetwork,
        blockExplorer: netConfigData?.blockExplorer || null,
        chainId: isEVMNetworkConfig(netConfigData) ? netConfigData.chainId : undefined,
        isBitcoin,
        isSolana,
        isXrp,
        isTon,
        bitcoinNetwork: isBitcoin ? (netConfigData as any).bitcoinNetwork : undefined,
        solanaCluster: isSolana ? (netConfigData as any).solanaCluster : undefined,
        xrpNetwork: isXrp ? (netConfigData as any).xrpNetwork : undefined,
        tonNetwork: isTon ? (netConfigData as any).tonNetwork : undefined
      };
    }

    case 'GET_GAS_ESTIMATE': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      if (!walletService) throw new Error('Wallet not initialized');
      resetAutoLockTimer();

      const { token, toAddress, amount, networkKey } = payload;
      // Use shared gas estimation from WalletAppService. `networkKey` lets the
      // Send form price a fee on a network other than the globally active one.
      return walletService.getGasEstimate(token, toAddress, amount, networkKey);
    }

    case 'GET_SENDABLE_ASSETS': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      if (!walletService) throw new Error('Wallet not initialized');
      resetAutoLockTimer();

      // Reuse the already-cached unified portfolio snapshot. Filter to rows
      // with a positive balance and no blocking error — those are the assets
      // the wallet can actually send right now. The result is a flat list
      // (network, token, balance, usd) so the popup doesn't have to know how
      // the snapshot was produced.
      const snapshot = await buildUnifiedPortfolioSnapshot(payload?.options || {});
      const assets = snapshot.rows
        .filter(row => !row.error && row.balanceNumber > 0)
        .map(row => ({
          networkKey: row.networkKey,
          networkLabel: row.networkLabel,
          chainBadgeIcon: row.chainBadgeIcon,
          token: row.token,
          balance: row.balance,
          balanceNumber: row.balanceNumber,
          usdValue: row.usdValue,
          usdFormatted: row.usdFormatted,
        }));
      return { assets };
    }

    case 'SWITCH_NETWORK':
      await walletService!.setNetwork(payload.network);
      const switchNetworkConfig = walletService!.config.networks[payload.network];
      // Remember this network as the active wallet's preferred chain so the
      // next switch/unlock restores it. `currentWalletName` is non-null here
      // because SWITCH_NETWORK requires an unlocked wallet.
      if (currentWalletName) {
        await setWalletPreferredNetwork(currentWalletName, payload.network);
      }
      // Clear cached balances for the target network on the active wallet to
      // avoid stale data bleed while the fresh fetch is in flight.
      clearBalanceCache({ network: payload.network });
      saveBalanceCache().catch(() => { });
      // Kick off a refresh for the new network (non-blocking)
      refreshBalancesForCurrentNetwork().catch(() => { });
      // Only broadcast chainChanged for EVM networks (Bitcoin doesn't have chainId)
      if (isEVMNetworkConfig(switchNetworkConfig)) {
        const chainHex = '0x' + switchNetworkConfig.chainId.toString(16);
        broadcastChainChanged(chainHex);
      }
      broadcastWalletContext();
      return { success: true, network: payload.network };

    case 'GET_NETWORKS':
      return { networks: walletService!.config.networks };

    case 'GET_SHOW_TESTNETS':
      return { showTestnets: walletService!.config.showTestnets ?? false };

    case 'SET_SHOW_TESTNETS': {
      const enabled = Boolean(payload?.showTestnets);
      walletService!.config.showTestnets = enabled;
      const storedConfig = walletService!.storage.readJSON<Partial<Config & { network: string; showTestnets?: boolean }>>(
        'config.json',
        {}
      );
      walletService!.storage.writeJSON('config.json', { ...storedConfig, showTestnets: enabled });
      return { showTestnets: enabled };
    }

    case 'GET_ALCHEMY_KEY_STATUS': {
      // Raw key never leaves the worker — masked/boolean status only.
      const effective = getEffectiveAlchemyKey();
      return {
        hasKey: Boolean(effective),
        source: runtimeAlchemyKey ? 'stored' : effective ? 'buildtime' : null,
        masked: effective ? maskAlchemyKey(effective) : undefined,
      };
    }

    case 'SET_ALCHEMY_KEY': {
      const key = typeof payload?.key === 'string' ? payload.key.trim() : '';
      if (!looksLikeAlchemyKey(key)) {
        return { ok: false, reason: 'invalid-format' };
      }
      if (!payload?.allowUnvalidated) {
        const validation = await validateAlchemyKey(key);
        if (!validation.ok) return validation;
      }
      await chrome.storage.local.set({ [ALCHEMY_KEY_STORAGE_KEY]: key });
      runtimeAlchemyKey = key;
      await applyAlchemyKeyToServices();
      return { ok: true };
    }

    case 'CLEAR_ALCHEMY_KEY': {
      await chrome.storage.local.remove(ALCHEMY_KEY_STORAGE_KEY);
      runtimeAlchemyKey = undefined;
      await applyAlchemyKeyToServices();
      const remaining = getEffectiveAlchemyKey();
      return {
        hasKey: Boolean(remaining),
        source: remaining ? 'buildtime' : null,
        masked: remaining ? maskAlchemyKey(remaining) : undefined,
      };
    }

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

        // Solana explorer fetching (Phase 2)
        if (isSolanaNetworkConfig(explorerNetworkConfig)) {
          const limit = payload.pageSize || 25;
          const solTxs = await walletService!.getSolanaTransactionHistoryForAddress(explorerAddress, limit);
          const nativeSymbol = explorerNetworkConfig.nativeSymbol || 'SOL';

          const transactions = solTxs.map((tx) => ({
            hash: tx.signature,
            from: tx.from,
            to: tx.to || null,
            // valueSol is already formatted (avoid wei assumptions in ActivityView)
            value: tx.valueToken ?? tx.valueSol,
            network: explorerNetwork,
            status: tx.status,
            type: tx.type,
            timestamp: tx.timestamp,
            blockNumber: tx.slot || undefined,
            tokenSymbol: tx.tokenSymbol || nativeSymbol,
            tokenAddress: tx.tokenAddress,
            fee: tx.feeSol
          }));

          return { transactions, supported: true };
        }

        // XRP explorer fetching
        if (isXRPNetworkConfig(explorerNetworkConfig)) {
          const limit = payload.pageSize || 25;
          const xrpTxs = await walletService!.getXRPTransactionHistoryForAddress(explorerAddress, limit, explorerNetwork);
          const nativeSymbol = explorerNetworkConfig.nativeSymbol || 'XRP';

          const transactions = xrpTxs.map((tx) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to || null,
            value: tx.valueXrp, // already formatted XRP string
            network: explorerNetwork,
            status: tx.status,
            type: tx.type === 'other' ? 'contract_interaction' : tx.type,
            timestamp: tx.timestamp,
            tokenSymbol: nativeSymbol,
            fee: tx.feeXrp,
            destinationTag: tx.destinationTag
          }));

          return { transactions, supported: true };
        }

        if (isTonNetworkConfig(explorerNetworkConfig)) {
          const limit = payload.pageSize || 25;
          const tonTxs = await walletService!.getTonTransactionHistoryForAddress(explorerAddress, limit, explorerNetwork);
          const nativeSymbol = explorerNetworkConfig.nativeSymbol || 'TON';

          const transactions = tonTxs.map((tx) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to || null,
            value: tx.valueTon,
            network: explorerNetwork,
            status: tx.status,
            type: tx.type === 'other' ? 'contract_interaction' : tx.type,
            timestamp: tx.timestamp,
            tokenSymbol: nativeSymbol,
            fee: undefined
          }));

          return { transactions, supported: true };
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

    case 'GET_CHAIN_ADDRESS': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      const chain = payload?.chain;
      if (chain !== 'evm' && chain !== 'solana' && chain !== 'bitcoin' && chain !== 'xrp' && chain !== 'ton') {
        throw new Error('Invalid chain');
      }
      return { address: walletService!.getAddressForChain(chain) };
    }

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
        const chainType = isPrivateKeyChain(payload.chainType)
          ? payload.chainType
          : getChainTypeForNetwork(walletService!.config.network, walletService!.config.networks);
        const networkKey = pickNetworkForChain(chainType, walletService!.config.networks, walletService!.config.network);
        const format = payload.format as PrivateKeyFormat | undefined;
        const result = walletService!.getPrivateKeyForChain(chainType, payload.password, { networkKey, format });
        return { privateKey: result.privateKey, format: result.format, chainType, network: networkKey };
      } catch (err: any) {
        return { error: err.message || 'Failed to retrieve private key' };
      }

    case 'CHANGE_PASSWORD':
      if (!isUnlocked) throw new Error('Wallet is locked');
      resetAutoLockTimer();
      if (!payload?.currentPassword || !payload?.newPassword) {
        throw new Error('Password required');
      }
      try {
        walletService!.changePassword(currentWalletName, payload.currentPassword, payload.newPassword);
        setSessionPassword(payload.newPassword);
        return { success: true };
      } catch (err: any) {
        return { error: err.message || 'Failed to change password' };
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
      broadcastWalletContext();
      return { success: true, address: walletService!.getAddress(), index: switchedAccount.accountIndex };

    case 'GET_ALL_WALLETS':
      // Allow getting wallet list even when locked (needed for unlock screen)
      const allWallets = walletService!.getAllWallets();
      return { wallets: allWallets };

    case 'DELETE_WALLET':
      if (!isUnlocked) throw new Error('Wallet is locked');
      const deleted = walletService!.deleteWallet(payload.name);
      if (deleted) {
        // Reclaim the deleted wallet's balance cache so an unrelated future
        // wallet created with the same name can't inherit old data.
        clearBalanceCache({ wallet: payload.name });
        saveBalanceCache().catch(() => { });
        // Same concern for the wallet's preferred-network entry.
        removeWalletPreferences(payload.name).catch(() => { });
      }
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

      const addr = walletService!.getAddress();

      // Check if this origin is already approved and not expired
      if (origin && isDappApproved(origin)) {
        // Already approved - return accounts without prompting
        emitProviderEvent('connect', { chainId: '0x' + ethReqNetworkConfig.chainId.toString(16) });
        broadcastAccountsChanged([addr]);
        return { accounts: [addr] };
      }

      // Need approval - check if already pending
      if (pendingRequests.some(r => r.type === 'connect')) {
        throw new Error('Connection request already pending');
      }

      // Request user approval
      await enqueueApproval({
        id: createRequestId(),
        type: 'connect',
        origin: origin || 'unknown',
        createdAt: Date.now()
      });

      // User approved - save with expiration timestamp
      // Default to persistent approval (sessionOnly: false)
      // UI can be extended to offer session-only option
      if (origin) {
        approveDapp(origin, false);
      }

      emitProviderEvent('connect', { chainId: '0x' + ethReqNetworkConfig.chainId.toString(16) });
      broadcastAccountsChanged([addr]);
      return { accounts: [addr] };
    }

    case 'REVOKE_DAPP_APPROVAL': {
      if (!isUnlocked) throw new Error('Wallet is locked');
      const revokeOrigin = payload?.origin;
      if (revokeOrigin) {
        revokeDappApproval(revokeOrigin);
      }
      return { success: true };
    }

    case 'GET_APPROVED_DAPPS': {
      // Return list of approved dApps with their approval info
      const approvals: Array<{ origin: string; approvedAt: number; sessionOnly: boolean; expiresAt: number }> = [];
      for (const approval of approvedDappOrigins.values()) {
        approvals.push({
          ...approval,
          expiresAt: approval.approvedAt + DAPP_APPROVAL_EXPIRY_MS
        });
      }
      return { approvals };
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
  console.log('Simple Wallet extension installed');
  initializeWalletService();
});

/** Initialize wallet service on browser startup */
initializeWalletService();

console.log('Simple Wallet background service worker loaded');
