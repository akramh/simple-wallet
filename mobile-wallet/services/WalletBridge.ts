/**
 * @fileoverview WalletBridge - Mobile adapter for WalletAppService.
 *
 * This service provides a clean API for the mobile UI to interact with
 * the wallet core. It mirrors the extension's message types but calls
 * WalletAppService directly instead of using chrome.runtime.sendMessage.
 *
 * Key responsibilities:
 * - Initialize and manage WalletAppService instance
 * - Handle session state (unlock, lock, auto-lock timer)
 * - Provide typed async methods for all wallet operations
 * - Manage password session securely in memory
 *
 * @responsibilities
 * - Provide a single, typed entry point for mobile UI operations (create/import/unlock/send/etc.)
 * - Adapt the shared SDK to React Native constraints (Metro resolution, dynamic requires)
 * - Normalize chain-specific data (e.g., transaction history shapes) for the UI layer
 *
 * @security
 * - Session password is stored in memory only (`sessionPassword`) and cleared on lock
 * - Auto-lock timer clears the in-memory session after inactivity (default: 15 minutes)
 * - Secret phrase / private key retrieval requires password confirmation (compares to session password)
 *
 * @notes
 * - `initialize()` must be called before most operations; `requireUnlocked()` guards unlocked-only calls.
 * - Imports from `@wallet/*` are resolved by `mobile-wallet/metro.config.js` (including `.js` → `.ts`).
 */

import { mobileStorage, MobileStorageAdapter } from './MobileStorageAdapter';
import { mobileCrypto, MobileCryptoAdapter } from './MobileCryptoAdapter';
import { cacheService } from './CacheService';
import type { Token } from '@wallet/types/token';

// Types (these match the extension's service-worker types)
export interface WalletState {
  isUnlocked: boolean;
  hasWallet: boolean;
  network: string;
  address: string | null;
  currentWalletName: string | null;
}

export interface CreateWalletResult {
  success: boolean;
  address: string;
  mnemonic?: string;
}

export interface ImportWalletResult {
  success: boolean;
  address: string;
}

export interface UnlockWalletResult {
  success: boolean;
  address: string;
  walletName: string;
}

export interface TokenBalance {
  token: Token;
  balance: string | null;
  lastUpdated: number | null;
  isLoading: boolean;
  isVisible?: boolean;
}

export interface Transaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  network: string;
  status: 'pending' | 'confirmed' | 'failed';
  type: 'send' | 'receive' | 'contract_interaction';
  timestamp: number;
  blockNumber?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
  fee?: string;
}

export type { Token };

export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  estimatedCostWei: string;
  estimatedCostNative: string;
  nativeSymbol: string;
  supportsEIP1559: boolean;
  network: string;
  error?: string;
}

export interface SendTransactionResult {
  hash: string;
  status: 'pending' | 'confirmed';
  blockNumber?: number;
}

export interface NetworkConfig {
  name: string;
  rpcUrl?: string | string[];
  wsUrl?: string | string[];
  chainId?: number;
  nativeSymbol: string;
  nativeName?: string;
  blockExplorer?: string;
  explorerApiUrl?: string;
  explorerApiKey?: string;
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
  bitcoinNetwork?: 'mainnet' | 'testnet';
  solanaCluster?: 'mainnet-beta' | 'devnet' | 'testnet';
  xrpNetwork?: 'mainnet' | 'testnet' | 'devnet';
  tonNetwork?: 'mainnet' | 'testnet';
  rpcApiKey?: string;
  isTestnet?: boolean;
}

export interface Config {
  network: string;
  networks: Record<string, NetworkConfig>;
}

/**
 * WalletBridge singleton class.
 *
 * Provides the interface between mobile UI and wallet core.
 */
class WalletBridge {
  private service: any = null; // WalletAppService - typed as any to avoid import issues
  private wallet: any = null; // Wallet
  private config: Config | null = null;
  private sessionPassword: string | null = null;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLockTimeoutMs = 15 * 60 * 1000; // 15 minutes default
  private isInitialized = false;
  private currentWalletName = 'default';
  private _isUnlocked = false;
  private lockListeners: Set<() => void> = new Set();
  private hiddenTokens: Set<string> = new Set(); // format: `${networkKey}:${address}`
  private showTestnets: boolean = false; // Toggle test networks
  private hideSmallBalances: boolean = false; // Toggle small balances

  // Per-network balance cache: key -> { fetchedAt, height?, portfolio[] }
  private balanceCache: Map<string, { fetchedAt: number; height?: number; portfolio: any[] }> = new Map();

  // Aggregated all-network cache
  private aggregateCache: Map<string, { fetchedAt: number; holdings: any[]; totalsByNetwork: Record<string, number>; grandTotal: number }> = new Map();
  // In-flight dedupe maps
  private inflightBalances: Map<string, Promise<any>> = new Map();
  private inflightAggregate: Map<string, Promise<any>> = new Map();

  /** “Fresh” TTL for cached active-network balances (SWR still allows stale reads). */
  private readonly BALANCES_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
  /** “Fresh” TTL for cached active-network prices/totals (SWR still allows stale reads). */
  private readonly PRICES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  /** “Fresh” TTL for cached aggregated holdings (SWR still allows stale reads). */
  private readonly ALL_NETWORKS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  private mapToSharedToken(token: any): Token {
    return {
      symbol: token.symbol,
      name: token.name,
      type: token.type || 'erc20', // Default to erc20 if missing/undefined
      address: token.address,
      decimals: token.decimals,
      logoURI: token.logoURI || token.icon, // Map icon -> logoURI
      // Preserve other fields if they exist on the source but aren't in the type?
      // For now strict mapping is safer.
    };
  }

