/**
 * @fileoverview Core HD wallet implementation for Ethereum and EVM-compatible chains.
 * 
 * This module provides the main Wallet class that handles:
 * - BIP-44 hierarchical deterministic (HD) wallet creation and import
 * - Mnemonic phrase encryption/decryption with AES-256-GCM
 * - ETH and ERC-20 token balance queries
 * - Transaction sending for native currency and ERC-20 transfers
 * - Multi-account support within a single seed phrase
 * - RPC failover across multiple endpoints
 * - Token metadata caching to reduce RPC calls
 * 
 * The wallet uses ethers.js v6 for all blockchain interactions and
 * supports injectable storage and provider factories for testing.
 * 
 * @module wallet
 */

import { ethers } from 'ethers';
import { encryptMnemonic, decryptMnemonic, validateMnemonic } from './crypto-utils.js';
import type { Config, TokenMetadata, Token, PortfolioToken } from './types/index.js';
import type { StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';
import { deriveBitcoinAddress, getBitcoinPrivateKey, type BitcoinAddressInfo } from './bitcoin/index.js';
import { deriveSolanaAddress, type SolanaAddressInfo } from './solana/index.js';
import { deriveXRPAddress, getXRPPrivateKey, type XRPAddressInfo } from './xrp/index.js';

/**
 * Minimal ERC-20 ABI for token interactions.
 * Includes standard read functions and transfer capability.
 */
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];

// ============================================================================
// Internal Type Definitions
// ============================================================================

/** Wallet creation/import result with sensitive data */
interface WalletInfo {
  /** Checksummed Ethereum address (lowercase) */
  address: string;
  /** BIP-39 mnemonic phrase (sensitive - display once then discard) */
  mnemonic: string;
  /** Private key hex string (sensitive) */
  privateKey: string;
}

/** Account switch result */
interface AccountInfo {
  /** Account address */
  address: string;
  /** BIP-44 account index */
  accountIndex: number;
}

/** Transaction receipt after confirmation */
interface TransactionReceipt {
  /** Transaction hash */
  hash: string;
  /** Block number where mined */
  blockNumber: number;
  /** Actual gas consumed */
  gasUsed: string;
}

/** Encrypted wallet storage format */
interface WalletData {
  /** AES-256-GCM encrypted mnemonic */
  encryptedMnemonic: string;
  /** PBKDF2 salt */
  salt: string;
  /** AES initialization vector */
  iv: string;
  /** GCM authentication tag */
  authTag: string;
  /** Wallet creation timestamp */
  createdAt: string;
  /** Map of account indices to addresses */
  accounts: Record<number, { address: string; createdAt: string }>;
  /** Currently active account index */
  currentAccountIndex: number;
}

/** wallets.json file structure */
interface WalletsFile {
  [walletName: string]: WalletData;
}

/** Encrypted wallet export format */
interface ExportData {
  /** Export format version */
  version: string;
  /** Export timestamp */
  exportedAt: string;
  /** Wallet data including name */
  wallet: {
    name: string;
  } & WalletData;
}

/** Portfolio balance query result */
interface PortfolioResult {
  /** Token definition */
  token: Token;
  /** Formatted balance string */
  balance: string;
  /** Error message if balance fetch failed */
  error?: string;
}

// ============================================================================
// Wallet Class
// ============================================================================

/**
 * Core HD wallet implementation for Ethereum and EVM-compatible chains.
 * 
 * Features:
 * - BIP-44 HD wallet with multiple account support
 * - Encrypted mnemonic storage with AES-256-GCM
 * - RPC failover across multiple endpoints
 * - ETH and ERC-20 token operations
 * - Token metadata caching
 * 
 * @example
 * ```typescript
 * const storage = new FileStorage();
 * const wallet = new Wallet(config, storage, createProviderFactory());
 * await wallet.initialize();
 * 
 * // Create new wallet
 * const info = wallet.createNewWallet(password);
 * console.log('Address:', info.address);
 * 
 * // Check balance
 * const balance = await wallet.getBalance();
 * ```
 */
