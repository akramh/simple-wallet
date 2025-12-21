/**
 * @fileoverview Core HD wallet implementation.
 * 
 * This module provides the main Wallet class that acts as a manager for:
 * - Key management (Mnemonic encryption/decryption)
 * - Account management (BIP-44)
 * - Delegation to chain-specific providers (Ethereum, Bitcoin, Solana, XRP, TON)
 * 
 * @module wallet
 */

import { ethers } from 'ethers';
import { 
  encryptMnemonic, 
  decryptMnemonic, 
  encryptMnemonicAsync, 
  decryptMnemonicAsync, 
  validateMnemonic, 
  generateMnemonic 
} from './crypto-utils.js';
import type { Config, TokenMetadata, Token } from './types/index.js';
import type { StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';
import { deriveBitcoinAddress, getBitcoinPrivateKey, type BitcoinAddressInfo } from './bitcoin/index.js';
import { deriveSolanaAddress, type SolanaAddressInfo } from './solana/index.js';
import { deriveXRPAddress, getXRPPrivateKey, type XRPAddressInfo } from './xrp/index.js';
import { deriveTonAddress, type TonAddressInfo } from './ton/index.js';
import { EthereumProvider } from './ethereum/provider.js';
import { deriveEthereumWallet } from './ethereum/address.js';

// ============================================================================
// Internal Type Definitions
// ============================================================================

/** Wallet creation/import result with sensitive data */
interface WalletInfo {
  address: string;
  mnemonic: string;
  privateKey: string;
}

/** Account switch result */
interface AccountInfo {
  address: string;
  accountIndex: number;
}

/** Transaction receipt after confirmation */
interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  gasUsed: string;
}

/** Encrypted wallet storage format */
interface WalletData {
  encryptedMnemonic: string;
  salt: string;
  iv: string;
  authTag: string;
  createdAt: string;
  accounts: Record<number, { address: string; createdAt: string }>;
  currentAccountIndex: number;
}

/** wallets.json file structure */
interface WalletsFile {
  [walletName: string]: WalletData;
}

/** Encrypted wallet export format */
interface ExportData {
  version: string;
  exportedAt: string;
  wallet: {
    name: string;
  } & WalletData;
}

/** Portfolio balance query result */
interface PortfolioResult {
  token: Token;
  balance: string;
  error?: string;
}

// ============================================================================
// Wallet Class
// ============================================================================

export class Wallet {
  config: Config;
  storage: StorageAdapter;
  private _providerFactory: ProviderFactory;

  // EVM Provider
  ethereumProvider: EthereumProvider;

  // State
  wallet: ethers.HDNodeWallet | null;
  mnemonic: string | null;
  encryptedMnemonic: string | null;
  salt: string | null;
  iv: string | null;
  authTag: string | null;
  currentAccountIndex: number;

  // Compatibility
  ProviderClass = ethers.JsonRpcProvider;
  private _ContractClass: typeof ethers.Contract = ethers.Contract;

  get ContractClass(): typeof ethers.Contract {
    return this._ContractClass;
  }

  set ContractClass(val: typeof ethers.Contract) {
    this._ContractClass = val;
    if (this.ethereumProvider) {
      this.ethereumProvider.ContractClass = val;
    }
  }

  constructor(config: Config, storage: StorageAdapter, providerFactory?: ProviderFactory) {
    this.config = config;
    this.storage = storage;
    this.wallet = null;
    this.mnemonic = null;
    this.encryptedMnemonic = null;
    this.salt = null;
    this.iv = null;
    this.authTag = null;
    this.currentAccountIndex = 0;
    
    this._providerFactory = providerFactory || {
      createProvider: (rpcUrl: string, chainId: number) => new ethers.JsonRpcProvider(rpcUrl, chainId)
    };

    this.ethereumProvider = new EthereumProvider(config, this._providerFactory);
  }

  get providerFactory(): ProviderFactory {
    return this._providerFactory;
  }

  set providerFactory(val: ProviderFactory) {
    this._providerFactory = val;
    if (this.ethereumProvider) {
      this.ethereumProvider.setProviderFactory(val);
    }
  }

  get provider(): ethers.JsonRpcProvider | null {
    return this.ethereumProvider.getProvider();
  }

  async initialize(): Promise<void> {
    const networkConfig = this.config.networks[this.config.network];
    // Implicitly EVM if type is missing
    if (!networkConfig?.type || networkConfig.type === 'evm') {
      await this.ethereumProvider.ensureProvider(this.config.network);
    }
  }

