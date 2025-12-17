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
}

export interface Token {
  symbol: string;
  name: string;
  type: 'native' | 'erc20';
  address?: string;
  decimals: number;
  icon?: string;
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
  fee?: string;
}

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
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp';
  bitcoinNetwork?: 'mainnet' | 'testnet';
  solanaCluster?: 'mainnet-beta' | 'devnet' | 'testnet';
  xrpNetwork?: 'mainnet' | 'testnet' | 'devnet';
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
  // Per-network balance cache: key -> { fetchedAt, height?, portfolio[] }
  private balanceCache: Map<string, { fetchedAt: number; height?: number; portfolio: any[] }> = new Map();
  // Aggregated all-network cache
  private aggregateCache: Map<string, { fetchedAt: number; holdings: any[]; totalsByNetwork: Record<string, number>; grandTotal: number }> = new Map();
  // In-flight dedupe maps
  private inflightBalances: Map<string, Promise<any>> = new Map();
  private inflightAggregate: Map<string, Promise<any>> = new Map();

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
    const storedConfig = mobileStorage.readJSON<Partial<Config>>('config.json', {});

    // Load bundled config from parent directory
    // Use require() for Metro/Jest compatibility (avoids Node dynamic import edge cases in tests)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getBundledConfig } = require('../config/bundled-config');
    const bundledConfig = getBundledConfig();

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
   * @returns Wallet address and (optionally) mnemonic.
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

    return {
      success: true,
      address: result.address,
      mnemonic: showMnemonic ? result.mnemonic : undefined,
    };
  }

  /**
   * Import an existing wallet from mnemonic.
   *
   * @param mnemonic - BIP39 mnemonic phrase to import.
   * @param password - Master password used to encrypt the imported mnemonic.
   * @param name - Wallet name to save under (`wallets.json` key).
   * @returns Imported wallet address.
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

    return {
      success: true,
      address: result.address,
    };
  }

  /**
   * Unlock an existing wallet.
   *
   * Uses react-native-quick-crypto for fast native PBKDF2 key derivation.
   *
   * @param password - Master password for decrypting the stored mnemonic.
   * @param name - Wallet name to unlock (defaults to `default`).
   * @returns Unlocked wallet address and wallet name.
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

    return {
      success: true,
      address: loaded.address,
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

    const tokens = this.service.getTokensForNetwork(this.config!.network);
    return tokens.map((token: Token) => ({
      token,
      balance: null, // Will be populated by balance refresh
      lastUpdated: null,
      isLoading: true,
    }));
  }

  /**
   * Refresh balances for the current network.
   *
   * @returns Token balances for the active network.
   * @throws If portfolio fetch fails.
   */
  async refreshBalances(): Promise<TokenBalance[]> {
    this.requireUnlocked();

    console.log('[WalletBridge] refreshBalances() - network:', this.config!.network);
    try {
      const portfolio = await this.service.getPortfolioForNetwork(this.config!.network);
      console.log('[WalletBridge] refreshBalances() - portfolio:', JSON.stringify(portfolio));
      return portfolio.map((item: any) => ({
        token: item.token,
        balance: item.balance || '0',
        lastUpdated: Date.now(),
        isLoading: false,
      }));
    } catch (error) {
      console.error('[WalletBridge] refreshBalances() - error:', error);
      throw error;
    }
  }

  /**
   * Get token prices.
   */
  // Local price cache to minimize API calls
  private priceCache: Record<string, { price: number; timestamp: number }> = {};
  private readonly PRICE_CACHE_TTL = 60 * 1000; // 60 seconds

  /**
   * Get cached price or null if expired/not found.
   */
  private getCachedPrice(key: string): number | null {
    const cached = this.priceCache[key];
    if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_TTL) {
      return cached.price;
    }
    return null;
  }

  /**
   * Set price in cache.
   */
  private setCachedPrice(key: string, price: number): void {
    this.priceCache[key] = { price, timestamp: Date.now() };
  }

  /**
   * Get token prices with rate limiting protection.
   *
   * @returns Prices keyed by token symbol and derived total portfolio value.
   */
  async getTokenPrices(): Promise<{
    prices: Record<string, number | null>;
    totalValue: number;
    formattedTotal: string;
  }> {
    this.requireUnlocked();

    const { getSolanaPrice, getBitcoinPrice, getXRPPrice, getNativeTokenPrice } = await import('./price-service');
    
    const network = this.config!.network;
    const networkConfig = this.config!.networks[network];
    const prices: Record<string, number | null> = {};
    let totalValue = 0;

    // Get balances to calculate total value (and filter to non-zero to avoid excess pricing calls)
    const balances = await this.refreshBalances();
    const nonZeroBalances = balances.filter((b: any) => {
      const val = parseFloat(b.balance || '0');
      return Number.isFinite(val) && val > 0;
    });

    // Determine the price key and fetch function based on network type
    let nativePrice: number | null = null;
    const cacheKey = `native_${network}`;

    // Check cache first
    const cachedPrice = this.getCachedPrice(cacheKey);
    if (cachedPrice !== null) {
      nativePrice = cachedPrice;
    } else {
      // Fetch price based on network type
      try {
        if (network.startsWith('solana')) {
          nativePrice = await getSolanaPrice(network);
        } else if (network.startsWith('bitcoin')) {
          nativePrice = await getBitcoinPrice(network);
        } else if (network.startsWith('xrp')) {
          nativePrice = await getXRPPrice(network);
        } else if (networkConfig?.chainId) {
          nativePrice = await getNativeTokenPrice(networkConfig.chainId);
        }
        
        if (nativePrice !== null) {
          this.setCachedPrice(cacheKey, nativePrice);
        }
      } catch (error) {
        console.warn('[WalletBridge] Failed to fetch price:', error);
      }
    }

    // Apply prices to non-zero balances
    for (const item of nonZeroBalances) {
      const balance = parseFloat(item.balance || '0');

      if (item.token.type === 'native') {
        prices[item.token.symbol] = nativePrice;
        if (nativePrice !== null && !isNaN(balance)) {
          totalValue += balance * nativePrice;
        }
      } else {
        // ERC-20 prices are resolved below via batched fetch; initialise to null for now.
        prices[item.token.symbol] = null;
      }
    }

    // For EVM networks, fetch ERC-20 prices in batch for non-zero tokens
    if (networkConfig?.chainId) {
      const tokenInfos = nonZeroBalances
        .filter((b: any) => b.token.type === 'erc20' && b.token.address)
        .map((b: any) => ({
          type: 'erc20' as const,
          symbol: b.token.symbol,
          address: b.token.address,
          decimals: b.token.decimals,
          balance: b.balance
        }));

      if (tokenInfos.length) {
        const { getTokenPrices: getPricesBatch, calculateTotalValue: calcTotal } = await import('./price-service');
        const priceMap = await getPricesBatch(networkConfig.chainId, tokenInfos.map(({ address, type, symbol, decimals }) => ({
          type,
          symbol,
          address,
          decimals
        })));

        // Update prices map for ERC-20s
        tokenInfos.forEach(info => {
          const key = info.address!.toLowerCase();
          const p = priceMap.get(key) ?? null;
          prices[info.symbol] = p;
        });

        // Recompute total value including ERC-20s
        const balancesForCalc = nonZeroBalances.map((item: any) => ({
          token: {
            type: item.token.type === 'native' ? 'native' : 'erc20',
            symbol: item.token.symbol,
            address: item.token.address,
            decimals: item.token.decimals
          },
          balance: item.balance
        }));

        totalValue = calcTotal(balancesForCalc, priceMap);
      }
    }

    return {
      prices,
      totalValue,
      formattedTotal: `$${totalValue.toFixed(2)}`,
    };
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

    return await this.service.getGasEstimate(token, toAddress, amount);
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
   * @returns Transaction hash/signature.
   * @throws If wallet is locked or SDK send fails.
   */
  async sendTransaction(
    token: Token,
    toAddress: string,
    amount: string,
    destinationTag?: number
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

    // EVM transaction
    const result = await this.service.sendToken(token, toAddress, amount);
    return {
      hash: result.hash,
      status: 'confirmed',
      blockNumber: result.blockNumber,
    };
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

    const aggregateKey = this.makeAggregateCacheKey(enabledNetworks);
    const cachedAggregate = this.aggregateCache.get(aggregateKey);
    const now = Date.now();
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
              holdings.push(...perNetwork.portfolio.map((item: any) => ({
                ...item,
                networkKey,
                height: perNetwork.height ?? null,
                fetchedAt: perNetwork.fetchedAt
              })));
            } catch (err: any) {
              errors[networkKey] = err?.message || 'Failed to fetch';
            }
          }
        })());
      }
      await Promise.all(workers);

      const filtered = includeZero ? holdings : holdings.filter(h => {
        const val = parseFloat(h.balance || '0');
        return Number.isFinite(val) && val > 0 && h.balance !== 'Error';
      });

      // Totals by network (USD) using price-service
      const totalsByNetwork: Record<string, number> = {};
      const { getTokenPrices, calculateTotalValue } = await import('./price-service');

      for (const networkKey of enabledNetworks) {
        const netConfig = this.config!.networks[networkKey];
        const assets = filtered.filter(h => h.networkKey === networkKey);
        if (!assets.length) {
          totalsByNetwork[networkKey] = 0;
          continue;
        }

        if (netConfig.type === 'bitcoin') {
          const { getBitcoinPrice } = await import('./price-service');
          const price = await getBitcoinPrice(networkKey);
          const total = assets.reduce((acc, a) => acc + (parseFloat(a.balance || '0') * (price || 0)), 0);
          totalsByNetwork[networkKey] = total;
          continue;
        }
        if (netConfig.type === 'solana') {
          const { getSolanaPrice } = await import('./price-service');
          const price = await getSolanaPrice(networkKey);
          const total = assets.reduce((acc, a) => acc + (parseFloat(a.balance || '0') * (price || 0)), 0);
          totalsByNetwork[networkKey] = total;
          continue;
        }
        if (netConfig.type === 'xrp') {
          const { getXRPPrice } = await import('./price-service');
          const price = await getXRPPrice(networkKey);
          const total = assets.reduce((acc, a) => acc + (parseFloat(a.balance || '0') * (price || 0)), 0);
          totalsByNetwork[networkKey] = total;
          continue;
        }

        // EVM: batch prices per chain
        const chainId = netConfig.chainId;
        if (!chainId) {
          totalsByNetwork[networkKey] = 0;
          continue;
        }

        const tokenInfos = assets.map(a => ({
          token: {
            type: a.token.type === 'native' ? 'native' : 'erc20',
            symbol: a.token.symbol,
            address: a.token.address,
            decimals: a.token.decimals
          },
          balance: a.balance
        }));
        const priceMap = await getTokenPrices(chainId, tokenInfos.map(t => t.token));
        totalsByNetwork[networkKey] = calculateTotalValue(tokenInfos, priceMap);
      }

      const grandTotal = Object.values(totalsByNetwork).reduce((a, b) => a + b, 0);
      const aggregate = { holdings: filtered, totalsByNetwork, grandTotal, fetchedAt: Date.now() };
      this.aggregateCache.set(aggregateKey, aggregate);
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
    const cached = this.balanceCache.get(cacheKey);
    const now = Date.now();
    if (!opts.force && cached && now - cached.fetchedAt < opts.ttlMs) {
      return cached;
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

    return {
      address: result.address,
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

    const result = this.service.switchAccount(index);
    
    // Persist the current account selection
    this.service.saveWallet(this.currentWalletName);
    
    return { address: result.address };
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
      // Use require for Metro bundler compatibility
      // These paths resolve via the @wallet alias in metro.config.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Wallet } = require('@wallet/wallet');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { WalletAppService } = require('@wallet/app-service');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setCryptoAdapter } = require('@wallet/crypto-utils');

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