  /**
   * Initialize the wallet bridge.
   * Must be called before any other methods.
   *
   * @returns Resolves when storage is initialized and config is loaded.
   * @throws If storage initialization or config loading fails.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize storage
      await mobileStorage.initialize();

      // Load config (bundled or from storage)
      this.config = await this.loadConfig();

      // Load hidden tokens
      const hidden = mobileStorage.readJSON<string[]>('hidden_tokens.json', []);
      this.hiddenTokens = new Set(hidden);

      // We'll lazily import wallet modules to avoid bundling issues
      // For now, mark as initialized - actual wallet creation happens on unlock/create
      this.isInitialized = true;

      console.log('[WalletBridge] Initialized with networks:', Object.keys(this.config.networks));
    } catch (error) {
      console.error('[WalletBridge] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Load configuration from bundled assets or storage.
   */
  private async loadConfig(): Promise<Config> {
    // Try to load from storage first (user overrides like selected network)
    const storedConfig = mobileStorage.readJSON<Partial<Config> & { hideSmallBalances?: boolean; showTestnets?: boolean }>('config.json', {});
    
    if (storedConfig.hideSmallBalances !== undefined) {
      this.hideSmallBalances = storedConfig.hideSmallBalances;
    }
    if (storedConfig.showTestnets !== undefined) {
      this.showTestnets = storedConfig.showTestnets;
    }

    // Load bundled config from parent directory
    // Use require() for Metro/Jest compatibility (avoids Node dynamic import edge cases in tests)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBundledConfig, getCoingeckoApiKey } = require('../config/bundled-config');
    const bundledConfig = getBundledConfig();

    // Configure CoinGecko API key for price provider
    const coingeckoApiKey = getCoingeckoApiKey();
    if (coingeckoApiKey) {
      const { setCoingeckoApiKey } = require('@wallet/price-providers');
      setCoingeckoApiKey(coingeckoApiKey);
    }

    // Merge stored config with bundled (user preferences override defaults)
    return {
      ...bundledConfig,
      network: storedConfig.network || bundledConfig.network || 'sepolia',
    };
  }

  /**
   * Get current wallet state.
   *
   * @returns Current session state including `hasWallet` and derived `address` (if unlocked).
   */
  async getState(): Promise<WalletState> {
    await this.ensureInitialized();

    const wallets = mobileStorage.readJSON<Record<string, any>>('wallets.json', {});
    const hasWallet = Object.keys(wallets).length > 0;

    return {
      isUnlocked: this._isUnlocked,
      hasWallet,
      network: this.config?.network || 'sepolia',
      address: this._isUnlocked && this.service ? this.service.getAddress() : null,
      currentWalletName: this._isUnlocked ? this.currentWalletName : null,
    };
  }

  /**
   * Get the address for a specific network without switching the active network.
   */
  getAddressForNetwork(networkKey: string): string | null {
    if (!this._isUnlocked || !this.wallet || !this.config) {
      return null;
    }

    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) return null;

    const accountIndex = this.wallet.getCurrentAccountIndex();