export class Wallet {
  /** Current network configuration */
  config: Config;
  /** Active ethers HD wallet instance */
  wallet: ethers.HDNodeWallet | null;
  /** Current JSON-RPC provider */
  provider: ethers.JsonRpcProvider | null;
  /** Provider cache keyed by network */
  providers: Record<string, ethers.JsonRpcProvider>;
  /** Current RPC URL index per network for failover */
  rpcIndex: Record<string, number>;
  /** Decrypted mnemonic (in-memory only while unlocked) */
  mnemonic: string | null;
  /** Encrypted mnemonic ciphertext */
  encryptedMnemonic: string | null;
  /** PBKDF2 salt for key derivation */
  salt: string | null;
  /** AES-GCM initialization vector */
  iv: string | null;
  /** GCM authentication tag */
  authTag: string | null;
  /** Current BIP-44 account index */
  currentAccountIndex: number;
  /** Token metadata cache to reduce RPC calls */
  tokenMetadataCache: Record<string, TokenMetadata>;
  /** ethers Provider class reference (for testing override) */
  ProviderClass: typeof ethers.JsonRpcProvider;
  /** ethers Contract class reference (for testing override) */
  ContractClass: typeof ethers.Contract;
  /** Provider factory for creating RPC connections */
  providerFactory: ProviderFactory;
  /** Storage adapter for persistence */
  storage: StorageAdapter;

  /**
   * Create a new Wallet instance.
   * Call initialize() after construction to set up the provider.
   * 
   * @param config - Network configuration
   * @param storage - Storage adapter for wallet persistence
   * @param providerFactory - Optional factory for creating providers (useful for testing)
   */
  constructor(config: Config, storage: StorageAdapter, providerFactory?: ProviderFactory) {
    this.config = config;
    this.storage = storage;
    this.wallet = null;
    this.provider = null;
    this.providers = {};
    this.rpcIndex = {};
    this.mnemonic = null;
    this.encryptedMnemonic = null;
    this.salt = null;
    this.iv = null;
    this.authTag = null;
    this.currentAccountIndex = 0;
    this.tokenMetadataCache = {};
    this.ProviderClass = ethers.JsonRpcProvider;
    this.ContractClass = ethers.Contract;
    this.providerFactory = providerFactory || {
      createProvider: (rpcUrl: string, chainId: number) => new ethers.JsonRpcProvider(rpcUrl, chainId)
    };
  }

