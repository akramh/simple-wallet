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
  rpcUrl: string | string[];
  chainId?: number;
  nativeSymbol: string;
  nativeName: string;
  blockExplorer?: string;
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp';
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

  /**
   * Initialize the wallet bridge.
   * Must be called before any other methods.
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
    // Try to load from storage first (user overrides)
    const storedConfig = mobileStorage.readJSON<Partial<Config>>('config.json', {});

    // Default config - in production, this would be bundled with the app
    const defaultConfig: Config = {
      network: 'sepolia',
      networks: {
        mainnet: {
          name: 'Ethereum',
          rpcUrl: 'https://eth.llamarpc.com',
          chainId: 1,
          nativeSymbol: 'ETH',
          nativeName: 'Ether',
          blockExplorer: 'https://etherscan.io',
          type: 'evm',
        },
        sepolia: {
          name: 'Sepolia Testnet',
          rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
          chainId: 11155111,
          nativeSymbol: 'ETH',
          nativeName: 'Sepolia Ether',
          blockExplorer: 'https://sepolia.etherscan.io',
          type: 'evm',
        },
        polygon: {
          name: 'Polygon',
          rpcUrl: 'https://polygon-rpc.com',
          chainId: 137,
          nativeSymbol: 'POL',
          nativeName: 'POL',
          blockExplorer: 'https://polygonscan.com',
          type: 'evm',
        },
        'bitcoin-mainnet': {
          name: 'Bitcoin',
          rpcUrl: 'https://mempool.space/api',
          nativeSymbol: 'BTC',
          nativeName: 'Bitcoin',
          blockExplorer: 'https://mempool.space',
          type: 'bitcoin',
        },
        'solana-mainnet': {
          name: 'Solana',
          rpcUrl: 'https://api.mainnet-beta.solana.com',
          nativeSymbol: 'SOL',
          nativeName: 'Solana',
          blockExplorer: 'https://solscan.io',
          type: 'solana',
        },
      },
    };

    // Merge stored config with defaults
    return {
      ...defaultConfig,
      ...storedConfig,
      networks: {
        ...defaultConfig.networks,
        ...(storedConfig.networks || {}),
      },
    };
  }

  /**
   * Get current wallet state.
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
   * Create a new wallet.
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

    // Set up crypto adapter
    setCryptoAdapter(mobileCrypto);

    // Create wallet instance
    this.wallet = new Wallet(this.config!, mobileStorage);
    const result = this.wallet.createNewWallet(password);

    // Create service
    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
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

    setCryptoAdapter(mobileCrypto);

    this.wallet = new Wallet(this.config!, mobileStorage);
    const result = this.wallet.importWallet(mnemonic, password);

    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
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
   */
  async unlockWallet(password: string, name: string = 'default'): Promise<UnlockWalletResult> {
    await this.ensureInitialized();

    const { Wallet, WalletAppService, setCryptoAdapter } = await this.importWalletModules();

    setCryptoAdapter(mobileCrypto);

    this.wallet = new Wallet(this.config!, mobileStorage);
    this.service = new WalletAppService(this.wallet, this.config!, {
      storage: mobileStorage,
    });

    const loaded = this.service.loadWallet(name, password);
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
   * Get tokens for the current network.
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
   */
  async refreshBalances(): Promise<TokenBalance[]> {
    this.requireUnlocked();

    const portfolio = await this.service.getPortfolioForNetwork(this.config!.network);
    return portfolio.map((item: any) => ({
      token: item.token,
      balance: item.balance || '0',
      lastUpdated: Date.now(),
      isLoading: false,
    }));
  }

  /**
   * Get token prices.
   */
  async getTokenPrices(): Promise<{
    prices: Record<string, number | null>;
    totalValue: number;
    formattedTotal: string;
  }> {
    this.requireUnlocked();

    // This would integrate with the price service
    // For now, return placeholder
    return {
      prices: {},
      totalValue: 0,
      formattedTotal: '$0.00',
    };
  }

  /**
   * Get gas estimate for a transaction.
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
   * Get transaction history.
   */
  async getTransactions(): Promise<Transaction[]> {
    this.requireUnlocked();

    // This would integrate with the explorer API
    // For now, return empty array
    return [];
  }

  /**
   * Switch network.
   */
  async switchNetwork(networkKey: string): Promise<void> {
    this.requireUnlocked();

    if (!this.config!.networks[networkKey]) {
      throw new Error('Network not found');
    }

    await this.service.setNetwork(networkKey);
    this.config!.network = networkKey;

    // Persist network preference
    mobileStorage.writeJSON('config.json', { network: networkKey });
  }

  /**
   * Get available networks.
   */
  async getNetworks(): Promise<Record<string, NetworkConfig>> {
    await this.ensureInitialized();
    return this.config!.networks;
  }

  /**
   * Get all wallets.
   */
  async getAllWallets(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    return mobileStorage.readJSON('wallets.json', {});
  }

  /**
   * Get accounts for current wallet.
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
   */
  async createAccount(): Promise<{ address: string; accountIndex: number }> {
    this.requireUnlocked();

    const result = this.service.addAccount();
    return {
      address: result.address,
      accountIndex: result.accountIndex,
    };
  }

  /**
   * Switch to a different account.
   */
  async switchAccount(index: number): Promise<{ address: string }> {
    this.requireUnlocked();

    const result = this.service.switchAccount(index);
    return { address: result.address };
  }

  /**
   * Get secret recovery phrase (requires password confirmation).
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
