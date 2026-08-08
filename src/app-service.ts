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
 * @responsibilities
 * - Coordinate network-specific providers for balances, sends, and history
 * - Normalize token registry usage across EVM and non-EVM networks
 *
 * @security
 * - Uses storage adapters for encrypted wallet data; never logs secrets
 * - Delegates signing to network-specific modules with validated inputs
 *
 * @module app-service
 */

import type { Config, Token, TokenRegistry, TokenMetadata } from './types/index.js';
import { isBitcoinNetworkConfig, isEVMNetworkConfig, isSolanaNetworkConfig, isXRPNetworkConfig, isTonNetworkConfig } from './types/config.js';
import { Wallet, WalletInfo } from './wallet.js';
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
  STAKE_ACCOUNT_SPACE,
  STAKE_SEED_PREFIX,
  MAX_STAKE_SEED_INDEX,
  deriveStakeAccountAddress,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
  buildWithdrawStakeTx,
  signStakeTx,
  parseStakeAccount,
  fetchStakewizValidators,
  type StakePosition,
  type StakewizValidatorEntry,
} from './solana/index.js';
import type {
  StakePositionView,
  ValidatorSummary,
  StakeActionResult,
  StakingCapabilities,
} from './types/staking.js';
import type {
  SwapCapabilities,
  SwapQuoteRequest,
  SwapQuoteView,
  SwapPhase,
  SwapExecuteResult,
  SwapStatusView,
  SwapProviderId,
} from './types/swap.js';
import {
  ONEINCH_NETWORKS,
  MAYAN_NETWORKS,
  toOneInchAddress,
  toMayanAddress,
  classifySwapPair,
} from './swap/chains.js';
import { OneInchClient, resolveOneInchApiKey } from './swap/oneinch.js';
import { MayanClient, type MayanQuote } from './swap/mayan.js';
import {
  sendRawEvmTransaction,
  getErc20Allowance,
  approveErc20,
} from './ethereum/transaction.js';
import { getSolanaPrice } from './price-service.js';
import { pricesAvailableForNetwork } from './network-visibility.js';
import { PublicKey, Keypair } from '@solana/web3.js';
// @ts-ignore
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {
  BitcoinProvider,
  getBitcoinProvider,
  isBitcoinNetwork,
  satoshisToBtc,
  isValidBitcoinAddress,
  type BitcoinAddressInfo,
  type NormalizedBitcoinTransaction,
} from './bitcoin/index.js';
import {
  XRPProvider,
  getXRPProvider,
  isXRPNetwork,
  dropsToXrp,
  isValidXRPAddress,
  type XRPAddressInfo,
  type NormalizedXRPTransaction,
} from './xrp/index.js';
import {
  TonProvider,
  getTonProvider,
  isTonNetwork,
  isValidTonAddress,
  deriveTonKeypair,
  type TonAddressInfo,
  type NormalizedTonTransaction,
} from './ton/index.js';
import { deriveKeypair as deriveXrpKeypair } from 'xrpl';

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

type PrivateKeyChain = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
type PrivateKeyFormat = 'hex' | 'wif' | 'base58' | 'seed' | 'secretKey';

interface PrivateKeyExport {
  privateKey: string;
  format: PrivateKeyFormat;
}

function ensureHexPrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('0x')) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return `0x${trimmed}`;
  }
  return trimmed;
}

