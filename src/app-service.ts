/**
 * @fileoverview UI-agnostic wallet application service layer.
 * 
 * WalletAppService centralizes non-UI wallet operations so the same logic can
 * be reused by different frontends (CLI, browser extension, mobile, etc.).
 * 
 * This service provides:
 * - Wallet lifecycle management (create, import, load, save, delete)
 * - Account management within HD wallets
 * - Token registry management (built-in + user-added custom tokens)
 * - Network switching with optional persistence
 * - Portfolio queries and transaction sending
 * 
 * The service is initialized with a Wallet instance and configuration,
 * then coordinates between the wallet core and token registry.
 * 
 * @module app-service
 */

import type { Config, Token, TokenRegistry, TokenMetadata } from './types/index.js';
import { isBitcoinNetworkConfig, isEVMNetworkConfig, isSolanaNetworkConfig } from './types/config.js';
import { Wallet } from './wallet.js';
import { MemoryStorage, type StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';
import { ethers } from 'ethers';
import {
  SolanaProvider,
  getSolanaExplorer,
  deriveSolanaKeypair,
  buildAndSignSolTransfer,
  validateSufficientBalance,
  isValidSolanaAddress,
  solToLamports,
  lamportsToSol,
  type SolanaAddressInfo,
  type NormalizedSolanaTransaction,
  type SolanaExplorer,
  type SolTransferResult,
} from './solana/index.js';
import { PublicKey } from '@solana/web3.js';
import {
  BitcoinProvider,
  getBitcoinProvider,
  isBitcoinNetwork,
  satoshisToBtc,
  isValidBitcoinAddress,
  type BitcoinAddressInfo,
  type NormalizedBitcoinTransaction,
} from './bitcoin/index.js';

/**
 * Gas estimation result for transaction cost display.
 */
export interface GasEstimate {
  /** Estimated gas units required */
  gasLimit: string;
  /** Current gas price in wei (legacy transactions) */
  gasPrice: string;
  /** Maximum fee per gas in wei (EIP-1559) */
  maxFeePerGas: string | null;
  /** Priority fee per gas in wei (EIP-1559) */
  maxPriorityFeePerGas: string | null;
  /** Total estimated cost in wei */
  estimatedCostWei: string;
  /** Total estimated cost in native token (formatted) */
  estimatedCostNative: string;
  /** Native token symbol (ETH, POL, etc.) */
  nativeSymbol: string;
  /** Whether network supports EIP-1559 */
  supportsEIP1559: boolean;
  /** Network identifier */
  network: string;
  /** Error message if estimation failed */
  error?: string;
}

/**
 * Options for network switching behavior.
 */
interface SetNetworkOptions {
  /** Whether to persist the network change to config file (default: true) */
  persist?: boolean;
}

/** Wallet creation/import result */
type WalletInfo = {
  address: string;
  mnemonic: string;
  privateKey: string;
};

/**
 * UI-agnostic wallet application service.
 * 
 * Orchestrates wallet operations and token registry management.
 * Both CLI (`src/index.ts`) and extension (`service-worker.ts`) instantiate
 * this service with environment-specific adapters.
 * 
 * @example
 * ```typescript
 * const storage = new FileStorage();
 * const wallet = new Wallet(config, storage);
 * const service = new WalletAppService(wallet, config, { storage });
 * await service.initialize();
 * 
 * const info = service.createWallet(password);
 * service.saveWallet('MyWallet');
 * ```
 */
export class WalletAppService {
  /** Current network configuration */
  config: Config & { network: string };
  /** Core wallet instance for blockchain operations */
  wallet: Wallet;
  /** Path to built-in token list file */
  tokenListPath: string;
  /** Path to user-added custom tokens file */
  customTokenPath: string;
  /** Path to config file for persistence */
  configPath: string;
  /** Built-in token registry (read-only, from bundled JSON) */
  builtInTokens: TokenRegistry;
  /** User-added custom tokens (persisted on modification) */
  customTokens: TokenRegistry;
  /** Storage adapter for persistence */
  storage: StorageAdapter;
  /** Bitcoin provider for Bitcoin network operations */
  private bitcoinProvider: BitcoinProvider | null = null;
  /** Cached Bitcoin address for current account */
  private cachedBitcoinAddress: BitcoinAddressInfo | null = null;
  /** Solana provider for Solana network operations */
  private solanaProvider: SolanaProvider | null = null;
  /** Solana explorer for Solana transaction history */
  private solanaExplorer: SolanaExplorer | null = null;

  /**
   * Create a new WalletAppService instance.
   * 
   * @param wallet - Initialized Wallet instance
   * @param config - Application configuration with current network
   * @param options - Service configuration options
   * @param options.tokenListPath - Path to built-in tokens JSON (default: 'tokens.json')
   * @param options.customTokenPath - Path to custom tokens JSON (default: 'tokens-user.json')
   * @param options.configPath - Path to config JSON (default: 'config.json')
   * @param options.storage - Storage adapter (default: MemoryStorage)
   * @param options.providerFactory - Provider factory to inject into wallet
   * @param options.builtInTokens - Pre-loaded built-in tokens (for bundled assets)
   */
  constructor(
    wallet: Wallet,
    config: Config & { network: string },
    options: {
      tokenListPath?: string;
      customTokenPath?: string;
      configPath?: string;
      storage?: StorageAdapter;
      providerFactory?: ProviderFactory;
      builtInTokens?: TokenRegistry;
    } = {}
  ) {
    if (options.providerFactory) {
      wallet.providerFactory = options.providerFactory;
    }
    this.wallet = wallet;
    this.config = config;
    // Default to in-memory storage to remain browser-safe unless provided.
    this.storage = options.storage || new MemoryStorage();
    this.tokenListPath = options.tokenListPath ?? 'tokens.json';
    this.customTokenPath = options.customTokenPath ?? 'tokens-user.json';
    this.configPath = options.configPath ?? 'config.json';

    // Use provided built-in tokens (e.g., from bundled JSON in extension) or read from storage
    this.builtInTokens = options.builtInTokens ?? this.safeReadRegistry(this.tokenListPath);
    this.customTokens = this.safeReadRegistry(this.customTokenPath);
  }

  /**
   * Initialize the service by setting up the wallet's RPC provider.
   * Must be called before any blockchain operations.
   */
  async initialize(): Promise<void> {
    const netConfig = this.config.networks[this.config.network];
    if (netConfig && isEVMNetworkConfig(netConfig)) {
      await this.wallet.initialize();
    }
  }

  // ============================================================================
  // Non-EVM Support Helpers
  // ============================================================================

  /**
   * Check if the current network is a Bitcoin network.
   */
  isCurrentNetworkBitcoin(): boolean {
    return isBitcoinNetwork(this.config.network);
  }

  /**
   * Check if the current network is a Solana network.
   */
  isCurrentNetworkSolana(): boolean {
    const netConfig = this.config.networks[this.config.network];
    return !!netConfig && isSolanaNetworkConfig(netConfig);
  }

  /**
   * Check if a specific network is a Bitcoin network.
   */
  isNetworkBitcoin(networkKey: string): boolean {
    return isBitcoinNetwork(networkKey);
  }

  /**
   * Check if a specific network is a Solana network.
   */
  isNetworkSolana(networkKey: string): boolean {
    const netConfig = this.config.networks[networkKey];
    return !!netConfig && isSolanaNetworkConfig(netConfig);
  }

  /**
   * Get or create the Bitcoin provider for the current network.
   * @private
   */
  private getBitcoinProviderForNetwork(networkKey: string): BitcoinProvider {
    if (!this.bitcoinProvider || this.bitcoinProvider.getNetworkKey() !== networkKey) {
      this.bitcoinProvider = getBitcoinProvider(networkKey);
    }
    return this.bitcoinProvider;
  }

  /**
   * Get or create the Solana provider for a network.
   * @private
   */
  private getSolanaProviderForNetwork(networkKey: string): SolanaProvider {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig || !isSolanaNetworkConfig(netConfig)) {
      throw new Error('Not a Solana network');
    }

    const rpcUrls = Array.isArray(netConfig.rpcUrl) ? netConfig.rpcUrl : [netConfig.rpcUrl];
    const cleaned = rpcUrls.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map(u => u.trim());
    if (!cleaned.length) {
      throw new Error('No Solana RPC URLs configured for network');
    }

    if (!this.solanaProvider || this.solanaProvider.getNetworkKey() !== networkKey) {
      this.solanaProvider = new SolanaProvider({
        networkKey,
        rpcUrls: cleaned
      });
    }

    return this.solanaProvider;
  }

  /**
   * Get or create the Solana explorer for a network.
   * Uses RPC for transaction history.
   * @private
   */
  private getSolanaExplorerForNetwork(networkKey: string): SolanaExplorer {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig || !isSolanaNetworkConfig(netConfig)) {
      throw new Error('Not a Solana network');
    }

    const rpcUrls = Array.isArray(netConfig.rpcUrl) ? netConfig.rpcUrl : [netConfig.rpcUrl];
    const cleanedRpcUrls = rpcUrls.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map(u => u.trim());
    if (!cleanedRpcUrls.length) {
      throw new Error('No Solana RPC URLs configured for network');
    }

    if (!this.solanaExplorer || this.solanaExplorer.getNetworkKey() !== networkKey) {
      this.solanaExplorer = getSolanaExplorer(networkKey, cleanedRpcUrls);
    }

    return this.solanaExplorer;
  }

  /**
   * Get the Bitcoin address for the current account.
   * Caches the result for performance.
   */
  getBitcoinAddress(): BitcoinAddressInfo | null {
    if (!this.isCurrentNetworkBitcoin()) {
      return null;
    }

    // Check if we have a cached address for the current account
    const accountIndex = this.wallet.getCurrentAccountIndex();
    const networkKey = this.config.network;
    const btcNetwork = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';

    try {
      // Get Bitcoin address from the wallet's mnemonic
      return this.wallet.getBitcoinAddress(btcNetwork, accountIndex);
    } catch (error) {
      console.warn('[WalletAppService] Failed to get Bitcoin address:', error);
      return null;
    }
  }

  /**
   * Get the Solana address for the current account.
   */
  getSolanaAddress(): SolanaAddressInfo | null {
    if (!this.isCurrentNetworkSolana()) {
      return null;
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();

    try {
      return this.wallet.getSolanaAddress(accountIndex);
    } catch (error) {
      console.warn('[WalletAppService] Failed to get Solana address:', error);
      return null;
    }
  }

  /**
   * Create a new HD wallet with random mnemonic.
   * @param password - Master password for encryption
   * @returns Wallet info including address and mnemonic
   */
  createWallet(password: string): WalletInfo {
    return this.wallet.createNewWallet(password);
  }

  /**
   * Import a wallet from existing mnemonic phrase.
   * @param mnemonic - BIP-39 mnemonic (12-24 words)
   * @param password - Master password for encryption
   * @param accountIndex - BIP-44 account index (default: 0)
   * @returns Wallet info with derived address
   */
  importWallet(mnemonic: string, password: string, accountIndex: number = 0): WalletInfo {
    return this.wallet.importWallet(mnemonic, password, accountIndex);
  }

  /**
   * Load and decrypt a wallet from storage.
   * @param walletName - Name of saved wallet
   * @param password - Master password
   * @param accountIndex - Optional account index override
   * @returns Wallet info or null if not found
   */
  loadWallet(walletName: string, password: string, accountIndex: number | null = null): WalletInfo | null {
    return this.wallet.loadWallet(walletName, password, accountIndex);
  }

  /**
   * Save the current wallet to persistent storage.
   * @param walletName - Optional name (defaults to address prefix)
   * @returns Name used for saving
   */
  saveWallet(walletName?: string): string {
    return this.wallet.saveWallet(walletName);
  }

  /**
   * Delete a wallet from storage.
   * @param walletName - Name of wallet to delete
   * @returns True if deletion succeeded
   */
  deleteWallet(walletName: string): boolean {
    return this.wallet.deleteWallet(walletName);
  }

  /**
   * Get all accounts for a wallet.
   * @param walletName - Wallet name
   * @returns Map of account indices to addresses
   */
  getWalletAccounts(walletName: string): Record<number, { address: string; createdAt: string }> {
    return this.wallet.getWalletAccounts(walletName);
  }

  /**
   * Get all saved wallets.
   * @returns Map of wallet names to encrypted data
   */
  getAllWallets(): Record<string, any> {
    return this.wallet.getAllWallets();
  }

  /**
   * Rename a wallet in storage.
   *
   * @param oldName - Existing wallet name
   * @param newName - Desired new wallet name
   * @returns The new wallet name
   */
  renameWallet(oldName: string, newName: string): string {
    return this.wallet.renameWallet(oldName, newName);
  }

  /**
   * Switch to a different account within the wallet.
   * @param index - BIP-44 account index
   * @returns New account info
   */
  switchAccount(index: number): { address: string; accountIndex: number } {
    return this.wallet.switchAccount(index);
  }

  /**
   * Get the current account index.
   * @returns Current BIP-44 account index
   */
  getCurrentAccountIndex(): number {
    return this.wallet.getCurrentAccountIndex();
  }

  /**
   * Get address for a specific account index.
   * @param index - BIP-44 account index
   * @returns Account address
   */
  getAccountAddress(index: number): string {
    return this.wallet.getAccountAddress(index);
  }

  /**
   * Get the current wallet address.
   * Returns the appropriate address for the current network (EVM or Bitcoin).
   * @returns Address string
   */
  getAddress(): string {
    if (this.isCurrentNetworkBitcoin()) {
      const btcInfo = this.getBitcoinAddress();
      return btcInfo?.address || '';
    }
    if (this.isCurrentNetworkSolana()) {
      const solInfo = this.getSolanaAddress();
      return solInfo?.address || '';
    }
    return this.wallet.getAddress();
  }

  /**
   * Get the current JSON-RPC provider.
   * @returns Active ethers JsonRpcProvider instance
   */
  getProvider(): ethers.JsonRpcProvider | null {
    return this.wallet.provider;
  }

  /**
   * Get native currency balance.
   * @returns Balance in native currency (ETH for EVM, BTC for Bitcoin)
   */
  async getBalance(): Promise<string> {
    if (this.isCurrentNetworkBitcoin()) {
      const btcInfo = this.getBitcoinAddress();
      if (!btcInfo) {
        return '0';
      }
      const provider = this.getBitcoinProviderForNetwork(this.config.network);
      return provider.getBalanceFormatted(btcInfo.address);
    }
    if (this.isCurrentNetworkSolana()) {
      const solInfo = this.getSolanaAddress();
      if (!solInfo) {
        return '0';
      }
      const provider = this.getSolanaProviderForNetwork(this.config.network);
      return provider.getBalanceFormatted(solInfo.address);
    }
    return this.wallet.getBalance();
  }

  /**
   * Get portfolio balances for all tokens on a network.
   * @param networkKey - Network identifier
   * @returns Array of token balances
   */
  async getPortfolioForNetwork(networkKey: string): Promise<{ token: Token; balance: string; error?: string }[]> {
    // Handle Bitcoin networks
    if (this.isNetworkBitcoin(networkKey)) {
      const btcNetwork = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
      try {
        const btcInfo = this.wallet.getBitcoinAddress(btcNetwork);
        if (!btcInfo) {
          return [{
            token: this.getNativeToken(networkKey),
            balance: '0',
            error: 'No Bitcoin address available',
          }];
        }
        const provider = this.getBitcoinProviderForNetwork(networkKey);
        const portfolio = await provider.getPortfolio(btcInfo.address);
        return portfolio.map(p => ({
          token: p.token,
          balance: p.balance,
          error: p.error,
        }));
      } catch (error) {
        return [{
          token: this.getNativeToken(networkKey),
          balance: 'Error',
          error: (error as Error).message,
        }];
      }
    }

    // Handle Solana networks
    if (this.isNetworkSolana(networkKey)) {
      try {
        const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
        const provider = this.getSolanaProviderForNetwork(networkKey);
        const balance = await provider.getBalanceFormatted(solInfo.address);
        return [{
          token: this.getNativeToken(networkKey),
          balance,
        }];
      } catch (error) {
        return [{
          token: this.getNativeToken(networkKey),
          balance: 'Error',
          error: (error as Error).message,
        }];
      }
    }

    // EVM networks
    const tokens = this.getTokensForNetwork(networkKey);
    return this.wallet.getPortfolio(tokens);
  }

  /**
   * Fetch balances for a list of tokens.
   * Used for async balance updates after initial token list display.
   * @param tokens - Array of tokens to fetch balances for
   * @returns Array of token balances
   */
  async fetchBalances(tokens: Token[]): Promise<{ token: Token; balance: string; error?: string }[]> {
    return this.wallet.getPortfolio(tokens);
  }

  /**
   * Send a token or native currency.
   * @param token - Token to send
   * @param toAddress - Recipient address
   * @param amount - Amount to send
   * @returns Transaction receipt
   */
  async sendToken(token: Token, toAddress: string, amount: string): Promise<{ hash: string; blockNumber: number; gasUsed: string }> {
    return this.wallet.sendToken(token, toAddress, amount);
  }

  /**
   * Estimate gas cost for a token transfer.
   * Returns detailed gas information including USD-convertible costs.
   *
   * @param token - Token to send (native or ERC-20)
   * @param toAddress - Recipient address
   * @param amount - Amount to send (in token units)
   * @returns Gas estimation with costs in wei and native token
   */
  async getGasEstimate(token: Token, toAddress: string, amount: string): Promise<GasEstimate> {
    // Bitcoin networks: estimate fee using Mempool fee rates and UTXO selection.
    if (this.isCurrentNetworkBitcoin()) {
      const networkKey = this.config.network;
      const netConfig = this.config.networks[networkKey];
      const nativeSymbol = netConfig?.nativeSymbol || (networkKey === 'bitcoin-testnet' ? 'tBTC' : 'BTC');

      try {
        const fromAddress = this.getAddress();
        const recipient = toAddress || fromAddress;
        if (toAddress && !isValidBitcoinAddress(toAddress, networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet')) {
          throw new Error('Invalid Bitcoin address');
        }

        // If amount is empty/zero, return a neutral estimate without throwing.
        if (!amount || amount.trim() === '' || amount.trim() === '0' || amount.trim() === '0.0') {
          return {
            gasLimit: '0',
            gasPrice: '0',
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
            estimatedCostWei: '0',
            estimatedCostNative: '0',
            nativeSymbol,
            supportsEIP1559: false,
            network: networkKey
          };
        }

        const provider = this.getBitcoinProviderForNetwork(networkKey);
        const feeEstimates = await provider.getFeeEstimates();
        const feeRateSatVb = feeEstimates.halfHourFee;

        const estimation = await provider.estimateSendTransaction(
          fromAddress,
          recipient,
          amount || '0',
          feeRateSatVb
        );

        const feeBtc = satoshisToBtc(estimation.fee.feeSats);

        return {
          gasLimit: estimation.fee.vbytes.toString(),
          gasPrice: feeRateSatVb.toString(), // sat/vB
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: estimation.fee.feeSats.toString(),
          estimatedCostNative: feeBtc,
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      } catch (error: any) {
        return {
          error: error.message || 'Failed to estimate Bitcoin fee',
          gasLimit: '0',
          gasPrice: '0',
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: '0',
          estimatedCostNative: '0',
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      }
    }

    // Solana networks: estimate fee using base fee (5000 lamports per signature)
    if (this.isCurrentNetworkSolana()) {
      const networkKey = this.config.network;
      const netConfig = this.config.networks[networkKey];
      const nativeSymbol = netConfig?.nativeSymbol || 'SOL';

      try {
        const provider = this.getSolanaProviderForNetwork(networkKey);
        const feeEstimate = await provider.estimateFee();

        return {
          gasLimit: '1', // 1 signature for simple transfers
          gasPrice: feeEstimate.feeLamports.toString(), // lamports per signature
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: feeEstimate.feeLamports.toString(), // lamports
          estimatedCostNative: feeEstimate.feeSol,
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      } catch (error: any) {
        return {
          error: error.message || 'Failed to estimate Solana fee',
          gasLimit: '1',
          gasPrice: '5000', // Base fee fallback
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: '5000',
          estimatedCostNative: '0.000005',
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      }
    }

    const gasNetwork = this.config.network;
    const gasNetworkConfig = this.config.networks[gasNetwork];
    const nativeSymbol = gasNetworkConfig?.nativeSymbol || 'ETH';
    const provider = this.wallet.provider;

    if (!provider) {
      return {
        error: 'Provider not initialized',
        gasLimit: token.type === 'native' ? '21000' : '65000',
        gasPrice: '0',
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        estimatedCostWei: '0',
        estimatedCostNative: '0',
        nativeSymbol,
        supportsEIP1559: false,
        network: gasNetwork
      };
    }

    try {
      const fromAddress = this.wallet.getAddress();

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gas estimation timeout')), 5000)
      );
      const feeData = await Promise.race([provider.getFeeData(), timeoutPromise]);

      let gasLimit: bigint;

      if (token.type === 'native') {
        // Standard native token transfer gas limit
        gasLimit = 21000n;
      } else {
        // Estimate ERC-20 transfer gas with timeout
        try {
          const tokenContract = new ethers.Contract(
            token.address!,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            provider
          );
          const tokenAmount = ethers.parseUnits(amount || '0', token.decimals || 18);
          const estimatePromise = tokenContract.transfer.estimateGas(
            toAddress || fromAddress,
            tokenAmount,
            { from: fromAddress }
          );
          const estimateTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Estimate timeout')), 3000)
          );
          gasLimit = await Promise.race([estimatePromise, estimateTimeout]);
          // Add 20% buffer for safety
          gasLimit = (gasLimit * 120n) / 100n;
        } catch {
          // Fallback to default ERC-20 gas limit
          gasLimit = 65000n;
        }
      }

      // Calculate estimated cost
      // For EIP-1559, use a more realistic estimate: baseFee + priorityFee
      let effectiveGasPrice: bigint;
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        effectiveGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      } else {
        effectiveGasPrice = feeData.gasPrice || 0n;
      }
      const estimatedCostWei = gasLimit * effectiveGasPrice;

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: feeData.gasPrice?.toString() || '0',
        maxFeePerGas: feeData.maxFeePerGas?.toString() || null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() || null,
        estimatedCostWei: estimatedCostWei.toString(),
        estimatedCostNative: ethers.formatEther(estimatedCostWei),
        nativeSymbol,
        supportsEIP1559: !!feeData.maxFeePerGas,
        network: gasNetwork
      };
    } catch (error: any) {
      console.warn('[getGasEstimate] Error:', error);
      return {
        error: error.message || 'Failed to estimate gas',
        gasLimit: token.type === 'native' ? '21000' : '65000',
        gasPrice: '0',
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        estimatedCostWei: '0',
        estimatedCostNative: '0',
        nativeSymbol,
        supportsEIP1559: false,
        network: gasNetwork
      };
    }
  }

  /**
   * Fetch on-chain metadata for an ERC-20 token.
   * @param address - Token contract address
   * @returns Token metadata
   */
  async getTokenMetadata(address: string): Promise<TokenMetadata> {
    return this.wallet.getTokenMetadata(address);
  }

  /**
   * Get the private key for the current account.
   * Requires password verification.
   */
  getPrivateKey(password: string): string {
    return this.wallet.getPrivateKey(password);
  }

  /**
   * Get the mnemonic (secret recovery phrase) for the wallet.
   * Requires password verification.
   */
  getMnemonic(password: string): string {
    return this.wallet.getMnemonic(password);
  }

  /**
   * Safely read a token registry from storage.
   * @param path - Storage path
   * @returns Token registry or empty object
   * @private
   */
  private safeReadRegistry(path: string): TokenRegistry {
    return this.storage.readJSON<TokenRegistry>(path, {});
  }

  /**
   * Persist custom tokens to storage.
   * @private
   */
  private saveCustomTokens(): void {
    this.storage.writeJSON(this.customTokenPath, this.customTokens);
  }

  /**
   * Get the native token definition for a network.
   * @param networkKey - Network identifier
   * @returns Native token (ETH, MATIC, etc.)
   */
  getNativeToken(networkKey: string): Token {
    const networkConfig = this.config.networks[networkKey] || {};
    const symbol = networkConfig.nativeSymbol || 'ETH';
    const name = networkConfig.nativeName || networkConfig.name || 'Ether';
    const decimals = this.isNetworkBitcoin(networkKey) ? 8 : this.isNetworkSolana(networkKey) ? 9 : 18;
    return {
      symbol,
      type: 'native',
      decimals,
      name,
      address: ''
    };
  }

  /**
   * Get all tokens (native + ERC-20) for a network.
   * Merges built-in and custom tokens, deduplicating by address.
   * 
   * @param networkKey - Network identifier
   * @returns Array of tokens with native first
   */
  getTokensForNetwork(networkKey: string): Token[] {
    // Phase 1: Bitcoin/Solana only support native balances (no ERC-20 / SPL).
    if (this.isNetworkBitcoin(networkKey) || this.isNetworkSolana(networkKey)) {
      return [this.getNativeToken(networkKey)];
    }

    const tokens: Token[] = [];
    const nativeToken = this.getNativeToken(networkKey);

    // Always include native token first
    tokens.push(nativeToken);

    const seenAddresses = new Set<string>();
    const appendToken = (token: Token): void => {
      if (token.type === 'native') {
        return;
      }
      if (!token.address) {
        return;
      }
      const key = token.address.toLowerCase();
      if (seenAddresses.has(key)) {
        return;
      }
      seenAddresses.add(key);
      tokens.push({
        ...token,
        address: token.address.toLowerCase()
      });
    };

    (this.builtInTokens[networkKey] || []).forEach(appendToken);
    (this.customTokens[networkKey] || []).forEach(appendToken);

    return tokens;
  }

  /**
   * Get user-added custom tokens for a network.
   * @param networkKey - Network identifier
   * @returns Array of custom tokens
   */
  getCustomTokens(networkKey: string): Token[] {
    return this.customTokens[networkKey] || [];
  }

  /**
   * Find a token by symbol on a network.
   * @param networkKey - Network identifier
   * @param symbol - Token symbol (case-insensitive)
   * @returns Token if found, undefined otherwise
   */
  findTokenBySymbol(networkKey: string, symbol: string): Token | undefined {
    const tokens = this.getTokensForNetwork(networkKey);
    return tokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
  }

  /**
   * Add or update a custom ERC-20 token for a network.
   * Token is persisted to custom tokens storage.
   * 
   * @param networkKey - Network identifier
   * @param token - Token definition to add
   */
  addCustomToken(networkKey: string, token: Token): void {
    const netConfig = this.config.networks[networkKey];
    if (netConfig && !isEVMNetworkConfig(netConfig)) {
      throw new Error('Custom tokens are only supported on EVM networks');
    }

    if (!this.customTokens[networkKey]) {
      this.customTokens[networkKey] = [];
    }

    const address = token.address?.toLowerCase() || '';
    const existingIndex = this.customTokens[networkKey].findIndex(
      t => t.address?.toLowerCase() === address
    );

    if (existingIndex >= 0) {
      this.customTokens[networkKey][existingIndex] = {
        ...this.customTokens[networkKey][existingIndex],
        ...token,
        address
      };
    } else {
      this.customTokens[networkKey].push({
        ...token,
        address
      });
    }

    this.saveCustomTokens();
  }

  /**
   * Remove a custom token from a network.
   * 
   * @param networkKey - Network identifier
   * @param address - Token contract address to remove
   */
  removeCustomToken(networkKey: string, address: string): void {
    if (!this.customTokens[networkKey]) return;
    this.customTokens[networkKey] = this.customTokens[networkKey].filter(
      t => t.address.toLowerCase() !== address.toLowerCase()
    );
    this.saveCustomTokens();
  }

  /**
   * Switch to a different blockchain network.
   * Optionally persists the change to config file.
   *
   * @param networkKey - Network identifier
   * @param options - Persistence options
   * @param options.persist - Whether to save to config file (default: true)
   */
  async setNetwork(networkKey: string, options: SetNetworkOptions = {}): Promise<void> {
    const persist = options.persist ?? true;
    this.config.network = networkKey;

    const netConfig = this.config.networks[networkKey];
    if (netConfig && isEVMNetworkConfig(netConfig)) {
      await this.wallet.setNetwork(networkKey);
    } else if (this.isNetworkBitcoin(networkKey)) {
      this.bitcoinProvider = getBitcoinProvider(networkKey);
      this.solanaProvider = null;
    } else if (this.isNetworkSolana(networkKey)) {
      this.solanaProvider = this.getSolanaProviderForNetwork(networkKey);
      this.solanaExplorer = this.getSolanaExplorerForNetwork(networkKey);
      this.bitcoinProvider = null;
    }

    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
    if (persist && nodeEnv !== 'test') {
      this.storage.writeJSON(this.configPath, this.config);
    }
  }

  // ============================================================================
  // Solana-Specific Methods (Phase 2: History, Phase 3: Send)
  // ============================================================================

  /**
   * Send SOL to another address.
   * Only works when current network is Solana.
   *
   * @param toAddress - Recipient Solana address (base58)
   * @param amountSol - Amount to send in SOL (e.g., "0.5")
   * @param password - Wallet password to decrypt mnemonic for signing
   * @returns Transaction result with signature and fee
   */
  async sendSolanaTransaction(
    toAddress: string,
    amountSol: string,
    password: string
  ): Promise<SolTransferResult> {
    if (!this.isCurrentNetworkSolana()) {
      throw new Error('Not on a Solana network');
    }

    // Validate recipient address
    if (!isValidSolanaAddress(toAddress)) {
      throw new Error('Invalid Solana recipient address');
    }

    // Get sender info
    const solInfo = this.getSolanaAddress();
    if (!solInfo) {
      throw new Error('No Solana address available');
    }

    // Get mnemonic to derive keypair
    const mnemonic = this.wallet.getMnemonic(password);
    const accountIndex = this.wallet.getCurrentAccountIndex();
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);

    // Get provider for RPC operations
    const provider = this.getSolanaProviderForNetwork(this.config.network);

    // Get current balance
    const balanceLamports = await provider.getBalanceLamports(solInfo.address);

    // Convert amount to lamports
    const amountLamports = solToLamports(amountSol);
    if (amountLamports <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Estimate fee
    const feeEstimate = await provider.estimateFee();
    const feeLamports = feeEstimate.feeLamports;

    // Validate sufficient balance
    validateSufficientBalance(balanceLamports, amountLamports, feeLamports);

    // Get recent blockhash
    const blockhashInfo = await provider.getRecentBlockhash();

    // Build and sign transaction
    const signedTx = buildAndSignSolTransfer(
      {
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amountLamports,
        recentBlockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
      },
      keypair
    );

    // Send transaction
    const sendResult = await provider.sendTransaction(signedTx.serialized);

    return {
      signature: sendResult.signature,
      feeLamports,
      feeSol: lamportsToSol(feeLamports),
    };
  }

  /**
   * Get Solana transaction history for the current address.
   * Only works when current network is Solana.
   *
   * @param limit - Maximum number of transactions to return
   * @returns Array of normalized Solana transactions
   */
  async getSolanaTransactionHistory(limit: number = 25): Promise<NormalizedSolanaTransaction[]> {
    if (!this.isCurrentNetworkSolana()) {
      return [];
    }

    const solInfo = this.getSolanaAddress();
    if (!solInfo) {
      return [];
    }

    return this.getSolanaTransactionHistoryForAddress(solInfo.address, limit);
  }

  /**
   * Get Solana transaction history for a given address on the current Solana network.
   * Only works when current network is Solana.
   */
  async getSolanaTransactionHistoryForAddress(address: string, limit: number = 25): Promise<NormalizedSolanaTransaction[]> {
    if (!this.isCurrentNetworkSolana()) {
      return [];
    }
    const explorer = this.getSolanaExplorerForNetwork(this.config.network);
    return explorer.getTransactionHistory(address, limit);
  }

  // ============================================================================
  // Bitcoin-Specific Methods
  // ============================================================================

  /**
   * Get Bitcoin transaction history for the current address.
   * Only works when current network is Bitcoin.
   *
   * @param limit - Maximum number of transactions to return
   * @returns Array of normalized Bitcoin transactions
   */
  async getBitcoinTransactionHistory(limit: number = 25): Promise<NormalizedBitcoinTransaction[]> {
    if (!this.isCurrentNetworkBitcoin()) {
      return [];
    }

    const btcInfo = this.getBitcoinAddress();
    if (!btcInfo) {
      return [];
    }

    const provider = this.getBitcoinProviderForNetwork(this.config.network);
    return provider.getTransactionHistory(btcInfo.address, limit);
  }

  /**
   * Get block explorer URL for a Bitcoin transaction.
   *
   * @param txid - Transaction ID
   * @returns URL to Mempool.space
   */
  getBitcoinTransactionUrl(txid: string): string {
    const provider = this.getBitcoinProviderForNetwork(this.config.network);
    return provider.getTransactionUrl(txid);
  }

  /**
   * Get block explorer URL for a Bitcoin address.
   *
   * @param address - Bitcoin address (optional, uses current if not provided)
   * @returns URL to Mempool.space
   */
  getBitcoinAddressUrl(address?: string): string {
    const addr = address || this.getBitcoinAddress()?.address;
    if (!addr) {
      return '';
    }
    const provider = this.getBitcoinProviderForNetwork(this.config.network);
    return provider.getAddressUrl(addr);
  }

  /**
   * Get Bitcoin private key in WIF format.
   * Requires password verification.
   *
   * @param password - Master password
   * @returns Private key in WIF format
   */
  getBitcoinPrivateKey(password: string): string {
    const btcNetwork = this.config.network === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    return this.wallet.getBitcoinPrivateKey(password, btcNetwork);
  }

  /**
   * Send a Bitcoin transaction (Native SegWit / P2WPKH).
   *
   * @param toAddress - Recipient bech32 address
   * @param amountBtc - Amount in BTC string
   * @param password - Master password for private key derivation
   * @returns Broadcast transaction ID and fee info
   */
  async sendBitcoinTransaction(
    toAddress: string,
    amountBtc: string,
    password: string
  ): Promise<{ hash: string; feeSats: number; feeBtc: string; vbytes: number }> {
    if (!this.isCurrentNetworkBitcoin()) {
      throw new Error('Not on a Bitcoin network');
    }

    const networkKey = this.config.network;
    const btcNetwork = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    if (!isValidBitcoinAddress(toAddress, btcNetwork)) {
      throw new Error('Invalid Bitcoin recipient address');
    }

    const fromAddress = this.getAddress();
    const wif = this.wallet.getBitcoinPrivateKey(password, btcNetwork);
    const provider = this.getBitcoinProviderForNetwork(networkKey);

    const result = await provider.sendTransaction(fromAddress, toAddress, amountBtc, wif);
    return {
      hash: result.txid,
      feeSats: result.feeSats,
      feeBtc: result.feeBtc,
      vbytes: result.vbytes
    };
  }
}