    try {
      switch (networkConfig.type) {
        case 'bitcoin': {
          const bitcoinNetwork =
            networkConfig.bitcoinNetwork ||
            (networkConfig.isTestnet || networkKey.includes('test') ? 'testnet' : 'mainnet');
          return this.wallet.getBitcoinAddress(bitcoinNetwork, accountIndex).address;
        }
        case 'solana':
          return this.wallet.getSolanaAddress(accountIndex).address;
        case 'xrp':
          return this.wallet.getXRPAddress(accountIndex).address;
        case 'ton':
          return this.wallet.getTonAddress(accountIndex).address;
        case 'evm':
        default:
          return this.wallet.getAccountAddress(accountIndex);
      }
    } catch (error) {
      console.warn('[WalletBridge] Failed to derive address for network:', networkKey, error);
      return null;
    }
  }

  /**
   * Check if session is active and return session password for adding wallets.
   * Returns null if not unlocked.
   *
   * @security Session password is kept in memory only; do not persist this value.
   */
  getSessionPassword(): string | null {
    return this._isUnlocked ? this.sessionPassword : null;
  }

  /**
   * Create a new wallet.
   *
   * @param password - Master password used to encrypt the wallet mnemonic.
   * @param name - Wallet name to save under (`wallets.json` key).
   * @param showMnemonic - If true, returns the mnemonic in the result for display once.
   * @returns Wallet address for the active network and (optionally) mnemonic.
   * @throws If the wallet name is invalid or SDK initialization fails.
   */
  async createWallet(
    password: string,
    name: string = 'default',
    showMnemonic: boolean = true
  ): Promise<CreateWalletResult> {
    await this.ensureInitialized();

    if (!this.validateWalletName(name)) {
      throw new Error('Wallet name must be 1-12 characters and contain only letters and numbers');
    }

    // Import wallet modules dynamically
    const { Wallet, WalletAppService, setCryptoAdapter } = await this.importWalletModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBundledTokens } = require('../config/bundled-config');

    // Set up crypto adapter
    setCryptoAdapter(mobileCrypto);

    // Create wallet instance
    this.wallet = new Wallet(this.config!, mobileStorage);
    const result = this.wallet.createNewWallet(password);

    // Create service with bundled tokens
    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
      builtInTokens: getBundledTokens(),
    });
    await this.service.initialize();

    // Save wallet
    this.service.saveWallet(name);

    // Update state
    this.sessionPassword = password;
    this.currentWalletName = name;
    this._isUnlocked = true;
    this.resetAutoLockTimer();

    const address = this.service.getAddress();

    return {
      success: true,
      address,
      mnemonic: showMnemonic ? result.mnemonic : undefined,
    };
  }

  /**
   * Import an existing wallet from mnemonic.
   *
   * @param mnemonic - BIP39 mnemonic phrase to import.
   * @param password - Master password used to encrypt the imported mnemonic.
   * @param name - Wallet name to save under (`wallets.json` key).
   * @returns Imported wallet address for the active network.
   * @throws If mnemonic is invalid, wallet name invalid, or load fails.
   */
  async importWallet(
    mnemonic: string,
    password: string,
    name: string = 'default'
  ): Promise<ImportWalletResult> {
    await this.ensureInitialized();

    if (!this.validateWalletName(name)) {
      throw new Error('Wallet name must be 1-12 characters and contain only letters and numbers');
    }

    const { Wallet, WalletAppService, setCryptoAdapter } = await this.importWalletModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBundledTokens } = require('../config/bundled-config');

    setCryptoAdapter(mobileCrypto);

    this.wallet = new Wallet(this.config!, mobileStorage);
    const result = this.wallet.importWallet(mnemonic, password);

    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
      builtInTokens: getBundledTokens(),
    });
    await this.service.initialize();

    this.service.saveWallet(name);

    this.sessionPassword = password;
    this.currentWalletName = name;
    this._isUnlocked = true;
    this.resetAutoLockTimer();

    const address = this.service.getAddress();

    return {
      success: true,
      address,
    };
  }

  /**
   * Unlock an existing wallet.
   *
   * Uses react-native-quick-crypto for fast native PBKDF2 key derivation.
   *
   * @param password - Master password for decrypting the stored mnemonic.
   * @param name - Wallet name to unlock (defaults to `default`).
   * @returns Unlocked wallet address for the active network and wallet name.
   * @throws If password is invalid or wallet is not found.
   */
  async unlockWallet(password: string, name: string = 'default'): Promise<UnlockWalletResult> {
    await this.ensureInitialized();

    const { Wallet, WalletAppService, setCryptoAdapter } = await this.importWalletModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBundledTokens } = require('../config/bundled-config');

    setCryptoAdapter(mobileCrypto);

    this.wallet = new Wallet(this.config!, mobileStorage);
    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
      builtInTokens: getBundledTokens(),
    });

    // Use async loadWallet for native-speed PBKDF2 via react-native-quick-crypto
    const loaded = await this.service.loadWalletAsync(name, password);
    if (!loaded) {
      throw new Error('Invalid password or wallet not found');
    }

    await this.service.initialize();

    this.sessionPassword = password;
    this.currentWalletName = name;
    this._isUnlocked = true;
    this.resetAutoLockTimer();

    const address = this.service.getAddress();

    return {
      success: true,
      address,
      walletName: name,
    };
  }

  /**
   * Lock the wallet.
   *
   * Clears all in-memory session state. Does not delete persisted wallet data.
   *
   * @security This clears `sessionPassword` and releases SDK instances to reduce
   * risk of secret material lingering in memory.
   */
  async lockWallet(): Promise<void> {
    this._isUnlocked = false;
    this.sessionPassword = null;
    this.service = null;
    this.wallet = null;

    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }

    this.lockListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('[WalletBridge] Lock listener failed:', error);
      }
    });
  }

  /**
   * Clear all storage and reset to fresh state (for debugging).
   *
   * @security This irreversibly deletes wallet data stored on-device.
   */
  async clearAllData(): Promise<void> {
    console.log('[WalletBridge] Clearing all data...');
    await this.lockWallet();
    await mobileStorage.clear();
    this.config = null;
    this.isInitialized = false;
    console.log('[WalletBridge] All data cleared');
  }

  /**
   * Get tokens for the current network.
   *
   * @returns Token list with placeholder balances; call `refreshBalances()` to populate.
   */
  async getTokens(): Promise<TokenBalance[]> {
    this.requireUnlocked();

    const networkKey = this.config!.network;
    const tokens = this.service.getTokensForNetwork(networkKey);
    
    return tokens.map((t: any) => {
      const token = this.mapToSharedToken(t);
      const address = token.address?.toLowerCase();
      const key = address && token.type !== 'native' ? `${networkKey}:${address}` : null;
      const isHidden = key ? this.hiddenTokens.has(key) : false;

      return {
        token,
        balance: null, // Will be populated by balance refresh
        lastUpdated: null,
        isLoading: true,
        isVisible: !isHidden,
      };
    });
  }

  /**
   * Read cached balances for a given network context (stale allowed).
   *
   * @param networkKey - Network key to read for (defaults to current network).
   * @returns Cached balances + timestamp, or null if missing/incompatible.
   */
  getCachedBalances(networkKey: string = this.config?.network || 'sepolia'): { balances: TokenBalance[]; fetchedAt: number } | null {
    this.requireUnlocked();
    const cacheKey = this.makeBalanceCacheKey(networkKey);
    const env = cacheService.getStale<{ balances: TokenBalance[] }>('balances', cacheKey);
    if (!env) return null;
    return { balances: env.value.balances, fetchedAt: env.cachedAt };
  }

  /**
   * Read cached prices/totals for a given network context (stale allowed).
   *
   * @param networkKey - Network key to read for (defaults to current network).
   * @returns Cached price result + timestamp, or null if missing/incompatible.
   */
  getCachedPrices(
    networkKey: string = this.config?.network || 'sepolia'
  ): { prices: Record<string, number | null>; totalValue: number; formattedTotal: string; pricedAt: number } | null {
    this.requireUnlocked();
    const cacheKey = this.makeBalanceCacheKey(networkKey);
    const env = cacheService.getStale<{
      prices: Record<string, number | null>;
      totalValue: number;
      formattedTotal: string;
    }>('prices', cacheKey);
    if (!env) return null;
    return { ...env.value, pricedAt: env.cachedAt };
  }

  /**
   * Read cached aggregated holdings for a set of enabled networks (stale allowed).
   *
   * @param enabledNetworks - Network keys included in the aggregate (order-insensitive).
   * @returns Cached aggregate result + timestamp, or null if missing/incompatible.
   */
  getCachedAllNetworkHoldings(options?: {
    enabledNetworks?: string[];
  }): { holdings: any[]; totalsByNetwork: Record<string, number>; grandTotal: number; fetchedAt: number } | null {
    this.requireUnlocked();
    const enabledNetworks = (options?.enabledNetworks && options.enabledNetworks.length
      ? options.enabledNetworks
      : Object.keys(this.config!.networks)).slice().sort();

    const aggregateKey = this.makeAggregateCacheKey(enabledNetworks);
    const env = cacheService.getStale<{
      holdings: any[];
      totalsByNetwork: Record<string, number>;
      grandTotal: number;
    }>('allNetworks', aggregateKey);
    if (!env) return null;
    return { ...env.value, fetchedAt: env.cachedAt };
  }

  /**
   * Refresh balances for the current network.
   *
   * @returns Token balances for the active network.
   * @throws If portfolio fetch fails.
   */
  async refreshBalances(options?: { force?: boolean }): Promise<TokenBalance[]> {
    this.requireUnlocked();
    const force = options?.force ?? true;

    const networkKey = this.config!.network;
    console.log('[WalletBridge] refreshBalances() - network:', networkKey, 'force:', force);

    try {
      const { fetchedAt, portfolio } = await this.getNetworkPortfolioWithCache(networkKey, {
        ttlMs: this.BALANCES_CACHE_TTL_MS,
        force,
      });

      const balances: TokenBalance[] = portfolio.map((item: any) => {
        const token = this.mapToSharedToken(item.token);
        const address = token.address?.toLowerCase();
        const key = address && token.type !== 'native' ? `${networkKey}:${address}` : null;
        const isHidden = key ? this.hiddenTokens.has(key) : false;
        
        // Ensure balance is always a string (API may return number for some networks)
        const rawBalance = item.balance;
        const balance = rawBalance == null ? '0' : typeof rawBalance === 'string' ? rawBalance : String(rawBalance);
        
        return {
          token,
          balance,
          lastUpdated: fetchedAt,
          isLoading: false,
          isVisible: !isHidden,
        };
      });

      // Update cache only if we actually fetched (or just re-save to keep consistent)
      // Actually getNetworkPortfolioWithCache handles the cache saving if it fetched.
      // We don't need to double-set it here unless we processed it.
      // But we are returning TokenBalance[] which is derived.
      // CacheService 'balances' stores TokenBalance[] (derived).
      // balanceCache stores raw portfolio.
      
      // We should update the 'balances' cache (derived UI state) because visibility changed!
      cacheService.set('balances', this.makeBalanceCacheKey(networkKey), { balances }, this.BALANCES_CACHE_TTL_MS);
      return balances;
    } catch (error) {
      console.error('[WalletBridge] refreshBalances() - error:', error);
      throw error;
    }
  }

  /**
   * Get token prices with rate limiting protection.
   *
   * @param balancesOverride - Optional balances snapshot to price (prevents re-fetching balances).
   * @returns Prices keyed by token symbol and derived total portfolio value.
   */
  async getTokenPrices(balancesOverride?: TokenBalance[]): Promise<{
    prices: Record<string, number | null>;
    totalValue: number;
    formattedTotal: string;
  }> {
    this.requireUnlocked();

    const network = this.config!.network;
    const networkConfig = this.config!.networks[network];
    const { getTokenPrices, calculateTotalValue, getPriceByNetworkType } =
      await import('./price-service');

    const cacheKey = this.makeBalanceCacheKey(network);
    const cached = cacheService.get<{
      prices: Record<string, number | null>;
      totalValue: number;
      formattedTotal: string;
    }>('prices', cacheKey);
    if (cached) return cached.value;

    // Prefer caller-provided balances. If missing, fall back to stale cached balances, then fetch.
    const cachedBalances = this.getCachedBalances(network);
    const balancesSnapshot =
      balancesOverride ||
      (cachedBalances?.balances?.length ? cachedBalances.balances : undefined) ||
      (await this.refreshBalances({ force: false })); // Use soft refresh if needed

    const nonZeroBalances = balancesSnapshot.filter((b) => {
      const val = parseFloat(b.balance || '0');
      return Number.isFinite(val) && val > 0;
    });

    const tokensForPricing = nonZeroBalances.map((b) => ({
      type: (b.token.type === 'native' ? 'native' : 'erc20') as 'native' | 'erc20',
      symbol: b.token.symbol,
      address: b.token.address,
      decimals: b.token.decimals,
    }));

    const priceMap = new Map<string, number | null>();

    if (networkConfig?.chainId) {
      // EVM: fetch both native + ERC-20 prices in one call (CoinGecko-cached in shared price-service).
      const map = await getTokenPrices(networkConfig.chainId, tokensForPricing);
      for (const [k, v] of map.entries()) priceMap.set(k, v);
    } else {
      // Non-EVM networks: use unified price fetcher
      const price = await getPriceByNetworkType(networkConfig?.type, network);
      priceMap.set('native', price);
    }

    const prices: Record<string, number | null> = {};
    for (const b of nonZeroBalances) {
      const key = b.token.type === 'native' ? 'native' : b.token.address?.toLowerCase();
      prices[b.token.symbol] = key ? priceMap.get(key) ?? null : null;
    }

    const totalValue = calculateTotalValue(
      nonZeroBalances.map((b) => ({
        token: {
          type: (b.token.type === 'native' ? 'native' : 'erc20') as 'native' | 'erc20',
          symbol: b.token.symbol,
          address: b.token.address,
          decimals: b.token.decimals,
        },
        balance: b.balance || '0',
      })),
      priceMap
    );

    const result = {
      prices,
      totalValue,
      formattedTotal: `$${totalValue.toFixed(2)}`,
    };

    cacheService.set('prices', cacheKey, result, this.PRICES_CACHE_TTL_MS);
    return result;
  }

  /**
   * Get gas estimate for a transaction.
   *
   * @param token - Token being sent.
   * @param toAddress - Recipient address.
   * @param amount - Amount in display units (token decimals handled by SDK).
   * @returns Gas estimate result for display.
   */
  async getGasEstimate(
    token: Token,
    toAddress: string,
    amount: string
  ): Promise<GasEstimate> {
    this.requireUnlocked();

    return await this.service.getGasEstimate(token as any, toAddress, amount);
  }

  /**
   * Send a transaction.
   *
   * Routes to the appropriate chain-specific send method in the shared SDK.
   *
   * @param token - Token to send (native or ERC-20 on EVM).
   * @param toAddress - Recipient address.
   * @param amount - Amount in display units.
   * @param destinationTag - XRP destination tag (optional; XRP-only).
   * @param comment - TON comment payload (optional; TON-only).
   * @returns Transaction hash/signature.
   * @throws If wallet is locked or SDK send fails.
   */
  async sendTransaction(
    token: Token,
    toAddress: string,
    amount: string,
    destinationTag?: number,
    comment?: string
  ): Promise<SendTransactionResult> {
    this.requireUnlocked();
    this.resetAutoLockTimer();

    const networkConfig = this.config!.networks[this.config!.network];

    if (networkConfig.type === 'bitcoin') {
      const result = await this.service.sendBitcoinTransaction(
        toAddress,
        amount,
        this.sessionPassword!
      );
      return { hash: result.hash, status: 'pending' };
    }

    if (networkConfig.type === 'solana') {
      const result = await this.service.sendSolanaTransaction(
        toAddress,
        amount,
        this.sessionPassword!
      );
      return { hash: result.signature, status: 'pending' };
    }

    if (networkConfig.type === 'xrp') {
      const result = await this.service.sendXRPTransaction(
        toAddress,
        amount,
        this.sessionPassword!,
        destinationTag
      );
      return { hash: result.hash, status: 'pending' };
    }

    if (networkConfig.type === 'ton') {
      const result = await this.service.sendTonTransaction(
        toAddress,
        amount,
        this.sessionPassword!,
        comment
      );
      return { hash: result.hash, status: 'pending' };
    }

    // EVM transaction
    const result = await this.service.sendToken(token as any, toAddress, amount);
    return {
      hash: result.hash,
      status: 'confirmed',
      blockNumber: result.blockNumber,
    };
  }

  /**
   * Add a custom token to the current network.
   *
   * @param token - Token definition to add.
   */
  async addCustomToken(token: Token): Promise<void> {
    this.requireUnlocked();
    // Ensure address is lowercase for consistency
    const normalizedToken = {
      ...token,
      address: token.address?.toLowerCase()
    };
    await this.service.addCustomToken(this.config!.network, normalizedToken as any);
  }

  /**
   * Toggle token visibility.
   * 
   * @param tokenAddress - Address of token to toggle.
   * @param isVisible - Desired visibility state.
   */
  async toggleTokenVisibility(tokenAddress: string, isVisible: boolean): Promise<void> {
    this.requireUnlocked();
    
    const networkKey = this.config!.network;
    // Format: network:address (address lowercased for consistency)
    const key = `${networkKey}:${tokenAddress.toLowerCase()}`;

    if (isVisible) {
      this.hiddenTokens.delete(key);
    } else {
      this.hiddenTokens.add(key);
    }

    // Persist changes
    mobileStorage.writeJSON('hidden_tokens.json', Array.from(this.hiddenTokens));
    
    // Do NOT invalidate raw balance cache - we just want to re-map visibility.
    // Calling refreshBalances({ force: false }) will re-use raw cache and re-apply hidden logic.
  }

  /**
   * Set 'Show Testnets' preference.
   */
  async setShowTestnets(enabled: boolean): Promise<void> {
    this.showTestnets = enabled;
    const currentConfig = mobileStorage.readJSON<any>('config.json', {});
    mobileStorage.writeJSON('config.json', { ...currentConfig, showTestnets: enabled });
  }

  /**
   * Get 'Show Testnets' preference.
   */
  getShowTestnets(): boolean {
    return this.showTestnets;
  }

  /**
   * Get transaction history for the current network and address.
   * Routes to the appropriate explorer API based on network type.
   * 
   * @param limit - Maximum number of transactions to return (default: 25)
   * @returns Array of normalized transactions
   *
   * @remarks
   * - Returns an empty array on fetch errors (errors are logged).
   * - Normalization is performed here so the UI consumes a single `Transaction` shape.
   */
  async getTransactions(limit: number = 25): Promise<Transaction[]> {
    this.requireUnlocked();

    const network = this.config!.network;
    const networkConfig = this.config!.networks[network];
    const address = this.service.getAddress();

    if (!address) {
      return [];
    }

    try {
      // Route based on network type
      if (networkConfig.type === 'bitcoin') {
        return await this.getBitcoinTransactions(address, network, limit);
      }

      if (networkConfig.type === 'solana') {
        return await this.getSolanaTransactions(address, network, limit);
      }

      if (networkConfig.type === 'xrp') {
        return await this.getXRPTransactions(address, network, limit);
      }

      if (networkConfig.type === 'ton') {
        return await this.getTonTransactions(address, network, limit);
      }

      // Default: EVM networks
      return await this.getEVMTransactions(address, network, limit);
    } catch (error) {
      console.error('[WalletBridge] Failed to fetch transactions:', error);
      return [];
    }
  }

  /**
   * Get Bitcoin transaction history.
   */
  private async getBitcoinTransactions(
    address: string,
    network: string,
    limit: number
  ): Promise<Transaction[]> {
    const networkConfig = this.config!.networks[network];
    const nativeSymbol = networkConfig.nativeSymbol || 'BTC';

    const txs = await this.service.getBitcoinTransactionHistory(limit);
    
    return txs.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || null,
      // Convert satoshis to BTC string for display
      value: tx.valueBtc || String(Number(tx.value) / 100000000),
      network,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      type: tx.type as 'send' | 'receive' | 'contract_interaction',
      timestamp: tx.timestamp,
      blockNumber: tx.blockNumber,
      tokenSymbol: nativeSymbol,
      fee: tx.feeBtc || (tx.fee ? String(Number(tx.fee) / 100000000) : undefined),
    }));
  }

  /**
   * Get Solana transaction history.
   */
  private async getSolanaTransactions(
    address: string,
    network: string,
    limit: number
  ): Promise<Transaction[]> {
    const networkConfig = this.config!.networks[network];
    const nativeSymbol = networkConfig.nativeSymbol || 'SOL';

    const txs = await this.service.getSolanaTransactionHistory(limit);
    
    return txs.map((tx: any) => ({
      hash: tx.signature,
      from: tx.from,
      to: tx.to || null,
      value: tx.valueSol,
      network,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      type: tx.type as 'send' | 'receive' | 'contract_interaction',
      timestamp: tx.timestamp,
      blockNumber: tx.slot,
      tokenSymbol: nativeSymbol,
      fee: tx.feeSol,
    }));
  }

  /**
   * Get XRP transaction history.
   */
  private async getXRPTransactions(
    address: string,
    network: string,
    limit: number
  ): Promise<Transaction[]> {
    const networkConfig = this.config!.networks[network];
    const nativeSymbol = networkConfig.nativeSymbol || 'XRP';

    const txs = await this.service.getXRPTransactionHistory(limit);

    return txs.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || null,
      value: tx.valueXrp,
      network,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      type: tx.type === 'other' ? 'contract_interaction' : tx.type,
      timestamp: tx.timestamp,
      tokenSymbol: nativeSymbol,
      fee: tx.feeXrp,
    }));
  }

  /**
   * Get TON transaction history.
   */
  private async getTonTransactions(
    address: string,
    network: string,
    limit: number
  ): Promise<Transaction[]> {
    const networkConfig = this.config!.networks[network];
    const nativeSymbol = networkConfig.nativeSymbol || 'TON';

    const txs = await this.service.getTonTransactionHistory(limit);

    return txs.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || null,
      value: tx.valueTon,
      network,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      type: tx.type === 'other' ? 'contract_interaction' : tx.type,
      timestamp: tx.timestamp,
      tokenSymbol: nativeSymbol,
      fee: tx.feeTon,
    }));
  }

  /**
   * Get EVM transaction history via explorer API.
   */
  private async getEVMTransactions(
    address: string,
    network: string,
    limit: number
  ): Promise<Transaction[]> {
    const networkConfig = this.config!.networks[network];
    const nativeSymbol = networkConfig.nativeSymbol || 'ETH';

    // Import explorer API
    const { explorerAPI } = require('@wallet/explorer-api');

    // Check if network is supported
    if (!explorerAPI.isSupported(network)) {
      // Register the network if it has explorer config
      if (networkConfig.explorerApiUrl && networkConfig.chainId) {
        explorerAPI.registerNetwork(
          network,
          networkConfig.explorerApiUrl,
          networkConfig.chainId,
          networkConfig.explorerApiKey
        );
      } else {
        console.warn(`[WalletBridge] Network ${network} not supported for transaction history`);
        return [];
      }
    }

    const txs = await explorerAPI.getAllTransactions(address, network, 1, limit);
    
    return txs.map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || null,
      // EVM explorer returns value in wei - convert to ETH for display
      value: this.formatWeiToEth(tx.value),
      network,
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      type: tx.type as 'send' | 'receive' | 'contract_interaction',
      timestamp: tx.timestamp,
      blockNumber: tx.blockNumber,
      tokenSymbol: tx.tokenSymbol || nativeSymbol,
      fee: tx.gasUsed && tx.gasPrice 
        ? this.formatWeiToEth(String(BigInt(tx.gasUsed) * BigInt(tx.gasPrice)))
        : undefined,
    }));
  }

  /**
   * Convert wei string to ETH string for display.
   */
  private formatWeiToEth(weiValue: string): string {
    try {
      const wei = BigInt(weiValue);
      const eth = Number(wei) / 1e18;
      return eth.toString();
    } catch {
      return weiValue;
    }
  }

  /**
   * Switch network.
   * @returns The address for the new network
   *
   * @param networkKey - Key from `config.networks` (e.g., 'sepolia', 'bitcoin-mainnet').
   * @throws If network key is unknown or wallet is locked.
   */
  async switchNetwork(networkKey: string): Promise<{ address: string }> {
    this.requireUnlocked();

    if (!this.config!.networks[networkKey]) {
      throw new Error('Network not found');
    }

    await this.service.setNetwork(networkKey);
    this.config!.network = networkKey;

    // Persist network preference
    mobileStorage.writeJSON('config.json', { network: networkKey });

    // Return the address for the new network
    const address = this.service.getAddress();
    return { address };
  }

  /**
   * Get available networks.
   *
   * @returns Map of network key → network configuration.
   */
  async getNetworks(): Promise<Record<string, NetworkConfig>> {
    await this.ensureInitialized();
    return this.config!.networks;
  }

  /**
   * Get all wallets.
   *
   * @returns Raw `wallets.json` contents (wallet metadata + accounts).
   */
  async getAllWallets(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    return mobileStorage.readJSON('wallets.json', {});
  }

  /**
   * Get holdings across enabled networks with caching, dedupe, and bounded concurrency.
   */
  async getAllNetworkHoldings(options?: {
    includeZero?: boolean;
    networkConcurrency?: number;
    ttlMs?: number;
    force?: boolean;
    enabledNetworks?: string[];
  }): Promise<{ holdings: any[]; totalsByNetwork: Record<string, number>; grandTotal: number; fetchedAt: number }> {
    this.requireUnlocked();
    const includeZero = options?.includeZero ?? false;
    const networkConcurrency = options?.networkConcurrency ?? 2;
    const ttlMs = options?.ttlMs ?? 30_000;
    const force = options?.force ?? false;

    const enabledNetworks = options?.enabledNetworks && options.enabledNetworks.length
      ? options.enabledNetworks
      : Object.keys(this.config!.networks);

    const now = Date.now();
    const aggregateKey = this.makeAggregateCacheKey(enabledNetworks.slice().sort());

    // Persistent cache (survives restarts)
    const persistent = cacheService.getStale<{
      holdings: any[];
      totalsByNetwork: Record<string, number>;
      grandTotal: number;
    }>('allNetworks', aggregateKey);
    if (!force && persistent && now - persistent.cachedAt < ttlMs) {
      const result = { ...persistent.value, fetchedAt: persistent.cachedAt };
      // Keep in-memory cache warm for follow-up reads within this session.
      this.aggregateCache.set(aggregateKey, result);
      return result;
    }

    // In-memory cache (session-only)
    const cachedAggregate = this.aggregateCache.get(aggregateKey);
    if (!force && cachedAggregate && now - cachedAggregate.fetchedAt < ttlMs) {
      return { ...cachedAggregate };
    }

    if (this.inflightAggregate.has(aggregateKey)) {
      return this.inflightAggregate.get(aggregateKey)!;
    }

    const runner = (async () => {
      const queue = [...enabledNetworks];
      const holdings: any[] = [];
      const errors: Record<string, string> = {};

      const workers: Array<Promise<void>> = [];
      for (let i = 0; i < networkConcurrency; i++) {
        workers.push((async () => {
          while (queue.length) {
            const networkKey = queue.shift();
            if (!networkKey) break;
            try {
              const perNetwork = await this.getNetworkPortfolioWithCache(networkKey, { ttlMs, force });
              holdings.push(...perNetwork.portfolio.map((item: any) => {
                // Ensure balance is always a string
                const rawBalance = item.balance;
                const balance = rawBalance == null ? '0' : typeof rawBalance === 'string' ? rawBalance : String(rawBalance);
                return {
                  ...item,
                  balance,
                  token: this.mapToSharedToken(item.token),
                  networkKey,
                  height: perNetwork.height ?? null,
                  fetchedAt: perNetwork.fetchedAt
                };
              }));
            } catch (err: any) {
              errors[networkKey] = err?.message || 'Failed to fetch';
            }
          }
        })());
      }
      await Promise.all(workers);

      const filtered = includeZero ? holdings : holdings.filter(h => {
        const val = parseFloat(h.balance || '0');
        // Filter hidden tokens
        const address = h.token.address?.toLowerCase();
        if (address && h.token.type !== 'native') {
          const key = `${h.networkKey}:${address}`;
          if (this.hiddenTokens.has(key)) return false;
        }
        return Number.isFinite(val) && val > 0 && h.balance !== 'Error';
      });

      // Totals by network (USD) using price-service
      const totalsByNetwork: Record<string, number> = {};
      const enrichedHoldings: any[] = [];
      const { getTokenPrices, getPriceByNetworkType } =
        await import('./price-service');

      for (const networkKey of enabledNetworks) {
        const netConfig = this.config!.networks[networkKey];
        const assets = filtered.filter(h => h.networkKey === networkKey);
        
        if (!assets.length) {
          totalsByNetwork[networkKey] = 0;
          continue;
        }

        let priceMap = new Map<string, number | null>();

        // Non-EVM networks: use unified price fetcher
        if (netConfig.type && ['bitcoin', 'solana', 'xrp', 'ton'].includes(netConfig.type)) {
          const price = await getPriceByNetworkType(netConfig.type, networkKey);
          priceMap.set('native', price);
        } else if (netConfig.chainId) {
          // EVM: batch prices per chain
          const tokenInfos = assets.map(a => ({
            type: (a.token.type === 'native' ? 'native' : 'erc20') as 'native' | 'erc20',
            symbol: a.token.symbol,
            address: a.token.address,
            decimals: a.token.decimals
          }));
          priceMap = await getTokenPrices(netConfig.chainId, tokenInfos.map(t => t));
        }

        let networkTotal = 0;
        
        for (const asset of assets) {
          const isNative = asset.token.type === 'native' || !asset.token.address || asset.token.address === 'native';
          // Price map keys: 'native' for native tokens, lowercase address for ERC-20
          const key = isNative ? 'native' : asset.token.address?.toLowerCase() || '';
          const price = priceMap.get(key) || 0;
          const balance = parseFloat(asset.balance || '0');
          const value = Number.isFinite(balance) ? balance * price : 0;
          
          networkTotal += value;
          
          enrichedHoldings.push({
            ...asset,
            price,
            value
          });
        }
        
        totalsByNetwork[networkKey] = networkTotal;
      }

      const grandTotal = Object.values(totalsByNetwork).reduce((a, b) => a + b, 0);
      const aggregate = { holdings: enrichedHoldings, totalsByNetwork, grandTotal, fetchedAt: Date.now() };
      this.aggregateCache.set(aggregateKey, aggregate);
      cacheService.set(
        'allNetworks',
        aggregateKey,
        { holdings: aggregate.holdings, totalsByNetwork: aggregate.totalsByNetwork, grandTotal: aggregate.grandTotal },
        this.ALL_NETWORKS_CACHE_TTL_MS
      );
      this.inflightAggregate.delete(aggregateKey);
      return aggregate;
    })();

    this.inflightAggregate.set(aggregateKey, runner);
    return runner;
  }

  /**
   * Per-network portfolio with cache + in-flight dedupe.
   */
  private async getNetworkPortfolioWithCache(networkKey: string, opts: { ttlMs: number; force: boolean }): Promise<{ fetchedAt: number; height?: number; portfolio: any[] }> {
    const cacheKey = this.makeBalanceCacheKey(networkKey);
    const now = Date.now();

    // 1. Check in-memory cache
    const memoryCached = this.balanceCache.get(cacheKey);
    if (!opts.force && memoryCached && now - memoryCached.fetchedAt < opts.ttlMs) {
      return memoryCached;
    }

    // 2. Check persistent cache (if allowed)
    if (!opts.force) {
      const persistent = cacheService.getStale<{ balances: TokenBalance[] }>('balances', cacheKey);
      if (persistent && now - persistent.cachedAt < opts.ttlMs) {
        // Convert TokenBalance[] back to raw portfolio format if needed, or just use it
        // Note: The raw portfolio format from service has 'token' and 'balance'.
        // TokenBalance has 'token', 'balance', 'lastUpdated', 'isLoading', 'isVisible'.
        // We can map it back.
        const portfolio = persistent.value.balances.map(b => ({
          token: b.token,
          balance: b.balance
        }));
        const result = { fetchedAt: persistent.cachedAt, height: undefined, portfolio };
        this.balanceCache.set(cacheKey, result);
        return result;
      }
    }

    if (this.inflightBalances.has(cacheKey)) {
      return this.inflightBalances.get(cacheKey)!;
    }

    const run = (async () => {
      const maxRetries = 2;
      let lastErr: any;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const portfolio = await this.service.getPortfolioForNetwork(networkKey);
          const result = { fetchedAt: Date.now(), height: undefined, portfolio };
          this.balanceCache.set(cacheKey, result);
          this.inflightBalances.delete(cacheKey);
          return result;
        } catch (err) {
          lastErr = err;
          if (attempt === maxRetries) break;
          const jitter = 300 + Math.floor(Math.random() * 500);
          await new Promise(res => setTimeout(res, jitter));
        }
      }
      this.inflightBalances.delete(cacheKey);
      throw lastErr;
    })();

    this.inflightBalances.set(cacheKey, run);
    return run;
  }

  /**
   * Get accounts for current wallet.
   *
   * @returns Current wallet accounts and the persisted selected account index.
   */
  async getAccounts(): Promise<{ accounts: Record<number, any>; currentIndex: number }> {
    this.requireUnlocked();

    const wallets = mobileStorage.readJSON<Record<string, any>>('wallets.json', {});
    const currentWallet = wallets[this.currentWalletName];

    return {
      accounts: currentWallet?.accounts || {},
      currentIndex: currentWallet?.currentAccountIndex || 0,
    };
  }

  /**
   * Create new account in current wallet.
   * Accounts are HD derivation paths (m/44'/60'/0'/0/index).
   *
   * @returns The new account address and its index.
   */
  async createAccount(): Promise<{ address: string; accountIndex: number }> {
    this.requireUnlocked();

    // Get current accounts to find the next available index
    const wallets = mobileStorage.readJSON<Record<string, any>>('wallets.json', {});
    const currentWallet = wallets[this.currentWalletName];
    const existingAccounts = currentWallet?.accounts || {};
    
    // Find the next account index
    const existingIndices = Object.keys(existingAccounts).map(k => parseInt(k));
    const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 1;

    // Switch to the new account (this creates it)
    const result = this.service.switchAccount(nextIndex);
    
    // Save the wallet to persist the new account
    this.service.saveWallet(this.currentWalletName);

    const address = this.service.getAddress();

    return {
      address,
      accountIndex: result.accountIndex,
    };
  }

  /**
   * Switch to a different account.
   *
   * Persists the selected account index in `wallets.json` by saving the wallet.
   *
   * @param index - HD account index to select.
   * @returns The address for the selected account (network-specific).
   */
  async switchAccount(index: number): Promise<{ address: string }> {
    this.requireUnlocked();

    this.service.switchAccount(index);
    
    // Persist the current account selection
    this.service.saveWallet(this.currentWalletName);
    
    return { address: this.service.getAddress() };
  }

  /**
   * Change the master password for the current wallet.
   *
   * @param currentPassword - Current master password
   * @param newPassword - New master password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.requireUnlocked();

    if (currentPassword !== this.sessionPassword) {
      throw new Error('Invalid password');
    }

    this.service.changePassword(this.currentWalletName, currentPassword, newPassword);
    this.sessionPassword = newPassword;
    this.resetAutoLockTimer();
  }

  /**
   * Get secret recovery phrase (requires password confirmation).
   *
   * @param password - Must match the current in-memory session password.
   * @returns Mnemonic phrase for the current wallet.
   * @throws If wallet locked or password does not match session.
   *
   * @security Never persist or log the returned mnemonic.
   */
  async getSecretPhrase(password: string): Promise<string> {
    this.requireUnlocked();

    if (password !== this.sessionPassword) {
      throw new Error('Invalid password');
    }

    return this.wallet.mnemonic;
  }

  /**
   * Get private key for current account (requires password confirmation).
   *
   * @param password - Must match the current in-memory session password.
   * @returns Private key for the current account.
   * @throws If wallet locked or password does not match session.
   *
   * @security Never persist or log the returned private key.
   */
  async getPrivateKey(password: string): Promise<string> {
    this.requireUnlocked();

    if (password !== this.sessionPassword) {
      throw new Error('Invalid password');
    }

    return this.wallet.wallet.privateKey;
  }

  /**
   * Set auto-lock timeout.
   *
   * @param minutes - Minutes of inactivity before lock.
   */
  setAutoLockTimeout(minutes: number): void {
    this.autoLockTimeoutMs = minutes * 60 * 1000;
    this.resetAutoLockTimer();
  }

  /**
   * Subscribe to lock events (manual or auto-lock).
   *
   * @returns Unsubscribe function.
   */
  onLock(listener: () => void): () => void {
    this.lockListeners.add(listener);
    return () => {
      this.lockListeners.delete(listener);
    };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private requireUnlocked(): void {
    if (!this._isUnlocked || !this.service) {
      throw new Error('Wallet is locked');
    }
    this.resetAutoLockTimer();
  }

  /**
   * Compute a simple tokens revision string for cache invalidation.
   */
  private getTokensRevision(networkKey: string): string {
    try {
      const tokens = this.service?.getTokensForNetwork(networkKey) || [];
      return JSON.stringify(tokens.map((t: any) => `${t.symbol}:${t.address || 'native'}`));
    } catch {
      return 'default';
    }
  }

  private makeBalanceCacheKey(networkKey: string): string {
    const walletName = this.currentWalletName || 'default';
    const accountIndex = this.service?.getCurrentAccountIndex ? this.service.getCurrentAccountIndex() : 0;
    const tokensRevision = this.getTokensRevision(networkKey);
    return `${walletName}|${accountIndex}|${networkKey}|${tokensRevision}`;
  }

  private makeAggregateCacheKey(networks: string[]): string {
    const walletName = this.currentWalletName || 'default';
    const accountIndex = this.service?.getCurrentAccountIndex ? this.service.getCurrentAccountIndex() : 0;
    const tokensRevisionAll = networks.map(n => `${n}:${this.getTokensRevision(n)}`).join('|');
    const enabledHash = networks.join(',');
    return `${walletName}|${accountIndex}|${enabledHash}|${tokensRevisionAll}`;
  }

  private resetAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }

    this.autoLockTimer = setTimeout(() => {
      this.lockWallet();
    }, this.autoLockTimeoutMs);
  }

  private validateWalletName(name: string): boolean {
    return /^[A-Za-z0-9]{1,12}$/.test(name);
  }

  /**
   * Dynamically import wallet modules from the shared SDK.
   *
   * Uses require() for Metro bundler compatibility.
   * The @wallet path alias is configured in metro.config.js and tsconfig.json
   * to resolve to ../src/*
   */
  private async importWalletModules(): Promise<{
    Wallet: any;
    WalletAppService: any;
    setCryptoAdapter: any;
  }> {
    try {
      const resolveExport = (module: any, name: string) => {
        if (!module) return undefined;
        return module[name] ?? module.default?.[name] ?? module.default;
      };

      // Use require for Metro bundler compatibility
      // These paths resolve via the @wallet alias in metro.config.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const walletModule = require('@wallet/wallet');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const appServiceModule = require('@wallet/app-service');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cryptoModule = require('@wallet/crypto-utils');

      const Wallet = resolveExport(walletModule, 'Wallet');
      const WalletAppService = resolveExport(appServiceModule, 'WalletAppService');
      const setCryptoAdapter = resolveExport(cryptoModule, 'setCryptoAdapter');

      return { Wallet, WalletAppService, setCryptoAdapter };
    } catch (error) {
      console.error('[WalletBridge] Failed to import wallet modules:', error);
      throw new Error(
        'Failed to load wallet SDK. Ensure Metro is configured to resolve @wallet/* paths. ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Singleton instance for use throughout the app.
 */
export const walletBridge = new WalletBridge();