  async setNetwork(networkKey: string): Promise<void> {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) {
      throw new Error('Network not found in configuration');
    }
    
    if (networkConfig.type === 'bitcoin' || networkConfig.type === 'solana') {
      throw new Error('Non-EVM networks must be handled by the app service');
    }

    this.config.network = networkKey;
    // Implicitly EVM if type is missing
    if (!networkConfig.type || networkConfig.type === 'evm') {
        await this.ethereumProvider.ensureProvider(networkKey);
    }

    if (this.wallet && this.mnemonic) {
      this.wallet = this._deriveAccount(this.currentAccountIndex).connect(this.provider!);
    }
  }

  createNewWallet(password: string): WalletInfo {
    // Generate 24-word mnemonic by default for maximum security (256-bit entropy)
    this.mnemonic = generateMnemonic(24);

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

  importWallet(mnemonic: string, password: string, accountIndex: number = 0): WalletInfo {
    const normalizedMnemonic = mnemonic.trim().toLowerCase();

    if (!validateMnemonic(normalizedMnemonic)) {
      throw new Error('Invalid mnemonic phrase format.');
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

  _deriveAccount(index: number): ethers.HDNodeWallet {
    if (!this.mnemonic) {
      throw new Error('No mnemonic available');
    }
    return deriveEthereumWallet(this.mnemonic, index);
  }

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

  getAccountAddress(index: number): string {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const account = this._deriveAccount(index);
    return account.address.toLowerCase();
  }

  getCurrentAccountIndex(): number {
    return this.currentAccountIndex;
  }

  // ============================================================================
  // EVM Operations (Delegated to EthereumProvider)
  // ============================================================================

  async getBalance(): Promise<string> {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.ethereumProvider.getBalance(this.wallet.address);
  }

  getAddress(): string {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.wallet.address.toLowerCase();
  }

  async sendTransaction(toAddress: string, amount: string): Promise<TransactionReceipt> {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.ethereumProvider.sendTransaction(this.wallet, toAddress, amount);
  }

  async getTokenMetadata(address: string): Promise<TokenMetadata> {
    return this.ethereumProvider.getTokenMetadata(address);
  }

  async getTokenBalance(token: Token): Promise<string> {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.ethereumProvider.getTokenBalance(token, this.wallet.address);
  }

  async getPortfolio(tokens: Token[] = []): Promise<PortfolioResult[]> {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.ethereumProvider.getPortfolio(tokens, this.wallet.address);
  }

  async sendToken(token: Token, toAddress: string, amount: string): Promise<TransactionReceipt> {
    if (!this.wallet) throw new Error('No wallet loaded');
    return this.ethereumProvider.sendToken(this.wallet, token, toAddress, amount);
  }

  // ============================================================================
  // Storage & Management Methods (Generic)
  // ============================================================================

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
   * Load wallet synchronously.
   * @deprecated Use loadWalletAsync() for better performance in React Native
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
   * Load wallet asynchronously with native-speed PBKDF2.
   * Uses react-native-quick-crypto when available for fast key derivation.
   * 
   * @param walletName - Name of wallet to load
   * @param password - Password for decryption
   * @param accountIndex - Optional account index to load
   * @returns Promise resolving to wallet info or null
   */
  async loadWalletAsync(walletName: string, password: string, accountIndex: number | null = null): Promise<WalletInfo | null> {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});

      if (walletName && wallets[walletName]) {
        const walletData = wallets[walletName];

        const mnemonic = await decryptMnemonicAsync(
          walletData.encryptedMnemonic,
          password,
          walletData.salt,
          walletData.iv,
          walletData.authTag
        );

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

  getAllWallets(): WalletsFile {
    try {
      const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
      return wallets;
    } catch (error) {
      return {};
    }
  }

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

  getMnemonic(password: string): string {
    if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
      throw new Error('No encrypted wallet loaded');
    }

    return decryptMnemonic(this.encryptedMnemonic, password, this.salt, this.iv, this.authTag);
  }

  // ============================================================================
  // Bitcoin Support
  // ============================================================================

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

  getXRPAddress(accountIndex?: number): XRPAddressInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveXRPAddress(this.mnemonic, index);
  }

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

  // ============================================================================
  // TON Support
  // ============================================================================

  /**
   * Get the TON address for a given account index.
   *
   * @param accountIndex - BIP-44 account index
   * @returns TON address info
   */
  getTonAddress(accountIndex?: number): TonAddressInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveTonAddress(this.mnemonic, index);
  }
}