  /**
   * Execute an RPC operation with exponential backoff retry.
   * Includes a 30-second timeout per attempt.
   * 
   * @param operation - Async function to execute
   * @param maxRetries - Maximum retry attempts (default: 3)
   * @param baseDelay - Initial delay in ms, doubles each retry (default: 1000)
   * @returns Result of the operation
   * @throws Last error after all retries exhausted
   * @private
   */
  async _retryRpcRequest<T>(operation: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 1000): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await Promise.race<T>([
          operation(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), 30000)
          )
        ]);
        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Initialize the wallet by establishing RPC provider connection.
   * Must be called before any blockchain operations.
   */
  async initialize(): Promise<void> {
    await this._ensureProvider(this.config.network);
  }

  /**
   * Get list of RPC URLs for a network.
   * Supports both single URL and array configurations.
   * 
   * @param networkKey - Network identifier from config
   * @returns Array of RPC URLs (deduplicated)
   * @private
   */
  _getRpcList(networkKey: string): string[] {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) return [];
    // Bitcoin networks don't have RPC URLs
    if (networkConfig.type === 'bitcoin' || networkConfig.type === 'solana') return [];
    const urls: string[] = [];
    if (networkConfig.rpcUrl) {
      if (Array.isArray(networkConfig.rpcUrl)) {
        urls.push(...networkConfig.rpcUrl);
      } else {
        urls.push(networkConfig.rpcUrl);
      }
    }
    return [...new Set(urls)];
  }

  /**
   * Ensure a working provider exists for the network.
   * Tries each RPC URL in sequence until one works.
   * Uses provider cache to avoid redundant connections.
   * 
   * @param networkKey - Network identifier
   * @returns Connected provider
   * @throws Error if all RPC endpoints fail
   * @private
   */
  async _ensureProvider(networkKey: string): Promise<ethers.JsonRpcProvider> {
    const networkConfig = this.config.networks[networkKey];
    // Bitcoin networks don't use JSON-RPC providers
    if (networkConfig?.type === 'bitcoin') {
      throw new Error('Bitcoin networks do not use JSON-RPC providers');
    }
    // Solana networks don't use ethers JSON-RPC providers
    if (networkConfig?.type === 'solana') {
      throw new Error('Solana networks do not use ethers JSON-RPC providers');
    }

    const rpcList = this._getRpcList(networkKey);
    if (!rpcList.length) {
      throw new Error('No RPC URLs configured for network');
    }

    if (this.providers[networkKey]) {
      this.provider = this.providers[networkKey];
      return this.provider;
    }

    let lastError: Error | undefined;
    for (let i = 0; i < rpcList.length; i++) {
      const rpcUrl = rpcList[i];
      // TypeScript guard: we already checked for Bitcoin above, so this is safe
      const chainId = (networkConfig as { chainId: number }).chainId;
      const candidate = this.providerFactory.createProvider(
        rpcUrl,
        chainId
      );
      try {
        await this._retryRpcRequest(() => candidate.getBlockNumber(), 2, 2000);
        this.providers[networkKey] = candidate;
        this.rpcIndex[networkKey] = i;
        this.provider = candidate;
        return candidate;
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw new Error(`All RPC endpoints failed for ${networkKey}: ${lastError?.message || 'unknown error'}`);
  }

  /**
   * Switch to a different blockchain network.
   * Updates provider and reconnects wallet if loaded.
   * 
   * @param networkKey - Network identifier from config
   * @throws Error if network not found in configuration
   */
  async setNetwork(networkKey: string): Promise<void> {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) {
      throw new Error('Network not found in configuration');
    }
    if (networkConfig.type === 'bitcoin' || networkConfig.type === 'solana') {
      throw new Error('Non-EVM networks must be handled by the app service');
    }

    this.config.network = networkKey;
    await this._ensureProvider(networkKey);

    if (this.wallet && this.mnemonic) {
      this.wallet = this._deriveAccount(this.currentAccountIndex).connect(this.provider!);
    }
  }

  /**
   * Create a new HD wallet with random mnemonic.
   * Encrypts the mnemonic with the provided password.
   * 
   * @param password - Master password for mnemonic encryption
   * @returns Wallet info including address, mnemonic (display once!), and private key
   */
  createNewWallet(password: string): WalletInfo {
    const randomWallet = ethers.Wallet.createRandom();
    this.mnemonic = randomWallet.mnemonic!.phrase;

    const { encrypted, salt, iv, authTag } = encryptMnemonic(this.mnemonic, password);
    this.encryptedMnemonic = encrypted;
    this.salt = salt;
    this.iv = iv;
    this.authTag = authTag;

    this.currentAccountIndex = 0;
    const derived = this._deriveAccount(0);
    this.wallet = this.provider ? derived.connect(this.provider) : derived;

    return {
      address: this.wallet.address.toLowerCase(),
      mnemonic: this.mnemonic,
      privateKey: this.wallet.privateKey
    };
  }

  /**
   * Import an existing wallet from a BIP-39 mnemonic phrase.
   * Validates the mnemonic format and encrypts it.
   * 
   * @param mnemonic - Space-separated BIP-39 mnemonic (12-24 words)
   * @param password - Master password for encryption
   * @param accountIndex - BIP-44 account index to use (default: 0)
   * @returns Wallet info with derived address
   * @throws Error if mnemonic is invalid
   */
  importWallet(mnemonic: string, password: string, accountIndex: number = 0): WalletInfo {
    const normalizedMnemonic = mnemonic.trim().toLowerCase();

    if (!validateMnemonic(normalizedMnemonic)) {
      throw new Error('Invalid mnemonic phrase format. Must be 12, 15, 18, 21, or 24 words.');
    }

    try {
      this.mnemonic = normalizedMnemonic;

      const { encrypted, salt, iv, authTag } = encryptMnemonic(this.mnemonic, password);
      this.encryptedMnemonic = encrypted;
      this.salt = salt;
      this.iv = iv;
      this.authTag = authTag;

      this.currentAccountIndex = accountIndex;
      const derived = this._deriveAccount(accountIndex);
      this.wallet = this.provider ? derived.connect(this.provider) : derived;

      return {
        address: this.wallet.address.toLowerCase(),
        mnemonic: this.mnemonic,
        privateKey: this.wallet.privateKey
      };
    } catch (error) {
      throw new Error('Invalid mnemonic phrase or unable to derive wallet');
    }
  }

  /**
   * Derive an HD wallet account at a specific BIP-44 index.
   * Uses path: m/44'/60'/0'/0/{index}
   * 
   * @param index - BIP-44 account index
   * @returns HD wallet for the account (not connected to provider)
   * @throws Error if no mnemonic is loaded
   * @private
   */
  _deriveAccount(index: number): ethers.HDNodeWallet {
    if (!this.mnemonic) {
      throw new Error('No mnemonic available');
    }
    const path = `m/44'/60'/0'/0/${index}`;
    return ethers.HDNodeWallet.fromPhrase(this.mnemonic, "", path);
  }

  /**
   * Switch to a different account within the same wallet.
   * 
   * @param accountIndex - BIP-44 account index to switch to
   * @returns New account info with address
   * @throws Error if no mnemonic is loaded
   */
  switchAccount(accountIndex: number): AccountInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    this.currentAccountIndex = accountIndex;
    const derived = this._deriveAccount(accountIndex);
    this.wallet = this.provider ? derived.connect(this.provider) : derived;
    return {
      address: this.wallet.address.toLowerCase(),
      accountIndex: accountIndex
    };
  }

  /**
   * Get the address for a specific account index without switching.
   * 
   * @param index - BIP-44 account index
   * @returns Checksummed address (lowercase)
   * @throws Error if no mnemonic is loaded
   */
  getAccountAddress(index: number): string {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const account = this._deriveAccount(index);
    return account.address.toLowerCase();
  }

  /**
   * Return the currently selected account index.
   * Useful for UI components that need to highlight the active account.
   * 
   * @returns Current BIP-44 account index
   */
  getCurrentAccountIndex(): number {
    return this.currentAccountIndex;
  }

  /**
   * Get the native currency balance (ETH) for the current account.
   * 
   * @returns Balance in ETH as string with full precision
   * @throws Error if no wallet loaded or network timeout
   */
  async getBalance(): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const balance = await this._retryRpcRequest(
        () => this.provider!.getBalance(this.wallet!.address),
        3,
        1000
      );
      return ethers.formatEther(balance);
    } catch (error) {
      if ((error as Error).message.includes('timeout')) {
        throw new Error('Network request timed out. Please check your internet connection or try a different RPC endpoint.');
      }
      throw error;
    }
  }

  /**
   * Get the current wallet's address.
   * 
   * @returns Checksummed address (lowercase)
   * @throws Error if no wallet loaded
   */
  getAddress(): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }
    return this.wallet.address.toLowerCase();
  }

  /**
   * Send native currency (ETH) to another address.
   * Includes balance validation and gas estimation.
   * 
   * @param toAddress - Recipient address (0x-prefixed, 42 chars)
   * @param amount - Amount in ETH as decimal string (e.g., "0.1")
   * @returns Transaction receipt after confirmation
   * @throws Error if insufficient balance, invalid address, or transaction fails
   */
  async sendTransaction(toAddress: string, amount: string): Promise<TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const value = ethers.parseEther(amount);

      const balance = await this._retryRpcRequest(
        () => this.provider!.getBalance(this.wallet!.address)
      );

      let gasLimit: bigint;
      let gasPrice: bigint;
      try {
        gasLimit = await this._retryRpcRequest(() =>
          this.provider!.estimateGas({
            to: toAddress,
            value: value,
            from: this.wallet!.address
          })
        );

        gasLimit = (gasLimit * 120n) / 100n;

        const feeData = await this._retryRpcRequest(() =>
          this.provider!.getFeeData()
        );
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        gasLimit = 21000n;
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      const estimatedGasCost = gasLimit * gasPrice;
      const totalCost = value + estimatedGasCost;

      if (balance < totalCost) {
        const balanceEth = ethers.formatEther(balance);
        const neededEth = ethers.formatEther(totalCost);
        const gasCostEth = ethers.formatEther(estimatedGasCost);
        throw new Error(
          `Insufficient balance. You have ${balanceEth} ETH but need ${neededEth} ETH (${amount} ETH + ~${gasCostEth} ETH gas)`
        );
      }

      const tx = await this.wallet.sendTransaction({
        to: toAddress,
        value: value,
        gasLimit: gasLimit
      });

      const receipt = await this._retryRpcRequest<ethers.TransactionReceipt | null>(
        () => tx.wait(),
        5,
        2000
      );

      if (!receipt) {
        throw new Error('Transaction receipt not received');
      }

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      const err = error as any;
      if (err.message?.includes('insufficient funds')) {
        throw new Error('Insufficient funds for transaction');
      }
      if (err.message?.includes('nonce')) {
        throw new Error('Transaction nonce error. Please try again.');
      }
      if (err.message?.includes('gas')) {
        throw new Error(`Gas estimation failed: ${err.message}`);
      }
      if (err.code === 'CALL_EXCEPTION') {
        throw new Error('Transaction would fail. Check recipient address and amount.');
      }

      throw error;
    }
  }

  /**
   * Create an ERC-20 contract instance.
   * 
   * @param address - Token contract address
   * @param withSigner - If true, use wallet for signing; if false, use provider (read-only)
   * @returns ethers Contract instance
   * @private
   */
  _getTokenContract(address: string, withSigner: boolean = true): ethers.Contract {
    const target = withSigner ? this.wallet : this.provider;
    return new this.ContractClass(address, ERC20_ABI, target);
  }

  /**
   * Fetch on-chain metadata for an ERC-20 token.
   * Results are cached to minimize RPC calls.
   * 
   * @param address - Token contract address
   * @returns Token metadata (symbol, name, decimals)
   * @throws Error if contract doesn't implement ERC-20 metadata
   */
  async getTokenMetadata(address: string): Promise<TokenMetadata> {
    if (!address) {
      throw new Error('Token address is required');
    }

    const key = address.toLowerCase();
    if (this.tokenMetadataCache[key]) {
      return this.tokenMetadataCache[key];
    }

    const contract = this._getTokenContract(address, false);

    try {
      const [symbol, name, decimals] = await Promise.all([
        this._retryRpcRequest(() => contract.symbol()),
        this._retryRpcRequest(() => contract.name()),
        this._retryRpcRequest(() => contract.decimals())
      ]);

      const meta: TokenMetadata = {
        symbol,
        name,
        decimals: Number(decimals)
      };

      this.tokenMetadataCache[key] = meta;
      return meta;
    } catch (error) {
      throw new Error(`Unable to fetch token metadata: ${(error as Error).message}`);
    }
  }

  /**
   * Resolve token decimals, using cached metadata if available.
   * 
   * @param token - Token definition
   * @returns Number of decimal places
   * @private
   */
  async _resolveTokenDecimals(token: Token): Promise<number> {
    if (typeof token.decimals === 'number') {
      return token.decimals;
    }

    const metadata = await this.getTokenMetadata(token.address);
    return metadata.decimals;
  }

  /**
   * Get the balance of a specific token for the current account.
   * 
   * @param token - Token definition (native or ERC-20)
   * @returns Balance as formatted string with proper decimals
   * @throws Error if no wallet loaded or RPC fails
   */
  async getTokenBalance(token: Token): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (token.type === 'native') {
      return this.getBalance();
    }

    const decimals = await this._resolveTokenDecimals(token);
    const contract = this._getTokenContract(token.address, false);

    try {
      const balance = await this._retryRpcRequest(() => contract.balanceOf(this.wallet!.address));
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      const err = error as any;
      if (err.code === 'BAD_DATA') {
        throw new Error('Token read failed: RPC returned empty/invalid data (check token address, network, or try another RPC)');
      }
      if (err.message?.includes('timeout')) {
        throw new Error('Token balance request timed out. Try again or switch RPC.');
      }
      throw error;
    }
  }

  /**
   * Get balances for multiple tokens in parallel.
   * 
   * @param tokens - Array of token definitions
   * @returns Array of results with balance or error for each token
   */
  async getPortfolio(tokens: Token[] = []): Promise<PortfolioResult[]> {
    const promises = tokens.map(async (token): Promise<PortfolioResult> => {
      try {
        const balance = await this.getTokenBalance(token);
        return { token, balance };
      } catch (error) {
        return { token, balance: 'Error', error: (error as Error).message };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Send an ERC-20 token or native currency.
   * Validates gas availability for token transfers.
   * 
   * @param token - Token to send
   * @param toAddress - Recipient address
   * @param amount - Amount in token units (e.g., "100" for 100 USDC)
   * @returns Transaction receipt
   * @throws Error if insufficient balance or gas
   */
  async sendToken(token: Token, toAddress: string, amount: string): Promise<TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (token.type === 'native') {
      return this.sendTransaction(toAddress, amount);
    }

    try {
      const decimals = await this._resolveTokenDecimals(token);
      const value = ethers.parseUnits(amount, decimals);
      const contract = this._getTokenContract(token.address, true);

      const nativeBalance = await this._retryRpcRequest(() => this.provider!.getBalance(this.wallet!.address));

      let gasLimit: bigint;
      let gasPrice: bigint;
      try {
        gasLimit = await this._retryRpcRequest(() => contract.transfer.estimateGas(toAddress, value));
        gasLimit = (gasLimit * 120n) / 100n;

        const feeData = await this._retryRpcRequest(() => this.provider!.getFeeData());
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        gasLimit = 120000n;
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      const estimatedGasCost = gasPrice ? gasLimit * gasPrice : 0n;
      if (nativeBalance < estimatedGasCost) {
        const neededEth = ethers.formatEther(estimatedGasCost);
        const balanceEth = ethers.formatEther(nativeBalance);
        throw new Error(`Insufficient ETH for gas. Need ~${neededEth} ETH, have ${balanceEth} ETH.`);
      }

      const tx = await this._retryRpcRequest(() => contract.transfer(toAddress, value, { gasLimit }));

      const receipt = await this._retryRpcRequest<ethers.TransactionReceipt | null>(() => tx.wait(), 5, 2000);

      if (!receipt) {
        throw new Error('Transaction receipt not received');
      }

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      const err = error as any;
      if (err.message?.includes('insufficient funds')) {
        throw new Error('Insufficient balance for token transfer');
      }
      if (err.code === 'CALL_EXCEPTION') {
        throw new Error('Token transfer would fail. Check recipient and amount.');
      }
      throw error;
    }
  }

  /**
   * Save the current wallet to persistent storage.
   * Creates or updates wallet entry in wallets.json.
   * 
   * @param walletName - Optional name for the wallet (defaults to address prefix)
   * @returns The wallet name used for saving
   * @throws Error if wallet not properly initialized
   */
  saveWallet(walletName?: string): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('Wallet not properly encrypted');
    }

    const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});

    if (!walletName) {
      walletName = this.wallet.address.substring(0, 10);
    }

    if (!wallets[walletName]) {
      wallets[walletName] = {
        encryptedMnemonic: this.encryptedMnemonic,
        salt: this.salt,
        iv: this.iv,
        authTag: this.authTag,
        createdAt: new Date().toISOString(),
        accounts: {},
        currentAccountIndex: 0
      };
    }

    wallets[walletName].accounts[this.currentAccountIndex] = {
      address: this.wallet.address.toLowerCase(),
      createdAt: wallets[walletName].accounts[this.currentAccountIndex]?.createdAt || new Date().toISOString()
    };

    wallets[walletName].currentAccountIndex = this.currentAccountIndex;

    this.storage.writeJSON('wallets.json', wallets);

    return walletName;
  }

  /**
   * Load and decrypt a wallet from storage.
   * 
   * @param walletName - Name of the wallet to load
   * @param password - Master password for decryption
   * @param accountIndex - Optional account index to load (defaults to stored index)
   * @returns Wallet info if successful, null if wallet not found
   * @throws Error if password is incorrect
   */
  loadWallet(walletName: string, password: string, accountIndex: number | null = null): WalletInfo | null {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});

      if (walletName && wallets[walletName]) {
        const walletData = wallets[walletName];

        const mnemonic = decryptMnemonic(
          walletData.encryptedMnemonic,
          password,
          walletData.salt,
          walletData.iv,
          walletData.authTag
        );

        // Validate decrypted mnemonic so a wrong password surfaces a friendly error
        if (!validateMnemonic(mnemonic)) {
          throw new Error('Incorrect password');
        }

        this.encryptedMnemonic = walletData.encryptedMnemonic;
        this.salt = walletData.salt;
        this.iv = walletData.iv;
        this.authTag = walletData.authTag;
        this.mnemonic = mnemonic;

        const indexToLoad = accountIndex !== null ? accountIndex : (walletData.currentAccountIndex || 0);
        this.currentAccountIndex = indexToLoad;
        const derived = this._deriveAccount(indexToLoad);
        this.wallet = this.provider ? derived.connect(this.provider) : derived;

        return {
          address: this.wallet.address.toLowerCase(),
          mnemonic: this.mnemonic,
          privateKey: this.wallet.privateKey
        };
      }

      return null;
    } catch (error) {
      if ((error as Error).message?.includes('Unsupported state or unable to authenticate data')) {
        throw new Error('Incorrect password');
      }
      if ((error as Error).message?.includes('invalid mnemonic')) {
        throw new Error('Incorrect password');
      }
      throw error;
    }
  }

  /**
   * Get all accounts associated with a wallet.
   * 
   * @param walletName - Name of the wallet
   * @returns Map of account indices to addresses and creation dates
   */
  getWalletAccounts(walletName: string): Record<number, { address: string; createdAt: string }> {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
      if (wallets[walletName] && wallets[walletName].accounts) {
        return wallets[walletName].accounts;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Get all saved wallets from storage.
   * 
   * @returns Map of wallet names to their encrypted data
   */
  getAllWallets(): WalletsFile {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
      return wallets;
    } catch (error) {
      return {};
    }
  }

  /**
   * Rename a wallet entry in persistent storage.
   *
   * Wallet names are the top-level keys in `wallets.json`.
   *
   * @param oldName - Existing wallet name
   * @param newName - New wallet name
   * @returns The new wallet name
   * @throws Error if wallet not found or name already exists
   */
  renameWallet(oldName: string, newName: string): string {
    if (!oldName || !newName) {
      throw new Error('Wallet name is required');
    }
    if (oldName === newName) {
      return newName;
    }

    const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
    if (!wallets[oldName]) {
      throw new Error('Wallet not found');
    }
    if (wallets[newName]) {
      throw new Error('A wallet with this name already exists');
    }

    wallets[newName] = wallets[oldName];
    delete wallets[oldName];
    this.storage.writeJSON('wallets.json', wallets);
    return newName;
  }

  /**
   * Delete a wallet from storage.
   * 
   * @param walletName - Name of the wallet to delete
   * @returns True if deletion succeeded
   */
  deleteWallet(walletName: string): boolean {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
      delete wallets[walletName];
      this.storage.writeJSON('wallets.json', wallets);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Export a wallet to a backup file.
   * The export includes encrypted mnemonic and all account data.
   * 
   * @param walletName - Name of wallet to export
   * @param exportPath - File path for the backup
   * @returns True if export succeeded
   * @throws Error if wallet not found or write fails
   */
  exportWallet(walletName: string, exportPath: string): boolean {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});

      if (!wallets[walletName]) {
        throw new Error('Wallet not found');
      }

      const exportData: ExportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        wallet: {
          name: walletName,
          ...wallets[walletName]
        }
      };

      this.storage.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      return true;
    } catch (error) {
      throw new Error(`Export failed: ${(error as Error).message}`);
    }
  }

  /**
   * Import a wallet from a backup file.
   * Validates the password matches before importing.
   * 
   * @param importPath - Path to the backup file
   * @param password - Password for the backup
   * @returns Name assigned to the imported wallet
   * @throws Error if file invalid or password incorrect
   */
  importFromBackup(importPath: string, password: string): string {
    try {
      const fileContents = this.storage.readFile(importPath);
      if (!fileContents) {
        throw new Error('Backup file not found or unreadable');
      }
      const backupData: ExportData = JSON.parse(fileContents);

      if (!backupData.wallet || !backupData.wallet.encryptedMnemonic) {
        throw new Error('Invalid backup file format');
      }

      try {
        decryptMnemonic(
          backupData.wallet.encryptedMnemonic,
          password,
          backupData.wallet.salt,
          backupData.wallet.iv,
          backupData.wallet.authTag
        );
      } catch {
        throw new Error('Incorrect password for backup file');
      }

      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
      let walletName = backupData.wallet.name;

      let counter = 1;
      const originalName = walletName;
      while (wallets[walletName]) {
        walletName = `${originalName}_${counter}`;
        counter++;
      }

      wallets[walletName] = {
        encryptedMnemonic: backupData.wallet.encryptedMnemonic,
        salt: backupData.wallet.salt,
        iv: backupData.wallet.iv,
        authTag: backupData.wallet.authTag,
        createdAt: backupData.wallet.createdAt,
        accounts: backupData.wallet.accounts || {},
        currentAccountIndex: backupData.wallet.currentAccountIndex || 0
      };

      this.storage.writeJSON('wallets.json', wallets);

      return walletName;
    } catch (error) {
      throw new Error(`Import failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get the private key for the current account.
   * Requires password verification for security.
   * 
   * @param password - Master password to verify
   * @returns Private key hex string
   * @throws Error if password incorrect or no wallet loaded
   */
  getPrivateKey(password: string): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('No encrypted wallet loaded');
    }

    decryptMnemonic(this.encryptedMnemonic, password, this.salt, this.iv, this.authTag);

    return this.wallet.privateKey;
  }

  /**
   * Get the mnemonic phrase for the wallet.
   * Requires password verification for security.
   *
   * @param password - Master password to verify
   * @returns BIP-39 mnemonic phrase
   * @throws Error if password incorrect or no wallet loaded
   */
  getMnemonic(password: string): string {
    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('No encrypted wallet loaded');
    }

    return decryptMnemonic(this.encryptedMnemonic, password, this.salt, this.iv, this.authTag);
  }

  // ============================================================================
  // Bitcoin Support
  // ============================================================================

  /**
   * Get a Bitcoin address derived from the same mnemonic.
   * Uses BIP-84 derivation path for Native SegWit (P2WPKH) addresses.
   *
   * @param network - Bitcoin network ('mainnet' or 'testnet')
   * @param accountIndex - Optional account index override (defaults to current)
   * @returns Bitcoin address information
   * @throws Error if no mnemonic loaded
   *
   * @example
   * ```typescript
   * const btcInfo = wallet.getBitcoinAddress('mainnet');
   * console.log(btcInfo.address); // bc1q...
   * ```
   */
  getBitcoinAddress(
    network: 'mainnet' | 'testnet' = 'mainnet',
    accountIndex?: number
  ): BitcoinAddressInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }

    const index = accountIndex ?? this.currentAccountIndex;
    return deriveBitcoinAddress(this.mnemonic, network, index, 0);
  }

  /**
   * Get the Bitcoin private key in WIF format.
   * Requires password verification for security.
   *
   * @param password - Master password to verify
   * @param network - Bitcoin network ('mainnet' or 'testnet')
   * @returns Private key in Wallet Import Format (WIF)
   * @throws Error if password incorrect or no wallet loaded
   */
  getBitcoinPrivateKey(
    password: string,
    network: 'mainnet' | 'testnet' = 'mainnet'
  ): string {
    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('No encrypted wallet loaded');
    }

    // Verify password by decrypting
    const mnemonic = decryptMnemonic(
      this.encryptedMnemonic,
      password,
      this.salt,
      this.iv,
      this.authTag
    );

    return getBitcoinPrivateKey(mnemonic, network, this.currentAccountIndex, 0);
  }

  // ============================================================================
  // Solana Support (Phase 1: Address)
  // ============================================================================

  /**
   * Get a Solana address derived from the same mnemonic.
   * Uses BIP-44 derivation path: m/44'/501'/{accountIndex}'/0'
   *
   * @param accountIndex - Optional account index override (defaults to current)
   * @returns Solana address information
   * @throws Error if no mnemonic loaded
   */
  getSolanaAddress(accountIndex?: number): SolanaAddressInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveSolanaAddress(this.mnemonic, index);
  }

  // ============================================================================
  // XRP Ledger Support
  // ============================================================================

  /**
   * Get an XRP address derived from the same mnemonic.
   * Uses BIP-44 derivation path: m/44'/144'/{accountIndex}'/0/0
   *
   * @param accountIndex - Optional account index override (defaults to current)
   * @returns XRP address information
   * @throws Error if no mnemonic loaded
   *
   * @example
   * ```typescript
   * const xrpInfo = wallet.getXRPAddress();
   * console.log(xrpInfo.address); // r...
   * ```
   */
  getXRPAddress(accountIndex?: number): XRPAddressInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveXRPAddress(this.mnemonic, index);
  }

  /**
   * Get the XRP private key in hex format.
   * Requires password verification for security.
   *
   * @param password - Master password to verify
   * @returns Private key as hex string
   * @throws Error if password incorrect or no wallet loaded
   */
  getXRPPrivateKey(password: string): string {
    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('No encrypted wallet loaded');
    }

    // Verify password by decrypting
    const mnemonic = decryptMnemonic(
      this.encryptedMnemonic,
      password,
      this.salt,
      this.iv,
      this.authTag
    );

    return getXRPPrivateKey(mnemonic, this.currentAccountIndex);
  }
}