function isHexString(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function normalizeSolanaPrivateKey(value: string): string {
  const trimmed = value.trim();
  if (isHexString(trimmed) && (trimmed.length === 64 || trimmed.length === 128)) {
    const bytes = Buffer.from(trimmed, 'hex');
    if (bytes.length === 32) {
      const keypair = Keypair.fromSeed(bytes);
      return bs58.encode(keypair.secretKey);
    }
    if (bytes.length === 64) {
      return bs58.encode(bytes);
    }
    throw new Error('Invalid Solana private key length');
  }
  return trimmed;
}

/**
 * Options for network switching behavior.
 */
interface SetNetworkOptions {
  /** Whether to persist the network change to config file (default: true) */
  persist?: boolean;
}

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
  /** XRP provider for XRP Ledger operations */
  private xrpProvider: XRPProvider | null = null;
  /** TON provider for TON network operations */
  private tonProvider: TonProvider | null = null;
  /** Injected swap clients (test seam); lazily defaulted when absent */
  private injectedSwapClients?: { oneinch?: OneInchClient; mayan?: MayanClient };
  /** Lazily constructed default 1inch client (requires ONEINCH_API_KEY) */
  private defaultOneInchClient: OneInchClient | null = null;
  /** Lazily constructed default Mayan client (keyless) */
  private defaultMayanClient: MayanClient | null = null;

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
      swapClients?: { oneinch?: OneInchClient; mayan?: MayanClient };
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
    this.injectedSwapClients = options.swapClients;
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
   * Check if the current network is an XRP Ledger network.
   */
  isCurrentNetworkXRP(): boolean {
    return isXRPNetwork(this.config.network);
  }

  /**
   * Check if a specific network is an XRP Ledger network.
   */
  isNetworkXRP(networkKey: string): boolean {
    return isXRPNetwork(networkKey);
  }

  /**
   * Get or create the XRP provider for a network.
   * @private
   */
  private getXRPProviderForNetwork(networkKey: string): XRPProvider {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig || !isXRPNetworkConfig(netConfig)) {
      throw new Error('Not an XRP network');
    }

    // Get RPC URLs from config or use defaults
    const rpcUrls = netConfig.wsUrl
      ? (Array.isArray(netConfig.wsUrl) ? netConfig.wsUrl : [netConfig.wsUrl])
      : undefined;

    if (!this.xrpProvider || this.xrpProvider.getNetworkKey() !== networkKey) {
      this.xrpProvider = getXRPProvider(networkKey, rpcUrls);
    }

    return this.xrpProvider;
  }

  /**
   * Get the XRP address for the current account.
   */
  getXRPAddress(): XRPAddressInfo | null {
    if (!this.isCurrentNetworkXRP()) {
      return null;
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();

    try {
      return this.wallet.getXRPAddress(accountIndex);
    } catch (error) {
      console.warn('[WalletAppService] Failed to get XRP address:', error);
      return null;
    }
  }

  /**
   * Check if the current network is a TON network.
   */
  isCurrentNetworkTon(): boolean {
    return isTonNetwork(this.config.network);
  }

  /**
   * Check if a specific network is a TON network.
   */
  isNetworkTon(networkKey: string): boolean {
    return isTonNetwork(networkKey);
  }

  /**
   * Get or create the TON provider for a network.
   * @private
   */
  private getTonProviderForNetwork(networkKey: string): TonProvider {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig || !isTonNetworkConfig(netConfig)) {
      throw new Error('Not a TON network');
    }

    const rpcUrls = Array.isArray(netConfig.rpcUrl) ? netConfig.rpcUrl : [netConfig.rpcUrl];
    const endpoint = rpcUrls[0];

    if (!this.tonProvider || this.tonProvider.getNetworkKey() !== networkKey) {
      this.tonProvider = getTonProvider({
        network: netConfig.tonNetwork,
        networkKey,
        endpoint,
        apiKey: netConfig.rpcApiKey,
        nativeSymbol: netConfig.nativeSymbol,
        nativeName: netConfig.nativeName,
        blockExplorer: netConfig.blockExplorer,
      });
    }

    return this.tonProvider;
  }

  /**
   * Get the TON address for the current account.
   */
  getTonAddress(): TonAddressInfo | null {
    if (!this.isCurrentNetworkTon()) {
      return null;
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();

    try {
      return this.wallet.getTonAddress(accountIndex);
    } catch (error) {
      console.warn('[WalletAppService] Failed to get TON address:', error);
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
   * Import a wallet from a raw private key.
   * 
   * @param key - Raw private key string (format depends on chain type)
   * @param type - Chain family ('evm', 'solana', 'bitcoin', 'xrp', 'ton')
   * @param password - Master password for encryption
   * @returns Wallet info
   */
  importFromPrivateKey(key: string, type: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton', password: string): WalletInfo {
    return this.wallet.importFromPrivateKey(key, type, password);
  }

  /**
   * Load and decrypt a wallet from storage (synchronous).
   * @param walletName - Name of saved wallet
   * @param password - Master password
   * @param accountIndex - Optional account index override
   * @returns Wallet info or null if not found
   * @deprecated Use loadWalletAsync() for better performance in React Native
   */
  loadWallet(walletName: string, password: string, accountIndex: number | null = null): WalletInfo | null {
    return this.wallet.loadWallet(walletName, password, accountIndex);
  }

  /**
   * Load and decrypt a wallet from storage (asynchronous).
   * Uses native crypto when available for fast PBKDF2 key derivation.
   * @param walletName - Name of saved wallet
   * @param password - Master password
   * @param accountIndex - Optional account index override
   * @returns Promise resolving to wallet info or null if not found
   */
  async loadWalletAsync(walletName: string, password: string, accountIndex: number | null = null): Promise<WalletInfo | null> {
    return this.wallet.loadWalletAsync(walletName, password, accountIndex);
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
   * Change the master password for a stored wallet.
   *
   * @param walletName - Name of wallet to update
   * @param currentPassword - Current master password
   * @param newPassword - New master password
   */
  changePassword(walletName: string, currentPassword: string, newPassword: string): void {
    this.wallet.changePassword(walletName, currentPassword, newPassword);
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
   * Returns the appropriate address for the current network (EVM, Bitcoin, Solana, XRP, or TON).
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
    if (this.isCurrentNetworkXRP()) {
      const xrpInfo = this.getXRPAddress();
      return xrpInfo?.address || '';
    }
    if (this.isCurrentNetworkTon()) {
      const tonInfo = this.getTonAddress();
      return tonInfo?.address || '';
    }
    return this.wallet.getAddress();
  }

  /**
   * Derive the receive address for a given chain group without switching
   * the active network. Used by the Receive screen's chain picker.
   *
   * Returns null when the wallet can't satisfy the request (e.g. a private-key
   * import whose `privateKeyType` doesn't match the requested chain).
   *
   * @param chain - Target chain group
   * @returns Address string, or null if unsupported for this wallet
   */
  getAddressForChain(chain: PrivateKeyChain): string | null {
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== chain
    ) {
      return null;
    }

    const idx = this.wallet.getCurrentAccountIndex();
    try {
      switch (chain) {
        case 'evm':
          return this.wallet.getAccountAddress(idx);
        case 'solana':
          return this.wallet.getSolanaAddress(idx)?.address ?? null;
        case 'bitcoin': {
          const btcNet = this.config.network === 'bitcoin-testnet' ? 'testnet' : 'mainnet';
          return this.wallet.getBitcoinAddress(btcNet, idx)?.address ?? null;
        }
        case 'xrp':
          return this.wallet.getXRPAddress(idx)?.address ?? null;
        case 'ton':
          return this.wallet.getTonAddress(idx)?.address ?? null;
      }
    } catch (error) {
      console.warn(`[WalletAppService] Failed to derive ${chain} address:`, error);
      return null;
    }
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
   * @returns Balance in native currency (ETH for EVM, BTC for Bitcoin, SOL for Solana, XRP for XRP Ledger, TON for TON)
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
    if (this.isCurrentNetworkXRP()) {
      const xrpInfo = this.getXRPAddress();
      if (!xrpInfo) {
        return '0';
      }
      const provider = this.getXRPProviderForNetwork(this.config.network);
      return provider.getBalanceFormatted(xrpInfo.address);
    }
    if (this.isCurrentNetworkTon()) {
      const tonInfo = this.getTonAddress();
      if (!tonInfo) {
        return '0';
      }
      const provider = this.getTonProviderForNetwork(this.config.network);
      return provider.getBalanceFormatted(tonInfo.address);
    }
    return this.wallet.getBalance();
  }

  /**
   * Get portfolio balances for all tokens on a network.
   * @param networkKey - Network identifier
   * @returns Array of token balances
   */
  async getPortfolioForNetwork(networkKey: string): Promise<Array<{
    token: Token;
    balance: string;
    error?: string;
    // Non-EVM networks may expose additional metadata (UI can ignore if unused).
    availableBalance?: string;
    reservedBalance?: string;
    isActivated?: boolean;
  }>> {
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
        const tokens = this.getTokensForNetwork(networkKey);
        const results: Array<{ token: Token; balance: string; error?: string }> = [];

        for (const token of tokens) {
          try {
            if (token.type === 'native') {
              const balance = await provider.getBalanceFormatted(solInfo.address);
              results.push({ token, balance });
              continue;
            }

            if (token.type === 'spl' && token.address) {
              const balance = await provider.getSplTokenBalanceFormatted(
                solInfo.address,
                token.address,
                token.decimals
              );
              results.push({ token, balance });
              continue;
            }
          } catch (tokenError) {
            results.push({
              token,
              balance: 'Error',
              error: (tokenError as Error).message
            });
          }
        }

        return results;
      } catch (error) {
        return [{
          token: this.getNativeToken(networkKey),
          balance: 'Error',
          error: (error as Error).message,
        }];
      }
    }

    // Handle XRP Ledger networks
    if (this.isNetworkXRP(networkKey)) {
      try {
        const xrpInfo = this.wallet.getXRPAddress(this.wallet.getCurrentAccountIndex());
        const provider = this.getXRPProviderForNetwork(networkKey);
        const portfolio = await provider.getPortfolio(xrpInfo.address);
        return portfolio.map(p => ({
          token: p.token,
          balance: p.balance,
          availableBalance: p.availableBalance,
          reservedBalance: p.reservedBalance,
          isActivated: p.isActivated,
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

    // Handle TON networks
    if (this.isNetworkTon(networkKey)) {
      try {
        const tonInfo = this.wallet.getTonAddress(this.wallet.getCurrentAccountIndex());
        const provider = this.getTonProviderForNetwork(networkKey);
        const portfolio = await provider.getPortfolio(tonInfo.address);
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

    // EVM networks
    const tokens = this.getTokensForNetwork(networkKey);
    return this.wallet.ethereumProvider.getPortfolioForNetwork(tokens, this.wallet.getAddress(), networkKey);
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
   * Send a token or native currency on an EVM network.
   *
   * When `networkKey` is omitted, the currently active network is used. When it
   * is provided and refers to an EVM network other than the active one, we
   * route the send through a provider connected to that network without
   * mutating the wallet's active-network state.
   *
   * @param token - Token to send
   * @param toAddress - Recipient address
   * @param amount - Amount to send
   * @param networkKey - Optional EVM network to send on; defaults to active
   * @returns Transaction receipt
   * @throws If `networkKey` refers to a non-EVM chain or private-key import
   */
  async sendToken(
    token: Token,
    toAddress: string,
    amount: string,
    networkKey?: string
  ): Promise<{ hash: string; blockNumber: number; gasUsed: string }> {
    if (networkKey && networkKey !== this.config.network) {
      this.assertEvmNetworkForWallet(networkKey);
      return this.wallet.sendTokenOnNetwork(token, toAddress, amount, networkKey);
    }
    return this.wallet.sendToken(token, toAddress, amount);
  }

  /**
   * Guard: reject when the requested network isn't a valid EVM target for
   * this wallet. Shared between sendToken and getGasEstimate.
   * @private
   */
  private assertEvmNetworkForWallet(networkKey: string): void {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig) {
      throw new Error(`Unknown network: ${networkKey}`);
    }
    const type = (netConfig as { type?: string }).type;
    if (type && type !== 'evm') {
      throw new Error(`Network ${networkKey} is not an EVM network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'evm'
    ) {
      throw new Error('This wallet does not support EVM sends');
    }
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
  async getGasEstimate(
    token: Token,
    toAddress: string,
    amount: string,
    networkKey?: string
  ): Promise<GasEstimate> {
    const effective = networkKey ?? this.config.network;
    // Bitcoin networks: estimate fee using Mempool fee rates and UTXO selection.
    if (this.isNetworkBitcoin(effective)) {
      const networkKey = effective;
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

    // Solana networks: fee = base (getFeeForMessage) + priority (CU price ×
    // CU limit). When the recipient/amount are known we pass them through so
    // the provider can build a dry-run message and sample real on-chain
    // prioritization fees; otherwise it falls back to the 5000-lamport
    // constant. The EIP-1559-shaped return fields are repurposed to carry the
    // priority-fee breakdown so UIs that already format
    // maxPriorityFeePerGas can show the Solana priority component too.
    if (this.isNetworkSolana(effective)) {
      const networkKey = effective;
      const netConfig = this.config.networks[networkKey];
      const nativeSymbol = netConfig?.nativeSymbol || 'SOL';

      try {
        const provider = this.getSolanaProviderForNetwork(networkKey);

        // Only plumb params when we actually have a valid recipient + amount.
        // An empty address/amount during the initial render should still get
        // a cheap base-fee-only quote.
        const fromAddress = this.getAddress();
        let lamportsFromAmount = 0;
        if (amount && /^\d+(\.\d+)?$/.test(amount.trim())) {
          // Defer to the same solToLamports routine the send path uses so the
          // estimate and the send can't disagree on rounding.
          try {
            lamportsFromAmount = solToLamports(amount.trim());
          } catch {
            lamportsFromAmount = 0;
          }
        }
        const estimateParams =
          toAddress && fromAddress && lamportsFromAmount > 0
            ? { fromAddress, toAddress, lamports: lamportsFromAmount }
            : undefined;

        const feeEstimate = await provider.estimateFee(estimateParams);

        return {
          gasLimit: (feeEstimate.computeUnitLimit || 1).toString(),
          gasPrice: feeEstimate.feeLamports.toString(), // lamports total (kept for backward compatibility)
          maxFeePerGas: feeEstimate.feeLamports.toString(),
          maxPriorityFeePerGas: feeEstimate.priorityFeeMicroLamports
            ? feeEstimate.priorityFeeMicroLamports.toString()
            : null,
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

    // XRP Ledger networks: estimate fee using XRP Ledger fee API
    if (this.isNetworkXRP(effective)) {
      const networkKey = effective;
      const netConfig = this.config.networks[networkKey];
      const nativeSymbol = netConfig?.nativeSymbol || 'XRP';

      try {
        const provider = this.getXRPProviderForNetwork(networkKey);
        const feeEstimate = await provider.getFeeEstimates();

        return {
          gasLimit: '1', // 1 transaction
          gasPrice: feeEstimate.openLedgerFee.toString(), // drops
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: feeEstimate.openLedgerFee.toString(), // drops
          estimatedCostNative: dropsToXrp(feeEstimate.openLedgerFee),
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      } catch (error: any) {
        return {
          error: error.message || 'Failed to estimate XRP fee',
          gasLimit: '1',
          gasPrice: '12', // Base fee fallback (12 drops)
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: '12',
          estimatedCostNative: '0.000012',
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey
        };
      }
    }

    // TON networks: estimate fee via Toncenter (best-effort)
    if (this.isNetworkTon(effective)) {
      const networkKey = effective;
      const netConfig = this.config.networks[networkKey];
      const nativeSymbol = netConfig?.nativeSymbol || 'TON';

      try {
        const provider = this.getTonProviderForNetwork(networkKey);
        const mnemonic = this.wallet.mnemonic;
        const accountIndex = this.wallet.getCurrentAccountIndex();
        const feeEstimate = await provider.estimateFee(toAddress, amount, mnemonic || undefined, accountIndex);

        return {
          gasLimit: '1',
          gasPrice: feeEstimate.feeNano,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: feeEstimate.feeNano,
          estimatedCostNative: feeEstimate.feeTon,
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey,
        };
      } catch (error: any) {
        return {
          error: error.message || 'Failed to estimate TON fee',
          gasLimit: '1',
          gasPrice: '0',
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          estimatedCostWei: '0',
          estimatedCostNative: '0',
          nativeSymbol,
          supportsEIP1559: false,
          network: networkKey,
        };
      }
    }

    // EVM path — always resolve the provider by the target network key rather
    // than reading `wallet.provider`. `wallet.provider` is backed by
    // `EthereumProvider.this.provider`, which is mutated by every
    // `ensureProvider(...)` call across the class (including unified
    // portfolio refreshes). Reading it here races: if a cross-chain portfolio
    // refresh has parked a different chain's provider in that slot, gas
    // estimation would run against the wrong network and, for chainId 137,
    // trigger ethers' built-in Polygon gas-station plugin — causing the
    // baffling "polygon gas station" SERVER_ERROR during sepolia sends.
    // `ensureProvider` is cached per-networkKey so this is cheap.
    const gasNetwork = effective;
    const gasNetworkConfig = this.config.networks[gasNetwork];
    const nativeSymbol = gasNetworkConfig?.nativeSymbol || 'ETH';
    let provider: ethers.JsonRpcProvider | null;
    try {
      provider = await this.wallet.ethereumProvider.ensureProvider(gasNetwork);
    } catch (err: any) {
      return {
        error: err?.message || `No provider for ${gasNetwork}`,
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
      // When estimating for a non-active EVM network the wallet.getAddress()
      // returns the active-network address. For EVM that's the same key
      // material / same 0x address anyway, so this is fine.
      const fromAddress = this.wallet.getAccountAddress(this.wallet.getCurrentAccountIndex());

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
    } finally {
      // `ensureProvider(gasNetwork)` above mutated EthereumProvider's shared
      // `this.provider` pointer as a side effect. If the gas estimate ran
      // against a different chain than the active one, restore the pointer so
      // later callers that still read `wallet.provider` (sendToken, balance
      // reads, etc.) don't find the wrong chain parked there. Best-effort and
      // cheap — the active-network provider is cached.
      if (gasNetwork !== this.config.network) {
        try {
          const activeConfig = this.config.networks[this.config.network];
          // Only restore if the active network is EVM — ensureProvider throws
          // on non-EVM networks and there's nothing to restore for them.
          const activeType = (activeConfig as { type?: string })?.type;
          if (!activeType || activeType === 'evm') {
            await this.wallet.ethereumProvider.ensureProvider(this.config.network);
          }
        } catch {
          // Best-effort restore.
        }
      }
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
   * Get a chain-specific private key for the current account.
   * Requires password verification.
   */
  getPrivateKeyForChain(
    chainType: PrivateKeyChain,
    password: string,
    options: { networkKey?: string; format?: PrivateKeyFormat } = {}
  ): PrivateKeyExport {
    if (this.wallet.importType === 'privateKey' && this.wallet.privateKeyType && this.wallet.privateKeyType !== chainType) {
      throw new Error('This wallet does not support the selected chain');
    }

    switch (chainType) {
      case 'evm': {
        if (options.format && options.format !== 'hex') {
          throw new Error('Unsupported EVM private key format');
        }
        const privateKey = ensureHexPrefix(this.wallet.getPrivateKey(password));
        return { privateKey, format: 'hex' };
      }
      case 'bitcoin': {
        if (options.format && options.format !== 'wif') {
          throw new Error('Unsupported Bitcoin private key format');
        }
        const networkKey = options.networkKey ?? this.config.network;
        const privateKey = this.getBitcoinPrivateKey(password, networkKey);
        return { privateKey, format: 'wif' };
      }
      case 'solana': {
        if (options.format && options.format !== 'base58') {
          throw new Error('Unsupported Solana private key format');
        }
        if (this.wallet.importType === 'privateKey') {
          const rawKey = this.wallet.getPrivateKey(password);
          return { privateKey: normalizeSolanaPrivateKey(rawKey), format: 'base58' };
        }
        const mnemonic = this.wallet.getMnemonic(password);
        const accountIndex = this.wallet.getCurrentAccountIndex();
        const keypair = deriveSolanaKeypair(mnemonic, accountIndex);
        return { privateKey: bs58.encode(keypair.secretKey), format: 'base58' };
      }
      case 'xrp': {
        if (options.format && options.format !== 'hex' && options.format !== 'seed') {
          throw new Error('Unsupported XRP private key format');
        }
        if (this.wallet.importType === 'privateKey') {
          const rawKey = this.wallet.getPrivateKey(password).trim();
          const isSeed = rawKey.startsWith('s');
          const requestedFormat = options.format ?? (isSeed ? 'seed' : 'hex');
          if (requestedFormat === 'seed') {
            if (!isSeed) {
              throw new Error('XRP seed not available for this wallet');
            }
            return { privateKey: rawKey, format: 'seed' };
          }
          if (isSeed) {
            const keypair = deriveXrpKeypair(rawKey);
            return { privateKey: keypair.privateKey.toUpperCase(), format: 'hex' };
          }
          return { privateKey: rawKey.toUpperCase(), format: 'hex' };
        }
        if (options.format === 'seed') {
          throw new Error('XRP seed not available for this wallet');
        }
        const privateKey = this.wallet.getXRPPrivateKey(password);
        return { privateKey, format: 'hex' };
      }
      case 'ton': {
        const requestedFormat = options.format;
        if (requestedFormat && requestedFormat !== 'seed' && requestedFormat !== 'secretKey') {
          throw new Error('Unsupported TON private key format');
        }
        if (this.wallet.importType === 'privateKey') {
          const rawKey = this.wallet.getPrivateKey(password).trim();
          if (!isHexString(rawKey)) {
            throw new Error('Invalid TON private key format');
          }
          if (rawKey.length !== 64 && rawKey.length !== 128) {
            throw new Error('Invalid TON private key length');
          }
          if (requestedFormat === 'secretKey') {
            if (rawKey.length === 128) {
              return { privateKey: rawKey, format: 'secretKey' };
            }
            const seedBytes = Buffer.from(rawKey, 'hex');
            const keypair = nacl.sign.keyPair.fromSeed(seedBytes);
            return { privateKey: bytesToHex(keypair.secretKey), format: 'secretKey' };
          }
          if (requestedFormat === 'seed') {
            if (rawKey.length === 64) {
              return { privateKey: rawKey, format: 'seed' };
            }
            return { privateKey: rawKey.slice(0, 64), format: 'seed' };
          }
          const format = rawKey.length === 64 ? 'seed' : 'secretKey';
          return { privateKey: rawKey, format };
        }
        const mnemonic = this.wallet.getMnemonic(password);
        const accountIndex = this.wallet.getCurrentAccountIndex();
        const keypair = deriveTonKeypair(mnemonic, accountIndex);
        const secretKeyHex = bytesToHex(keypair.secretKey);
        const seedHex = bytesToHex(keypair.secretKey.slice(0, 32));
        const format = requestedFormat ?? 'seed';
        return {
          privateKey: format === 'secretKey' ? secretKeyHex : seedHex,
          format
        };
      }
      default:
        throw new Error('Unsupported chain type');
    }
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
    const decimals = this.isNetworkBitcoin(networkKey)
      ? 8
      : this.isNetworkSolana(networkKey)
        ? 9
        : this.isNetworkXRP(networkKey)
          ? 6
          : this.isNetworkTon(networkKey)
            ? 9
            : 18;
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
    // Phase 1: Bitcoin/TON only support native balances (no tokens).
    if (this.isNetworkBitcoin(networkKey) || this.isNetworkTon(networkKey)) {
      return [this.getNativeToken(networkKey)];
    }

    const tokens: Token[] = [];
    const nativeToken = this.getNativeToken(networkKey);
    const defaultTokenType = this.isNetworkSolana(networkKey) ? 'spl' : 'erc20';

    // Always include native token first
    tokens.push(nativeToken);

    const seenAddresses = new Set<string>();
    const appendToken = (token: any): void => {
      if (token.type === 'native') {
        return;
      }
      if (!token.address) {
        return;
      }
      const normalizedAddress =
        token.type === 'spl' || this.isNetworkSolana(networkKey)
          ? token.address
          : token.address.toLowerCase();
      const key = normalizedAddress.toLowerCase();
      if (seenAddresses.has(key)) {
        return;
      }
      seenAddresses.add(key);
      tokens.push({
        ...token,
        address: normalizedAddress,
        logoURI: token.logoURI || token.icon, // Map legacy icon
        type: token.type || defaultTokenType, // Default type per network
      } as Token);
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
      this.tonProvider = null;
    } else if (this.isNetworkSolana(networkKey)) {
      this.solanaProvider = this.getSolanaProviderForNetwork(networkKey);
      this.solanaExplorer = this.getSolanaExplorerForNetwork(networkKey);
      this.bitcoinProvider = null;
      this.tonProvider = null;
    } else if (this.isNetworkTon(networkKey)) {
      this.tonProvider = this.getTonProviderForNetwork(networkKey);
      this.bitcoinProvider = null;
      this.solanaProvider = null;
    }

    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
    if (persist && nodeEnv !== 'test') {
      // Persist only the mutable user-state field. Writing the whole in-memory
      // config here was a bug: when `storage` is a real filesystem (CLI), it
      // clobbered the repo-root config.json with substituted rpcUrl values
      // containing the literal Alchemy key — re-introducing a secret-in-git
      // leak. Base network definitions should be loaded from the shipped
      // config.json and merged with this state file at startup.
      const existing = this.storage.readJSON<Record<string, unknown>>(this.configPath, {});
      this.storage.writeJSON(this.configPath, { ...existing, network: this.config.network });
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
   * @param password - Wallet password to decrypt mnemonic/key for signing
   * @returns Transaction result with signature and fee
   */
  async sendSolanaTransaction(
    toAddress: string,
    amountSol: string,
    password: string,
    networkKey?: string
  ): Promise<SolTransferResult> {
    const effectiveNetworkKey = networkKey ?? this.config.network;
    if (!this.isNetworkSolana(effectiveNetworkKey)) {
      throw new Error(`Network ${effectiveNetworkKey} is not a Solana network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'solana'
    ) {
      throw new Error('This wallet does not support Solana sends');
    }

    // Validate recipient address
    if (!isValidSolanaAddress(toAddress)) {
      throw new Error('Invalid Solana recipient address');
    }

    // Sender address derived directly from the wallet so we don't gate on the
    // currently-active network (Receive/Send can target Solana from any chain).
    const accountIndex = this.wallet.getCurrentAccountIndex();
    const solInfo = this.wallet.getSolanaAddress(accountIndex);
    if (!solInfo) {
      throw new Error('No Solana address available');
    }

    let keypair: Keypair;

    if (this.wallet.importType === 'privateKey') {
      const privateKey = this.wallet.getPrivateKey(password);
      if (!privateKey) {
        throw new Error('Failed to decrypt private key');
      }
      // Decode base58 private key
      const secretKey = bs58.decode(privateKey);
      keypair = Keypair.fromSecretKey(secretKey);
    } else {
      // Get mnemonic to derive keypair
      const mnemonic = this.wallet.getMnemonic(password);
      keypair = deriveSolanaKeypair(mnemonic, accountIndex);
    }

    // Get provider for RPC operations on the target Solana network
    const provider = this.getSolanaProviderForNetwork(effectiveNetworkKey);

    // Get current balance
    const balanceLamports = await provider.getBalanceLamports(solInfo.address);

    // Convert amount to lamports
    const amountLamports = solToLamports(amountSol);
    if (amountLamports <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Estimate fee — passes full tx context so the provider can call
    // getFeeForMessage (authoritative base fee) + getRecentPrioritizationFees
    // (priority-fee sample). Fall-back is the flat 5000-lamport base fee.
    const feeEstimate = await provider.estimateFee({
      fromAddress: solInfo.address,
      toAddress,
      lamports: amountLamports,
    });
    const feeLamports = feeEstimate.feeLamports;

    // Validate sufficient balance
    validateSufficientBalance(balanceLamports, amountLamports, feeLamports);

    // Get recent blockhash
    const blockhashInfo = await provider.getRecentBlockhash();

    // Build and sign transaction. Plumb the same priority-fee rate / CU limit
    // the estimate used so the tx we *send* matches the tx we *quoted*.
    const signedTx = buildAndSignSolTransfer(
      {
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amountLamports,
        recentBlockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
        priorityFeeMicroLamports: feeEstimate.priorityFeeMicroLamports || undefined,
        computeUnitLimit: feeEstimate.computeUnitLimit || undefined,
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
   * Send an SPL token on Solana.
   * Only works when current network is Solana.
   *
   * @param token - SPL token to send
   * @param toAddress - Recipient Solana address (base58)
   * @param amount - Amount to send in display units (token decimals)
   * @param password - Wallet password to decrypt mnemonic/key for signing
   * @returns Transaction result with signature and fee
   */
  async sendSolanaTokenTransaction(
    token: Token,
    toAddress: string,
    amount: string,
    password: string,
    networkKey?: string
  ): Promise<SolTransferResult> {
    const effectiveNetworkKey = networkKey ?? this.config.network;
    if (!this.isNetworkSolana(effectiveNetworkKey)) {
      throw new Error(`Network ${effectiveNetworkKey} is not a Solana network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'solana'
    ) {
      throw new Error('This wallet does not support Solana sends');
    }

    if (token.type !== 'spl' || !token.address) {
      throw new Error('Invalid SPL token');
    }
    if (typeof token.decimals !== 'number') {
      throw new Error('SPL token decimals missing');
    }

    if (!isValidSolanaAddress(toAddress)) {
      throw new Error('Invalid Solana recipient address');
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();
    const solInfo = this.wallet.getSolanaAddress(accountIndex);
    if (!solInfo) {
      throw new Error('No Solana address available');
    }

    let keypair: Keypair;

    if (this.wallet.importType === 'privateKey') {
      const privateKey = this.wallet.getPrivateKey(password);
      if (!privateKey) {
        throw new Error('Failed to decrypt private key');
      }
      const secretKey = bs58.decode(privateKey);
      keypair = Keypair.fromSecretKey(secretKey);
    } else {
      const mnemonic = this.wallet.getMnemonic(password);
      keypair = deriveSolanaKeypair(mnemonic, accountIndex);
    }

    const provider = this.getSolanaProviderForNetwork(effectiveNetworkKey);
    const result = await provider.sendSplTokenTransfer(
      keypair,
      toAddress,
      token.address,
      amount,
      token.decimals
    );

    return {
      signature: result.signature,
      feeLamports: result.feeLamports,
      feeSol: result.feeSol
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
    const solHistory = await explorer.getTransactionHistory(address, limit);
    const tokens = this.getTokensForNetwork(this.config.network)
      .filter((token) => token.type === 'spl' && token.address);

    if (!tokens.length) {
      return solHistory;
    }

    const tokenHistories = await Promise.all(tokens.map((token) =>
      explorer.getTokenTransactionHistory(
        address,
        token.address!,
        token.symbol,
        token.decimals,
        limit
      )
    ));

    const merged = [...solHistory, ...tokenHistories.flat()];
    merged.sort((a, b) => b.timestamp - a.timestamp);
    return merged.slice(0, limit);
  }

  // ============================================================================
  // Staking — chain-neutral API + Solana implementation
  // ============================================================================
  //
  // UIs call ONLY the generic methods (isStakingSupported, getStakePositions,
  // getStakeValidators, stake, unstake, withdrawStake); they dispatch on the
  // network type. Adding staking for another chain (e.g. Ethereum LSTs) means
  // adding a dispatch branch + implementation here — no UI changes.

  /** Minimum delegated stake enforced by this wallet (0.01 SOL), in lamports. */
  private static readonly MIN_SOLANA_STAKE_LAMPORTS = 10_000_000;

  /** In-memory Stakewiz cache — metadata only, refreshed at most every 10 min. */
  private stakewizCache: { fetchedAt: number; map: Map<string, StakewizValidatorEntry> } | null = null;

  /**
   * Whether staking is available on a network.
   *
   * @param networkKey - Network to check; defaults to the active network
   * @returns True when this service can stake on the network (Solana today)
   */
  isStakingSupported(networkKey?: string): boolean {
    const key = networkKey ?? this.config.network;
    const netConfig = this.config.networks[key];
    return !!netConfig && isSolanaNetworkConfig(netConfig);
  }

  /**
   * Chain-specific staking semantics for UI copy and button gating.
   *
   * @param networkKey - Network to describe; defaults to the active network
   * @throws Error when staking is unsupported on the network
   */
  getStakingCapabilities(networkKey?: string): StakingCapabilities {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return {
      canStake: true,
      canUnstake: true,
      canWithdraw: true,
      minStakeFormatted: '0.01',
      activationNote:
        'Stake activates at the next epoch boundary (~2-3 days on mainnet) and starts earning after that.',
      deactivationNote:
        'Unstaking completes at the next epoch boundary; funds become withdrawable after that.',
    };
  }

  /**
   * List the wallet's staking positions on a network.
   *
   * @param networkKey - Network to query; defaults to the active network
   * @returns Chain-neutral position views (empty when the wallet has none)
   * @throws Error when staking is unsupported on the network
   * @async
   */
  async getStakePositions(networkKey?: string): Promise<StakePositionView[]> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return this.getSolanaStakePositions(key);
  }

  /**
   * List validators available to stake with on a network, sorted by activated
   * stake descending (delinquent validators last).
   *
   * @param networkKey - Network to query; defaults to the active network
   * @param limit - Maximum validators to return (default 30)
   * @throws Error when staking is unsupported on the network
   * @async
   */
  async getStakeValidators(networkKey?: string, limit: number = 30): Promise<ValidatorSummary[]> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return this.getSolanaValidators(key, limit);
  }

  /**
   * Stake native tokens with a validator.
   *
   * @param validatorId - Opaque validator id (Solana: vote-account pubkey)
   * @param amount - Amount to stake in native units (e.g. "1.5")
   * @param password - Wallet password for signing
   * @param networkKey - Target network; defaults to the active network
   * @throws Error when staking is unsupported on the network
   * @async
   */
  async stake(
    validatorId: string,
    amount: string,
    password: string,
    networkKey?: string
  ): Promise<StakeActionResult> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return this.stakeSolana(validatorId, amount, password, key);
  }

  /**
   * Begin unstaking a position (starts the cooldown).
   *
   * @param positionId - Opaque position id (Solana: stake-account address)
   * @param password - Wallet password for signing
   * @param networkKey - Target network; defaults to the active network
   * @throws Error when staking is unsupported on the network
   * @async
   */
  async unstake(positionId: string, password: string, networkKey?: string): Promise<StakeActionResult> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return this.deactivateSolanaStake(positionId, password, key);
  }

  /**
   * Withdraw a fully deactivated position back to the wallet. v1 withdraws
   * the full balance (closing the position and returning the reserve).
   *
   * @param positionId - Opaque position id (Solana: stake-account address)
   * @param password - Wallet password for signing
   * @param networkKey - Target network; defaults to the active network
   * @throws Error when staking is unsupported on the network
   * @async
   */
  async withdrawStake(positionId: string, password: string, networkKey?: string): Promise<StakeActionResult> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    return this.withdrawSolanaStake(positionId, password, key);
  }

  /**
   * Estimate the network fee for a staking action, formatted in native units.
   * Best-effort — falls back to the protocol base fee.
   *
   * @param networkKey - Target network; defaults to the active network
   * @async
   */
  async estimateStakeFee(networkKey?: string): Promise<string> {
    const key = networkKey ?? this.config.network;
    this.assertStakingSupported(key);
    const provider = this.getSolanaProviderForNetwork(key);
    const estimate = await provider.estimateFee();
    return estimate.feeSol;
  }

  private assertStakingSupported(networkKey: string): void {
    if (!this.isStakingSupported(networkKey)) {
      throw new Error(`Staking is not supported on ${networkKey}`);
    }
  }

  // ---- Solana implementation --------------------------------------------

  /**
   * Derive the wallet's Solana signing keypair. Mirrors the derivation used
   * by sendSolanaTransaction: bs58 secret key for private-key imports,
   * SLIP-10 mnemonic derivation otherwise.
   *
   * @security The keypair lives only in the caller's frame; never stored.
   */
  private getSolanaSigningKeypair(password: string): Keypair {
    if (this.wallet.importType === 'privateKey') {
      const privateKey = this.wallet.getPrivateKey(password);
      if (!privateKey) {
        throw new Error('Failed to decrypt private key');
      }
      return Keypair.fromSecretKey(bs58.decode(privateKey));
    }
    const mnemonic = this.wallet.getMnemonic(password);
    return deriveSolanaKeypair(mnemonic, this.wallet.getCurrentAccountIndex());
  }

  private assertSolanaStakingWallet(): void {
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'solana'
    ) {
      throw new Error('This wallet does not support Solana staking');
    }
  }

  /**
   * Stakewiz metadata map, cached for 10 minutes. Testnets have no Stakewiz
   * coverage and always resolve to an empty map; failures also resolve to an
   * empty map (degradation invariant — metadata never blocks staking).
   */
  private async getStakewizMap(networkKey: string): Promise<Map<string, StakewizValidatorEntry>> {
    const netConfig = this.config.networks[networkKey];
    if (!netConfig || netConfig.isTestnet) {
      return new Map();
    }
    const now = Date.now();
    if (this.stakewizCache && now - this.stakewizCache.fetchedAt < 10 * 60 * 1000) {
      return this.stakewizCache.map;
    }
    const map = await fetchStakewizValidators();
    // Don't cache an empty result from an outage — retry on the next call.
    if (map.size > 0) {
      this.stakewizCache = { fetchedAt: now, map };
    }
    return map;
  }

  /** Best-effort SOL price; null on testnets (policy) or provider failure. */
  private async getSolUsdPrice(networkKey: string): Promise<number | null> {
    if (!pricesAvailableForNetwork(this.config.networks[networkKey])) {
      return null;
    }
    try {
      return await getSolanaPrice(networkKey);
    } catch {
      return null;
    }
  }

  private async getSolanaStakePositions(networkKey: string): Promise<StakePositionView[]> {
    const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
    if (!solInfo) {
      return [];
    }

    const provider = this.getSolanaProviderForNetwork(networkKey);
    const [rawAccounts, epochInfo] = await Promise.all([
      provider.getParsedStakeAccountsByWithdrawer(solInfo.address),
      provider.getEpochInfo(),
    ]);

    const positions = rawAccounts
      .map((entry) => parseStakeAccount(entry, epochInfo.epoch))
      .filter((p): p is StakePosition => p !== null);

    if (!positions.length) {
      return [];
    }

    // Rewards are display-only; fallback RPCs may not index them — soft-fail.
    let rewards: Array<number | null> = positions.map(() => null);
    try {
      rewards = await provider.getInflationRewardLamports(
        positions.map((p) => p.stakeAccountAddress)
      );
    } catch {
      // Keep nulls.
    }

    const [price, stakewiz] = await Promise.all([
      this.getSolUsdPrice(networkKey),
      this.getStakewizMap(networkKey),
    ]);

    return positions.map((position, i) => {
      const meta = position.votePubkey ? stakewiz.get(position.votePubkey) : undefined;
      const reward = rewards[i];
      return {
        networkKey,
        chain: 'solana' as const,
        positionId: position.stakeAccountAddress,
        validator: {
          id: position.votePubkey ?? '',
          name: meta?.name ?? null,
          commissionPercent: meta?.commissionPercent ?? null,
          apyPercent: meta?.apyPercent ?? null,
          activatedStakeFormatted: null,
          delinquent: false,
        },
        amountFormatted: lamportsToSol(position.delegatedLamports),
        amountBaseUnits: String(position.delegatedLamports),
        reserveFormatted: lamportsToSol(position.rentExemptReserveLamports),
        totalFormatted: lamportsToSol(position.totalLamports),
        state: position.state,
        activationEpoch: position.activationEpoch,
        deactivationEpoch: position.deactivationEpoch,
        currentEpoch: epochInfo.epoch,
        usdValue:
          price !== null ? (position.totalLamports / 1_000_000_000) * price : undefined,
        lastRewardFormatted:
          typeof reward === 'number' && reward > 0 ? lamportsToSol(reward) : undefined,
      };
    });
  }

  private async getSolanaValidators(networkKey: string, limit: number): Promise<ValidatorSummary[]> {
    const provider = this.getSolanaProviderForNetwork(networkKey);
    const [onChain, stakewiz] = await Promise.all([
      provider.getVoteAccountsSummary(),
      this.getStakewizMap(networkKey),
    ]);

    const merged: Array<ValidatorSummary & { activatedStakeLamports: number; rank: number | null }> =
      onChain.map((v) => {
        const meta = stakewiz.get(v.votePubkey);
        return {
          id: v.votePubkey,
          name: meta?.name ?? null,
          commissionPercent: v.commission,
          apyPercent: meta?.apyPercent ?? null,
          // Whole-SOL display string with thousands separators ("430,800") —
          // not numeric-parseable; UIs render it verbatim.
          activatedStakeFormatted: Math.round(v.activatedStakeLamports / 1_000_000_000).toLocaleString('en-US'),
          delinquent: v.delinquent,
          activatedStakeLamports: v.activatedStakeLamports,
          rank: meta?.rank ?? null,
        };
      });

    // Non-delinquent first, then most stake; Stakewiz rank (1 = best) only
    // breaks exact-stake ties, with the pubkey as a deterministic fallback.
    merged.sort((a, b) => {
      if (a.delinquent !== b.delinquent) return a.delinquent ? 1 : -1;
      if (a.activatedStakeLamports !== b.activatedStakeLamports) {
        return b.activatedStakeLamports - a.activatedStakeLamports;
      }
      if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.id.localeCompare(b.id);
    });

    return merged
      .slice(0, limit)
      .map(({ rank: _rank, activatedStakeLamports: _lamports, ...summary }) => summary);
  }

  private async stakeSolana(
    votePubkey: string,
    amountSol: string,
    password: string,
    networkKey: string
  ): Promise<StakeActionResult> {
    this.assertSolanaStakingWallet();

    let voteKey: PublicKey;
    try {
      voteKey = new PublicKey(votePubkey);
    } catch {
      throw new Error('Invalid validator vote address');
    }

    const amountLamports = solToLamports(amountSol);
    if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
      throw new Error('Stake amount must be greater than 0');
    }
    if (amountLamports < WalletAppService.MIN_SOLANA_STAKE_LAMPORTS) {
      throw new Error(
        `Minimum stake is ${lamportsToSol(WalletAppService.MIN_SOLANA_STAKE_LAMPORTS)} SOL`
      );
    }

    const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
    if (!solInfo) {
      throw new Error('No Solana address available');
    }
    const walletPubkey = new PublicKey(solInfo.address);

    const provider = this.getSolanaProviderForNetwork(networkKey);
    const [rentLamports, feeEstimate, balanceLamports] = await Promise.all([
      provider.getStakeRentExemptLamports(STAKE_ACCOUNT_SPACE),
      provider.estimateFee(),
      provider.getBalanceLamports(solInfo.address),
    ]);

    // The stake account is funded with amount + rent so the *delegated* stake
    // equals what the user asked for; rent comes back on withdraw.
    const fundLamports = amountLamports + rentLamports;
    validateSufficientBalance(balanceLamports, fundLamports, feeEstimate.feeLamports);

    // Find the first free seed-derived address. Collisions (e.g. an account
    // created by an earlier stake) are skipped; the scan is capped to keep
    // worst-case RPC round-trips bounded.
    let seed: string | null = null;
    let stakeAccountPubkey: PublicKey | null = null;
    for (let i = 0; i < MAX_STAKE_SEED_INDEX; i++) {
      const candidateSeed = `${STAKE_SEED_PREFIX}${i}`;
      const candidate = await deriveStakeAccountAddress(walletPubkey, candidateSeed);
      if (!(await provider.accountExists(candidate.toBase58()))) {
        seed = candidateSeed;
        stakeAccountPubkey = candidate;
        break;
      }
    }
    if (!seed || !stakeAccountPubkey) {
      throw new Error('No free stake account slot available');
    }

    const keypair = this.getSolanaSigningKeypair(password);
    const blockhashInfo = await provider.getRecentBlockhash();
    const tx = buildCreateAndDelegateStakeTx({
      walletPubkey,
      stakeAccountPubkey,
      seed,
      lamports: fundLamports,
      votePubkey: voteKey,
      recentBlockhash: blockhashInfo.blockhash,
      lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    });
    const signed = signStakeTx(tx, keypair);
    const sendResult = await provider.sendTransaction(signed.serialized);

    return {
      txId: sendResult.signature,
      positionId: stakeAccountPubkey.toBase58(),
      feeFormatted: feeEstimate.feeSol,
    };
  }

  /**
   * Find a stake position owned by this wallet (withdrawer == wallet).
   * Discovering via the withdrawer scan doubles as the ownership check —
   * a foreign stake account can never appear in the result.
   */
  private async findOwnedStakePosition(
    provider: SolanaProvider,
    walletAddress: string,
    stakeAccountAddress: string
  ): Promise<StakePosition> {
    const [rawAccounts, epochInfo] = await Promise.all([
      provider.getParsedStakeAccountsByWithdrawer(walletAddress),
      provider.getEpochInfo(),
    ]);
    const position = rawAccounts
      .map((entry) => parseStakeAccount(entry, epochInfo.epoch))
      .find((p) => p?.stakeAccountAddress === stakeAccountAddress);
    if (!position) {
      throw new Error('Stake account not found for this wallet');
    }
    return position;
  }

  private async deactivateSolanaStake(
    stakeAccountAddress: string,
    password: string,
    networkKey: string
  ): Promise<StakeActionResult> {
    this.assertSolanaStakingWallet();

    const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
    if (!solInfo) {
      throw new Error('No Solana address available');
    }

    const provider = this.getSolanaProviderForNetwork(networkKey);
    const position = await this.findOwnedStakePosition(provider, solInfo.address, stakeAccountAddress);
    if (position.state !== 'active' && position.state !== 'activating') {
      throw new Error(`Cannot unstake a position in state '${position.state}'`);
    }

    const keypair = this.getSolanaSigningKeypair(password);
    const [feeEstimate, blockhashInfo] = await Promise.all([
      provider.estimateFee(),
      provider.getRecentBlockhash(),
    ]);
    const tx = buildDeactivateStakeTx({
      walletPubkey: keypair.publicKey,
      stakeAccountPubkey: new PublicKey(stakeAccountAddress),
      recentBlockhash: blockhashInfo.blockhash,
      lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    });
    const signed = signStakeTx(tx, keypair);
    const sendResult = await provider.sendTransaction(signed.serialized);

    return {
      txId: sendResult.signature,
      positionId: stakeAccountAddress,
      feeFormatted: feeEstimate.feeSol,
    };
  }

  private async withdrawSolanaStake(
    stakeAccountAddress: string,
    password: string,
    networkKey: string
  ): Promise<StakeActionResult> {
    this.assertSolanaStakingWallet();

    const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
    if (!solInfo) {
      throw new Error('No Solana address available');
    }

    const provider = this.getSolanaProviderForNetwork(networkKey);
    const position = await this.findOwnedStakePosition(provider, solInfo.address, stakeAccountAddress);
    if (position.state !== 'withdrawable') {
      throw new Error(
        `Stake is not withdrawable yet (state: '${position.state}'). ` +
        'Unstake first and wait for the next epoch boundary.'
      );
    }

    const keypair = this.getSolanaSigningKeypair(password);
    const [feeEstimate, blockhashInfo] = await Promise.all([
      provider.estimateFee(),
      provider.getRecentBlockhash(),
    ]);
    // Full-balance withdraw: closes the account and returns the rent reserve.
    const tx = buildWithdrawStakeTx(
      {
        walletPubkey: keypair.publicKey,
        stakeAccountPubkey: new PublicKey(stakeAccountAddress),
        recentBlockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
      },
      position.totalLamports
    );
    const signed = signStakeTx(tx, keypair);
    const sendResult = await provider.sendTransaction(signed.serialized);

    return {
      txId: sendResult.signature,
      positionId: stakeAccountAddress,
      feeFormatted: feeEstimate.feeSol,
    };
  }

  // ============================================================================
  // Swaps — chain-neutral API (1inch same-chain, Mayan cross-chain)
  // ============================================================================
  //
  // UIs call ONLY the generic methods (isSwapSupported, getSwapCapabilities,
  // getSwapQuote, executeSwap, getSwapStatus). Routing is decided by
  // classifySwapPair: same EVM network → 1inch Classic Swap, different
  // networks (EVM↔EVM, EVM↔Solana) → Mayan. Adding a provider or chain means
  // updating src/swap/chains.ts + a dispatch branch here — no UI changes.

  /** How long a quote may be executed after it was fetched. */
  private static readonly SWAP_QUOTE_TTL_MS = 45_000;

  /** Resolve the 1inch client; null when no API key is available. @private */
  private getOneInchClient(): OneInchClient | null {
    if (this.injectedSwapClients?.oneinch) {
      return this.injectedSwapClients.oneinch;
    }
    if (!this.defaultOneInchClient) {
      const apiKey = resolveOneInchApiKey();
      if (!apiKey) {
        return null;
      }
      this.defaultOneInchClient = new OneInchClient({ apiKey });
    }
    return this.defaultOneInchClient;
  }

  /** Resolve the Mayan client (keyless — always available). @private */
  private getMayanClient(): MayanClient {
    if (this.injectedSwapClients?.mayan) {
      return this.injectedSwapClients.mayan;
    }
    if (!this.defaultMayanClient) {
      this.defaultMayanClient = new MayanClient();
    }
    return this.defaultMayanClient;
  }

  /**
   * Whether any swap kind is available with this network as the source.
   * Used by every surface to gate the Swap menu entry / button.
   *
   * @param networkKey - Network to check; defaults to the active network
   */
  isSwapSupported(networkKey?: string): boolean {
    return this.getSwapCapabilities(networkKey).canSwap;
  }

  /**
   * What swapping looks like from a source network: which kinds are
   * available and which destinations are valid. Same-chain capability
   * additionally requires a 1inch API key — without one it degrades to
   * cross-chain-only with an explanatory reason, never a throw.
   *
   * @param networkKey - Source network; defaults to the active network
   */
  getSwapCapabilities(networkKey?: string): SwapCapabilities {
    const key = networkKey ?? this.config.network;
    const netConfig = this.config.networks[key];
    if (!netConfig) {
      return {
        canSwap: false, sameChain: false, crossChain: false,
        destinationNetworkKeys: [],
        unsupportedReason: `Unknown network '${key}'`,
      };
    }
    if (netConfig.isTestnet) {
      return {
        canSwap: false, sameChain: false, crossChain: false,
        destinationNetworkKeys: [],
        unsupportedReason: 'Swaps are not available on test networks',
      };
    }

    const oneInchListed = key in ONEINCH_NETWORKS;
    const hasOneInchKey = this.getOneInchClient() !== null;
    const sameChain = oneInchListed && hasOneInchKey;
    const crossChain = key in MAYAN_NETWORKS;

    if (!sameChain && !crossChain) {
      const label = netConfig.name ?? key;
      return {
        canSwap: false, sameChain: false, crossChain: false,
        destinationNetworkKeys: [],
        unsupportedReason:
          oneInchListed && !hasOneInchKey
            ? 'Same-chain swaps require a 1inch API key (set ONEINCH_API_KEY)'
            : `Swaps are not supported on ${label}`,
      };
    }

    // Destinations: self first (when 1inch serves this network), then every
    // Mayan peer present in this config. Order is the picker's display order.
    const destinations: string[] = [];
    if (sameChain) {
      destinations.push(key);
    }
    if (crossChain) {
      for (const peer of Object.keys(MAYAN_NETWORKS)) {
        if (peer !== key && this.config.networks[peer]) {
          destinations.push(peer);
        }
      }
    }

    return {
      canSwap: true,
      sameChain,
      crossChain,
      destinationNetworkKeys: destinations,
      unsupportedReason:
        oneInchListed && !hasOneInchKey
          ? 'Same-chain swaps require a 1inch API key (set ONEINCH_API_KEY)'
          : undefined,
    };
  }

  /**
   * Price a swap. Routes to 1inch (same EVM network) or Mayan (cross-chain)
   * and returns a display-ready quote. The quote expires (`expiresAt`) —
   * executeSwap refuses stale quotes and the UI must re-quote.
   *
   * @param request - Networks, tokens, amount (human units), slippage
   * @throws Error when the pair is unsupported, the amount is invalid, the
   *   1inch key is missing (same-chain), or the provider finds no route
   * @async
   */
  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuoteView> {
    const slippagePercent = request.slippagePercent ?? 1;
    if (!(slippagePercent > 0) || slippagePercent > 50) {
      throw new Error('Slippage must be between 0 and 50 percent');
    }
    const classification = classifySwapPair(
      request.fromNetworkKey,
      request.toNetworkKey,
      this.config
    );
    if (classification.kind === 'unsupported') {
      throw new Error(classification.reason);
    }

    const amountBaseUnits = this.parseSwapAmount(request.amount, request.fromToken);

    if (classification.kind === 'same-evm') {
      return this.getOneInchSwapQuote(request, classification.chainId, amountBaseUnits, slippagePercent);
    }
    return this.getMayanSwapQuote(request, amountBaseUnits, slippagePercent);
  }

  /**
   * Execute a previously fetched quote.
   *
   * Password asymmetry (mirrors the send methods): EVM sources sign with the
   * in-memory unlocked wallet and take NO password; Solana sources derive the
   * keypair from `options.password` per call — omitting it throws before any
   * network traffic.
   *
   * EVM flow: [allowance check → approve → wait for approval] → submit swap →
   * return WITHOUT waiting for the swap to mine (poll getSwapStatus).
   *
   * @param quote - The quote returned by getSwapQuote (unmodified)
   * @param options.password - Wallet password; required for Solana sources
   * @param options.onProgress - Phase callback for progress UI
   * @throws Error when the quote has expired or prerequisites are missing
   * @async
   */
  async executeSwap(
    quote: SwapQuoteView,
    options: { password?: string; onProgress?: (phase: SwapPhase) => void } = {}
  ): Promise<SwapExecuteResult> {
    if (Date.now() > quote.expiresAt) {
      throw new Error('Quote expired — refresh the quote and try again');
    }
    const request = quote.request;
    const classification = classifySwapPair(
      request.fromNetworkKey,
      request.toNetworkKey,
      this.config
    );
    if (classification.kind === 'unsupported') {
      throw new Error(classification.reason);
    }

    if (classification.kind === 'same-evm') {
      return this.executeOneInchSwap(quote, classification.chainId, options);
    }
    if (this.isNetworkSolana(request.fromNetworkKey)) {
      if (!options.password) {
        throw new Error('Password required for Solana swaps');
      }
      return this.executeMayanSwapFromSolana(quote, options.password, options.onProgress);
    }
    return this.executeMayanSwapFromEvm(quote, options);
  }

  /**
   * Point-in-time status of a submitted swap. Single-shot — polling loops
   * live in the UI surfaces.
   *
   * @param query.provider - Which provider executed the swap
   * @param query.txId - Source-chain tx hash (EVM) or signature (Solana)
   * @param query.fromNetworkKey - Source network (1inch receipt lookups)
   * @async
   */
  async getSwapStatus(query: {
    provider: SwapProviderId;
    txId: string;
    fromNetworkKey: string;
  }): Promise<SwapStatusView> {
    if (query.provider === 'mayan') {
      return this.getMayanClient().getStatus(query.txId);
    }
    // 1inch: the swap is a single source-chain tx — the receipt is the truth.
    try {
      const provider = await this.wallet.ethereumProvider.ensureProvider(query.fromNetworkKey);
      const receipt = await provider.getTransactionReceipt(query.txId);
      if (!receipt) {
        return { state: 'pending' };
      }
      return receipt.status === 1
        ? { state: 'completed', destTxId: query.txId }
        : { state: 'failed', detail: 'Swap transaction reverted' };
    } finally {
      await this.wallet.restoreActiveNetworkProvider();
    }
  }

  // ---- Shared swap helpers ----------------------------------------------

  /** Parse a human-unit amount into base units, validating it. @private */
  private parseSwapAmount(amount: string, token: Token): bigint {
    let baseUnits: bigint;
    try {
      baseUnits = ethers.parseUnits(amount.trim(), token.decimals);
    } catch {
      throw new Error('Invalid swap amount');
    }
    if (baseUnits <= 0n) {
      throw new Error('Swap amount must be greater than 0');
    }
    return baseUnits;
  }

  /** Trim a decimal string for display (max 6 fractional digits). @private */
  private formatSwapAmount(value: string): string {
    const [whole, frac = ''] = value.split('.');
    const trimmedFrac = frac.slice(0, 6).replace(/0+$/, '');
    return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
  }

  /** Display rate line "1 SRC ≈ X DST". @private */
  private formatSwapRate(
    amountIn: string,
    amountOut: string,
    fromSymbol: string,
    toSymbol: string
  ): string {
    const input = Number.parseFloat(amountIn);
    const output = Number.parseFloat(amountOut);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0) {
      return '';
    }
    const rate = output / input;
    const digits = rate >= 1 ? 4 : 6;
    return `1 ${fromSymbol} ≈ ${rate.toFixed(digits)} ${toSymbol}`;
  }

  /**
   * Best-effort EVM fee line from a gas amount and current fee data.
   * Empty string when estimation fails — fees never block quoting.
   * @private
   */
  private async estimateEvmFeeFormatted(networkKey: string, gasUnits: number): Promise<string> {
    try {
      const provider = await this.wallet.ethereumProvider.ensureProvider(networkKey);
      const feeData = await provider.getFeeData();
      const perGas = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (!perGas) {
        return '';
      }
      const cost = ethers.formatEther(perGas * BigInt(gasUnits));
      const nativeSymbol = this.config.networks[networkKey]?.nativeSymbol ?? 'ETH';
      return `~${this.formatSwapAmount(cost)} ${nativeSymbol}`;
    } catch {
      return '';
    } finally {
      await this.wallet.restoreActiveNetworkProvider();
    }
  }

  /**
   * The wallet's own address on a destination network — swaps always deliver
   * to the same wallet in v1.
   * @private
   */
  private resolveSwapDestinationAddress(networkKey: string): string {
    if (this.isNetworkSolana(networkKey)) {
      const info = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
      if (!info?.address) {
        throw new Error('This wallet has no Solana address for the destination chain');
      }
      return info.address;
    }
    return this.getEvmAddress();
  }

  /** The wallet's EVM address, derivable even when the signer is idle. @private */
  private getEvmAddress(): string {
    if (this.wallet.wallet) {
      return this.wallet.wallet.address;
    }
    if (this.wallet.importType === 'mnemonic') {
      return this.wallet._deriveAccount(this.wallet.getCurrentAccountIndex()).address;
    }
    throw new Error('This wallet has no EVM address');
  }

  /**
   * ERC-20 allowance for `spender`, read on-chain. Restores the active
   * provider afterwards. Returns MaxUint for native tokens (no approval).
   * @private
   */
  private async getSwapAllowance(
    networkKey: string,
    token: Token,
    spender: string
  ): Promise<bigint> {
    if (token.address === '') {
      return ethers.MaxUint256;
    }
    try {
      const provider = await this.wallet.ethereumProvider.ensureProvider(networkKey);
      return await getErc20Allowance(provider, token.address, this.getEvmAddress(), spender);
    } finally {
      await this.wallet.restoreActiveNetworkProvider();
    }
  }

  // ---- 1inch (same-chain EVM) -------------------------------------------

  private async getOneInchSwapQuote(
    request: SwapQuoteRequest,
    chainId: number,
    amountBaseUnits: bigint,
    slippagePercent: number
  ): Promise<SwapQuoteView> {
    const client = this.getOneInchClient();
    if (!client) {
      throw new Error('Same-chain swaps require a 1inch API key (set ONEINCH_API_KEY)');
    }
    const src = toOneInchAddress(request.fromToken);
    const dst = toOneInchAddress(request.toToken);
    const quote = await client.getQuote(chainId, src, dst, amountBaseUnits.toString());

    const spender = await client.getSpender(chainId);
    const allowance = await this.getSwapAllowance(request.fromNetworkKey, request.fromToken, spender);
    const needsApproval = allowance < amountBaseUnits;

    const dstAmount = BigInt(quote.dstAmount);
    const slippageBps = BigInt(Math.round(slippagePercent * 100));
    const minOut = (dstAmount * (10_000n - slippageBps)) / 10_000n;

    const amountInFormatted = this.formatSwapAmount(request.amount.trim());
    const amountOutFormatted = this.formatSwapAmount(
      ethers.formatUnits(dstAmount, request.toToken.decimals)
    );
    const gasUnits = quote.gas ?? 250_000;

    return {
      provider: 'oneinch',
      fromNetworkKey: request.fromNetworkKey,
      toNetworkKey: request.toNetworkKey,
      fromTokenSymbol: request.fromToken.symbol,
      toTokenSymbol: request.toToken.symbol,
      amountInFormatted,
      amountOutFormatted,
      minAmountOutFormatted: this.formatSwapAmount(
        ethers.formatUnits(minOut, request.toToken.decimals)
      ),
      rateFormatted: this.formatSwapRate(
        amountInFormatted, amountOutFormatted,
        request.fromToken.symbol, request.toToken.symbol
      ),
      feeFormatted: await this.estimateEvmFeeFormatted(request.fromNetworkKey, gasUnits),
      needsApproval,
      approvalSpender: needsApproval ? spender : undefined,
      expiresAt: Date.now() + WalletAppService.SWAP_QUOTE_TTL_MS,
      // Calldata is fetched fresh at execute time; only display data rides along.
      raw: { dstAmount: quote.dstAmount, gas: gasUnits },
      request: { ...request, slippagePercent },
    };
  }

  private async executeOneInchSwap(
    quote: SwapQuoteView,
    chainId: number,
    options: { onProgress?: (phase: SwapPhase) => void }
  ): Promise<SwapExecuteResult> {
    const request = quote.request;
    this.assertEvmNetworkForWallet(request.fromNetworkKey);
    const client = this.getOneInchClient();
    if (!client) {
      throw new Error('Same-chain swaps require a 1inch API key (set ONEINCH_API_KEY)');
    }

    const amountBaseUnits = this.parseSwapAmount(request.amount, request.fromToken);
    const signer = await this.wallet.getEvmSignerForNetwork(request.fromNetworkKey);
    try {
      const approvalTxId = await this.ensureSwapAllowance(
        signer,
        request.fromToken,
        () => client.getSpender(chainId),
        amountBaseUnits,
        options.onProgress
      );

      options.onProgress?.('submitting-swap');
      const swapTx = await client.getSwapTx(
        chainId,
        toOneInchAddress(request.fromToken),
        toOneInchAddress(request.toToken),
        amountBaseUnits.toString(),
        await signer.getAddress(),
        request.slippagePercent ?? 1
      );
      const sent = await sendRawEvmTransaction(signer, {
        to: swapTx.to,
        data: swapTx.data,
        value: BigInt(swapTx.value),
        // 1inch's gas figure is an estimate; the bump absorbs state drift
        // between calldata construction and inclusion.
        gasLimit: (BigInt(swapTx.gas) * 12n) / 10n,
      });
      options.onProgress?.('swap-submitted');

      return {
        provider: 'oneinch',
        txId: sent.hash,
        approvalTxId,
        fromNetworkKey: request.fromNetworkKey,
        toNetworkKey: request.toNetworkKey,
      };
    } finally {
      await this.wallet.restoreActiveNetworkProvider();
    }
  }

  /**
   * Ensure the spender can move `amount` of `token`: check the allowance and
   * send + wait for an exact-amount approval when it falls short. Returns the
   * approval tx hash, or undefined when no approval was needed.
   * @private
   */
  private async ensureSwapAllowance(
    signer: ethers.Wallet | ethers.HDNodeWallet,
    token: Token,
    getSpender: () => Promise<string>,
    amount: bigint,
    onProgress?: (phase: SwapPhase) => void
  ): Promise<string | undefined> {
    if (token.address === '') {
      return undefined;
    }
    onProgress?.('checking-allowance');
    const spender = await getSpender();
    const owner = await signer.getAddress();
    const allowance = await getErc20Allowance(signer.provider!, token.address, owner, spender);
    if (allowance >= amount) {
      return undefined;
    }
    onProgress?.('approving');
    const approval = await approveErc20(signer, token.address, spender, amount);
    // The swap tx spends this allowance — it must be mined first.
    await approval.wait();
    onProgress?.('approval-confirmed');
    return approval.hash;
  }

  // ---- Mayan (cross-chain) ----------------------------------------------

  private async getMayanSwapQuote(
    request: SwapQuoteRequest,
    amountBaseUnits: bigint,
    slippagePercent: number
  ): Promise<SwapQuoteView> {
    const mayan = this.getMayanClient();
    const quote = await mayan.fetchQuote({
      amountIn64: amountBaseUnits.toString(),
      fromToken: toMayanAddress(request.fromToken),
      fromChain: MAYAN_NETWORKS[request.fromNetworkKey],
      toToken: toMayanAddress(request.toToken),
      toChain: MAYAN_NETWORKS[request.toNetworkKey],
      slippageBps: Math.round(slippagePercent * 100),
    });

    const fromIsEvm = !this.isNetworkSolana(request.fromNetworkKey);
    let needsApproval = false;
    let approvalSpender: string | undefined;
    if (fromIsEvm && request.fromToken.address !== '') {
      approvalSpender = await mayan.getForwarderAddress();
      const allowance = await this.getSwapAllowance(
        request.fromNetworkKey,
        request.fromToken,
        approvalSpender
      );
      needsApproval = allowance < amountBaseUnits;
    }

    // Mayan quote amounts are already human units.
    const amountInFormatted = this.formatSwapAmount(request.amount.trim());
    const amountOutFormatted = this.formatSwapAmount(String(quote.expectedAmountOut));
    let feeFormatted = '';
    if (fromIsEvm) {
      feeFormatted = await this.estimateEvmFeeFormatted(request.fromNetworkKey, 400_000);
    } else {
      try {
        const estimate = await this.getSolanaProviderForNetwork(request.fromNetworkKey).estimateFee();
        feeFormatted = `~${estimate.feeSol} SOL`;
      } catch {
        // Fee display is best-effort.
      }
    }

    // Respect Mayan's own deadline when it is sooner than our TTL.
    let expiresAt = Date.now() + WalletAppService.SWAP_QUOTE_TTL_MS;
    const deadlineSec = Number(quote.deadline64);
    if (Number.isFinite(deadlineSec) && deadlineSec > 0) {
      expiresAt = Math.min(expiresAt, deadlineSec * 1000);
    }

    return {
      provider: 'mayan',
      fromNetworkKey: request.fromNetworkKey,
      toNetworkKey: request.toNetworkKey,
      fromTokenSymbol: request.fromToken.symbol,
      toTokenSymbol: request.toToken.symbol,
      amountInFormatted,
      amountOutFormatted,
      minAmountOutFormatted: this.formatSwapAmount(String(quote.minAmountOut)),
      rateFormatted: this.formatSwapRate(
        amountInFormatted, amountOutFormatted,
        request.fromToken.symbol, request.toToken.symbol
      ),
      feeFormatted,
      // clientRelayerFeeSuccess is denominated in USD (Mayan explorer convention).
      bridgeFeeFormatted:
        typeof quote.clientRelayerFeeSuccess === 'number'
          ? `$${quote.clientRelayerFeeSuccess.toFixed(2)} relayer fee`
          : undefined,
      etaSeconds: quote.etaSeconds,
      needsApproval,
      approvalSpender: needsApproval ? approvalSpender : undefined,
      expiresAt,
      raw: quote,
      request: { ...request, slippagePercent },
    };
  }

  private async executeMayanSwapFromEvm(
    quote: SwapQuoteView,
    options: { onProgress?: (phase: SwapPhase) => void }
  ): Promise<SwapExecuteResult> {
    const request = quote.request;
    this.assertEvmNetworkForWallet(request.fromNetworkKey);
    const mayan = this.getMayanClient();
    const mayanQuote = quote.raw as MayanQuote;
    const amountBaseUnits = this.parseSwapAmount(request.amount, request.fromToken);
    const destinationAddress = this.resolveSwapDestinationAddress(request.toNetworkKey);

    const signer = await this.wallet.getEvmSignerForNetwork(request.fromNetworkKey);
    try {
      const approvalTxId = await this.ensureSwapAllowance(
        signer,
        request.fromToken,
        () => mayan.getForwarderAddress(),
        amountBaseUnits,
        options.onProgress
      );

      options.onProgress?.('submitting-swap');
      const result = await mayan.swapFromEvm(
        mayanQuote,
        await signer.getAddress(),
        destinationAddress,
        signer
      );
      options.onProgress?.('swap-submitted');

      return {
        provider: 'mayan',
        txId: result.txHash,
        approvalTxId,
        fromNetworkKey: request.fromNetworkKey,
        toNetworkKey: request.toNetworkKey,
      };
    } finally {
      await this.wallet.restoreActiveNetworkProvider();
    }
  }

  private async executeMayanSwapFromSolana(
    quote: SwapQuoteView,
    password: string,
    onProgress?: (phase: SwapPhase) => void
  ): Promise<SwapExecuteResult> {
    const request = quote.request;
    const mayan = this.getMayanClient();
    const mayanQuote = quote.raw as MayanQuote;
    const destinationAddress = this.resolveSwapDestinationAddress(request.toNetworkKey);

    const solInfo = this.wallet.getSolanaAddress(this.wallet.getCurrentAccountIndex());
    if (!solInfo?.address) {
      throw new Error('No Solana address available');
    }
    const provider = this.getSolanaProviderForNetwork(request.fromNetworkKey);
    // Keypair lives only in this frame; the sign callback closes over it and
    // nothing here retains it after executeSwap returns.
    const keypair = this.getSolanaSigningKeypair(password);

    onProgress?.('submitting-swap');
    const result = await mayan.swapFromSolana(
      mayanQuote,
      solInfo.address,
      destinationAddress,
      async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T): Promise<T> => {
        if ('version' in tx) {
          tx.sign([keypair]);
        } else {
          tx.partialSign(keypair);
        }
        return tx;
      },
      provider.getPrimaryConnection()
    );
    onProgress?.('swap-submitted');

    return {
      provider: 'mayan',
      txId: result.signature,
      fromNetworkKey: request.fromNetworkKey,
      toNetworkKey: request.toNetworkKey,
    };
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
  getBitcoinPrivateKey(password: string, networkKey?: string): string {
    const requestedNetwork = networkKey ?? this.config.network;
    const resolvedNetwork = isBitcoinNetwork(requestedNetwork)
      ? requestedNetwork
      : (isBitcoinNetwork(this.config.network) ? this.config.network : 'bitcoin-mainnet');
    const btcNetwork = resolvedNetwork === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
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
    password: string,
    networkKey?: string
  ): Promise<{ hash: string; feeSats: number; feeBtc: string; vbytes: number }> {
    const effectiveNetworkKey = networkKey ?? this.config.network;
    if (!this.isNetworkBitcoin(effectiveNetworkKey)) {
      throw new Error(`Network ${effectiveNetworkKey} is not a Bitcoin network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'bitcoin'
    ) {
      throw new Error('This wallet does not support Bitcoin sends');
    }

    const btcNetwork = effectiveNetworkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    if (!isValidBitcoinAddress(toAddress, btcNetwork)) {
      throw new Error('Invalid Bitcoin recipient address');
    }

    // Derive the sender address for the target BTC network directly so we don't
    // depend on the wallet's active network.
    const accountIndex = this.wallet.getCurrentAccountIndex();
    const btcInfo = this.wallet.getBitcoinAddress(btcNetwork, accountIndex);
    if (!btcInfo) {
      throw new Error('No Bitcoin address available');
    }
    const fromAddress = btcInfo.address;
    const wif = this.wallet.getBitcoinPrivateKey(password, btcNetwork);
    const provider = this.getBitcoinProviderForNetwork(effectiveNetworkKey);

    const result = await provider.sendTransaction(fromAddress, toAddress, amountBtc, wif);
    return {
      hash: result.txid,
      feeSats: result.feeSats,
      feeBtc: result.feeBtc,
      vbytes: result.vbytes
    };
  }

  // ============================================================================
  // XRP-Specific Methods
  // ============================================================================

  /**
   * Get XRP transaction history for the current address.
   * Only works when current network is XRP.
   *
   * @param limit - Maximum number of transactions to return
   * @returns Array of normalized XRP transactions
   */
  async getXRPTransactionHistory(limit: number = 25): Promise<NormalizedXRPTransaction[]> {
    if (!this.isCurrentNetworkXRP()) {
      return [];
    }

    const xrpInfo = this.getXRPAddress();
    if (!xrpInfo) {
      return [];
    }

    const provider = this.getXRPProviderForNetwork(this.config.network);
    return provider.getTransactionHistory(xrpInfo.address, limit);
  }

  /**
   * Get XRP transaction history for a specific address and network.
   * Useful for extension UIs that need to query the currently-selected network/address.
   *
   * @param address - XRP classic address (r...)
   * @param limit - Maximum number of transactions to return
   * @param networkKey - XRP network key (defaults to current)
   */
  async getXRPTransactionHistoryForAddress(
    address: string,
    limit: number = 25,
    networkKey: string = this.config.network
  ): Promise<NormalizedXRPTransaction[]> {
    if (!this.isNetworkXRP(networkKey)) {
      return [];
    }
    const provider = this.getXRPProviderForNetwork(networkKey);
    return provider.getTransactionHistory(address, limit);
  }

  /**
   * Get block explorer URL for an XRP transaction.
   *
   * @param hash - Transaction hash
   * @returns URL to XRPL explorer
   */
  getXRPTransactionUrl(hash: string): string {
    const provider = this.getXRPProviderForNetwork(this.config.network);
    return provider.getTransactionUrl(hash);
  }

  /**
   * Get block explorer URL for an XRP address.
   *
   * @param address - XRP address (optional, uses current if not provided)
   * @returns URL to XRPL explorer
   */
  getXRPAddressUrl(address?: string): string {
    const addr = address || this.getXRPAddress()?.address;
    if (!addr) {
      return '';
    }
    const provider = this.getXRPProviderForNetwork(this.config.network);
    return provider.getAddressUrl(addr);
  }

  /**
   * Get XRP private key (hex format).
   * Requires password verification.
   *
   * @param password - Master password
   * @returns Private key as hex string
   */
  getXRPPrivateKey(password: string): string {
    return this.wallet.getXRPPrivateKey(password);
  }

  /**
   * Send an XRP transaction.
   *
   * @param toAddress - Recipient XRP address (r...)
   * @param amountXrp - Amount in XRP string (e.g., "10" or "10.5")
   * @param password - Master password for signing
   * @param destinationTag - Optional destination tag (for exchange deposits)
   * @returns Transaction result with hash and fee info
   */
  async sendXRPTransaction(
    toAddress: string,
    amountXrp: string,
    password: string,
    destinationTag?: number,
    networkKey?: string
  ): Promise<{ hash: string; feeDrops: number; feeXrp: string }> {
    const effectiveNetworkKey = networkKey ?? this.config.network;
    if (!this.isNetworkXRP(effectiveNetworkKey)) {
      throw new Error(`Network ${effectiveNetworkKey} is not an XRP network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'xrp'
    ) {
      throw new Error('This wallet does not support XRP sends');
    }

    // Validate recipient address
    if (!isValidXRPAddress(toAddress)) {
      throw new Error('Invalid XRP recipient address');
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();
    const xrpInfo = this.wallet.getXRPAddress(accountIndex);
    if (!xrpInfo) {
      throw new Error('No XRP address available');
    }

    let mnemonicOrPrivateKey: string;
    if (this.wallet.importType === 'privateKey') {
      mnemonicOrPrivateKey = this.wallet.getPrivateKey(password);
    } else {
      // Get mnemonic for signing
      mnemonicOrPrivateKey = this.wallet.getMnemonic(password);
    }

    // Get provider and send transaction
    const provider = this.getXRPProviderForNetwork(effectiveNetworkKey);
    const result = await provider.sendTransaction(
      xrpInfo.address,
      toAddress,
      amountXrp,
      mnemonicOrPrivateKey,
      destinationTag
    );

    return {
      hash: result.hash,
      feeDrops: result.feeDrops,
      feeXrp: result.feeXrp,
    };
  }

  /**
   * Estimate an XRP send and surface reserve/spendable constraints.
   * Intended for UI preflight checks (CLI/extension) before prompting for password.
   *
   * @param toAddress - Recipient XRP classic address (r...)
   * @param amountXrp - Amount in XRP string
   * @param destinationTag - Optional destination tag
   */
  async estimateXRPTransaction(
    toAddress: string,
    amountXrp: string,
    destinationTag?: number
  ): Promise<{
    feeXrp: string;
    maxSendableXrp: string;
    sender: { totalXrp: string; availableXrp: string; reservedXrp: string; isActivated: boolean };
    recipient: { isActivated: boolean };
  }> {
    if (!this.isCurrentNetworkXRP()) {
      throw new Error('Not on an XRP network');
    }

    if (!isValidXRPAddress(toAddress)) {
      throw new Error('Invalid XRP recipient address');
    }

    const xrpInfo = this.getXRPAddress();
    if (!xrpInfo) {
      throw new Error('No XRP address available');
    }

    const provider = this.getXRPProviderForNetwork(this.config.network);
    const estimate = await provider.estimateSendTransaction(
      xrpInfo.address,
      toAddress,
      amountXrp,
      destinationTag
    );

    return {
      feeXrp: estimate.feeXrpStr,
      maxSendableXrp: estimate.maxSendableXrp,
      sender: {
        totalXrp: dropsToXrp(estimate.senderBalance.total),
        availableXrp: dropsToXrp(estimate.senderBalance.available),
        reservedXrp: dropsToXrp(estimate.senderBalance.reserved),
        isActivated: estimate.senderBalance.isActivated,
      },
      recipient: {
        isActivated: estimate.recipientBalance.isActivated,
      },
    };
  }

  // ============================================================================
  // TON-Specific Methods
  // ============================================================================

  /**
   * Get TON transaction history for the current address.
   * Only works when current network is TON.
   *
   * @param limit - Maximum number of transactions to return
   * @returns Array of normalized TON transactions
   */
  async getTonTransactionHistory(limit: number = 25): Promise<NormalizedTonTransaction[]> {
    if (!this.isCurrentNetworkTon()) {
      return [];
    }

    const tonInfo = this.getTonAddress();
    if (!tonInfo) {
      return [];
    }

    const provider = this.getTonProviderForNetwork(this.config.network);
    return provider.getTransactionHistory(tonInfo.address, limit);
  }

  /**
   * Get TON transaction history for a specific address and network.
   *
   * @param address - TON address (friendly or raw)
   * @param limit - Maximum number of transactions to return
   * @param networkKey - TON network key (defaults to current)
   */
  async getTonTransactionHistoryForAddress(
    address: string,
    limit: number = 25,
    networkKey: string = this.config.network
  ): Promise<NormalizedTonTransaction[]> {
    if (!this.isNetworkTon(networkKey)) {
      return [];
    }
    const provider = this.getTonProviderForNetwork(networkKey);
    return provider.getTransactionHistory(address, limit);
  }

  /**
   * Get block explorer URL for a TON transaction.
   *
   * @param hash - Transaction hash
   * @returns Explorer URL
   */
  getTonTransactionUrl(hash: string): string {
    const provider = this.getTonProviderForNetwork(this.config.network);
    return provider.getTransactionUrl(hash);
  }

  /**
   * Get block explorer URL for a TON address.
   *
   * @param address - TON address (optional, uses current if not provided)
   * @returns Explorer URL
   */
  getTonAddressUrl(address?: string): string {
    const addr = address || this.getTonAddress()?.address;
    if (!addr) {
      return '';
    }
    const provider = this.getTonProviderForNetwork(this.config.network);
    return provider.getAddressUrl(addr);
  }

  /**
   * Send a TON transaction.
   *
   * @param toAddress - Recipient TON address
   * @param amountTon - Amount in TON string
   * @param password - Master password for signing
   * @param comment - Optional comment payload
   * @returns Transaction result with hash
   */
  async sendTonTransaction(
    toAddress: string,
    amountTon: string,
    password: string,
    comment?: string,
    networkKey?: string
  ): Promise<{ hash: string }> {
    const effectiveNetworkKey = networkKey ?? this.config.network;
    if (!this.isNetworkTon(effectiveNetworkKey)) {
      throw new Error(`Network ${effectiveNetworkKey} is not a TON network`);
    }
    if (
      this.wallet.importType === 'privateKey' &&
      this.wallet.privateKeyType &&
      this.wallet.privateKeyType !== 'ton'
    ) {
      throw new Error('This wallet does not support TON sends');
    }

    if (!isValidTonAddress(toAddress)) {
      throw new Error('Invalid TON recipient address');
    }

    const accountIndex = this.wallet.getCurrentAccountIndex();
    const tonInfo = this.wallet.getTonAddress(accountIndex);
    if (!tonInfo) {
      throw new Error('No TON address available');
    }

    const provider = this.getTonProviderForNetwork(effectiveNetworkKey);

    if (this.wallet.importType === 'privateKey') {
      const secretKey = this.wallet.getPrivateKey(password);
      return provider.sendTransaction(
        tonInfo.address,
        toAddress,
        amountTon,
        undefined, // No mnemonic
        comment,
        accountIndex,
        secretKey
      );
    } else {
      const mnemonic = this.wallet.getMnemonic(password);
      return provider.sendTransaction(
        tonInfo.address,
        toAddress,
        amountTon,
        mnemonic,
        comment,
        accountIndex
      );
    }
  }
}
