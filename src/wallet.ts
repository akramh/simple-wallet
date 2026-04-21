/**
 * @fileoverview Core HD wallet implementation.
 * 
 * This module provides the main Wallet class that acts as a manager for:
 * - Key management (Mnemonic/PrivateKey encryption/decryption)
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
  generateMnemonic,
  encryptData,
  decryptData
} from './crypto-utils.js';
import type { Config, TokenMetadata, Token } from './types/index.js';
import type { StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';
import { 
  deriveBitcoinAddress, 
  deriveBitcoinAddressFromPrivateKey, 
  getBitcoinPrivateKey, 
  type BitcoinAddressInfo 
} from './bitcoin/index.js';
import { 
  deriveSolanaAddress, 
  deriveSolanaAddressFromSecretKey, 
  type SolanaAddressInfo 
} from './solana/index.js';
import { 
  deriveXRPAddress, 
  deriveXRPAddressFromPrivateKey, 
  getXRPPrivateKey, 
  type XRPAddressInfo 
} from './xrp/index.js';
import { 
  deriveTonAddress, 
  deriveTonAddressFromSecretKey, 
  type TonAddressInfo 
} from './ton/index.js';
import { EthereumProvider } from './ethereum/provider.js';
import { deriveEthereumWallet } from './ethereum/address.js';

// ============================================================================
// Internal Type Definitions
// ============================================================================

/** Wallet creation/import result with sensitive data */
export interface WalletInfo {
  address: string;
  mnemonic?: string;
  privateKey?: string;
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

/** Encrypted wallet storage format (internal mapping to EncryptedWallet) */
interface WalletData {
  encryptedMnemonic?: string;
  encryptedPrivateKey?: string;
  importType?: 'mnemonic' | 'privateKey';
  privateKeyType?: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton';
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
  wallet: ethers.HDNodeWallet | ethers.Wallet | null;
  mnemonic: string | null;
  privateKey: string | null; // Raw private key for non-HD wallets
  
  // Persistence State
  encryptedMnemonic: string | null;
  encryptedPrivateKey: string | null;
  importType: 'mnemonic' | 'privateKey';
  privateKeyType?: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton';
  
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
    this.privateKey = null;
    
    this.encryptedMnemonic = null;
    this.encryptedPrivateKey = null;
    this.importType = 'mnemonic';
    
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

    if (this.wallet && this.provider && typeof (this.wallet as any).connect === 'function') {
      this.wallet = (this.wallet as any).connect(this.provider);
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

    if (this.wallet) {
      if (this.importType === 'mnemonic') {
        this.wallet = this._deriveAccount(this.currentAccountIndex).connect(this.provider!);
      } else if (this.importType === 'privateKey' && this.privateKeyType === 'evm') {
        // Re-connect the single private key wallet to the new provider
        this.wallet = new ethers.Wallet(this.privateKey!, this.provider!);
      }
    }
  }

  createNewWallet(password: string): WalletInfo {
    // Generate 24-word mnemonic by default for maximum security (256-bit entropy)
    this.mnemonic = generateMnemonic(24);
    this.importType = 'mnemonic';
    this.privateKey = null;

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
      this.importType = 'mnemonic';
      this.privateKey = null;

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
   * Imports a wallet from a raw private key (non-HD, single-address wallet).
   *
   * Unlike mnemonic-based wallets, private key wallets:
   * - Support only one account (no HD derivation)
   * - Are locked to a single chain family
   * - Cannot derive additional addresses
   *
   * @param key - Raw private key in chain-specific format:
   *   - EVM: Hex string with or without 0x prefix (64 hex chars)
   *   - Bitcoin: WIF (Wallet Import Format) string
   *   - Solana: Base58-encoded secret key (64 bytes)
   *   - XRP: Hex seed or family seed (s...) format
   *   - TON: Hex-encoded secret key (32 or 64 bytes)
   * @param type - Chain family for this private key
   * @param password - Master password for encrypting the key
   * @returns Wallet info containing the derived address
   * @throws Error if key is empty or invalid for the specified chain type
   *
   * @security This method handles raw private key material. The key is encrypted
   *   immediately using AES-256-GCM before being stored. The raw key is held in
   *   memory only for the duration of the session.
   *
   * @example
   * ```typescript
   * // Import an EVM private key
   * const info = wallet.importFromPrivateKey(
   *   '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
   *   'evm',
   *   'mySecurePassword123'
   * );
   * console.log(info.address); // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   * ```
   */
  importFromPrivateKey(key: string, type: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton', password: string): WalletInfo {
    if (!key || key.trim() === '') {
      throw new Error('Private key cannot be empty');
    }

    this.mnemonic = null;
    this.encryptedMnemonic = null;
    this.importType = 'privateKey';
    this.privateKeyType = type;
    this.privateKey = key.trim();
    this.currentAccountIndex = 0;

    // Encrypt the key using encryptData which returns { encrypted (string), salt }
    // The encrypted string contains iv:authTag:ciphertext
    const { encrypted, salt } = encryptData(this.privateKey, password);
    
    // We need to split the encrypted string to extract IV and AuthTag for storage consistency
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Encryption failed');
    const [iv, authTag, ciphertext] = parts;

    // Store ciphertext in encryptedPrivateKey field
    this.encryptedPrivateKey = ciphertext;
    this.salt = salt;
    this.iv = iv;
    this.authTag = authTag;

    let address = '';

    // Handle derivation based on type
    if (type === 'evm') {
      try {
        const wallet = new ethers.Wallet(this.privateKey, this.provider || undefined);
        this.wallet = wallet;
        address = wallet.address.toLowerCase();
      } catch (e) {
        throw new Error('Invalid EVM private key');
      }
    } else {
      // Non-EVM keys are stored but don't create an ethers.Wallet instance
      this.wallet = null; 
      address = 'Generated on demand';
    }

    return {
      address,
      privateKey: this.privateKey
    };
  }

  _deriveAccount(index: number): ethers.HDNodeWallet {
    if (this.importType === 'mnemonic') {
        if (!this.mnemonic) {
            throw new Error('No mnemonic available');
        }
        return deriveEthereumWallet(this.mnemonic, index);
    }
    throw new Error('Cannot derive accounts from a single private key wallet');
  }

  switchAccount(accountIndex: number): AccountInfo {
    if (this.importType === 'privateKey') {
      throw new Error('Cannot switch accounts on a private key wallet');
    }

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
    if (this.importType === 'privateKey') {
        // Index is ignored for private key wallets, but we should enforce 0
        if (index !== 0) throw new Error('Private key wallets only support account index 0');
        if (this.wallet) return this.wallet.address.toLowerCase();
        return ''; // Should derive for non-EVM
    }

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

  /**
   * Send an EVM token on a specific network without changing the wallet's
   * globally-active network. Builds a signer connected to the target RPC,
   * submits via the shared EthereumProvider send path, then restores the
   * active-network provider so other callers see the expected chain.
   *
   * Required for the cross-chain Send flow in the extension (e.g. the user is
   * on `mainnet` but picked a USDC-on-Polygon asset).
   *
   * @param token - Token to send
   * @param toAddress - Recipient address
   * @param amount - Amount in token units
   * @param networkKey - Target EVM network key (must exist in config.networks)
   */
  async sendTokenOnNetwork(
    token: Token,
    toAddress: string,
    amount: string,
    networkKey: string
  ): Promise<TransactionReceipt> {
    const targetProvider = await this.ethereumProvider.ensureProvider(networkKey);

    let signer: ethers.Wallet | ethers.HDNodeWallet;
    if (this.importType === 'privateKey') {
      if (!this.privateKey) {
        throw new Error('No private key available');
      }
      signer = new ethers.Wallet(this.privateKey, targetProvider);
    } else {
      const derived = this._deriveAccount(this.currentAccountIndex);
      signer = derived.connect(targetProvider);
    }

    try {
      return await this.ethereumProvider.sendToken(signer, token, toAddress, amount);
    } finally {
      // Restore the active-network provider so subsequent wallet.provider reads
      // target the user's selected network rather than the ad-hoc one.
      try {
        await this.ethereumProvider.ensureProvider(this.config.network);
      } catch {
        // Best-effort restore; swallow so we don't mask the original send error.
      }
    }
  }

  // ============================================================================
  // Storage & Management Methods (Generic)
  // ============================================================================

  saveWallet(walletName?: string): string {
    if (!this.wallet && !this.encryptedPrivateKey) {
      // Must have either a loaded wallet (EVM) or encrypted key (Non-EVM private key)
      throw new Error('No wallet loaded');
    }

    if ((this.importType === 'mnemonic' && !this.encryptedMnemonic) ||
        (this.importType === 'privateKey' && !this.encryptedPrivateKey)) {
         throw new Error('Wallet not properly encrypted');
    }
    
    if (!this.salt || !this.iv || !this.authTag) {
      throw new Error('Wallet encryption metadata missing');
    }

    const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});

    if (!walletName) {
      walletName = this.wallet ? this.wallet.address.substring(0, 10) : 'wallet';
    }

    // Prepare wallet data
    const walletData: WalletData = {
        importType: this.importType,
        privateKeyType: this.privateKeyType,
        encryptedMnemonic: this.encryptedMnemonic || undefined,
        encryptedPrivateKey: this.encryptedPrivateKey || undefined,
        salt: this.salt,
        iv: this.iv,
        authTag: this.authTag,
        createdAt: new Date().toISOString(),
        accounts: {},
        currentAccountIndex: 0
    };

    if (wallets[walletName]) {
        // Preserve existing creation date and accounts if updating
        walletData.createdAt = wallets[walletName].createdAt;
        walletData.accounts = wallets[walletName].accounts;
        // But we overwrite secrets
    }

    const address = this.wallet ? this.wallet.address.toLowerCase() : 'derived-on-demand';

    walletData.accounts[this.currentAccountIndex] = {
      address: address,
      createdAt: walletData.accounts[this.currentAccountIndex]?.createdAt || new Date().toISOString()
    };

    walletData.currentAccountIndex = this.currentAccountIndex;
    
    wallets[walletName] = walletData;

    this.storage.writeJSON('wallets.json', wallets);

    return walletName;
  }

  /**
   * Change the master password for a stored wallet.
   *
   * Re-encrypts the mnemonic/key with the new password and updates wallets.json.
   */
  changePassword(walletName: string, currentPassword: string, newPassword: string): void {
    if (!walletName) {
      throw new Error('Wallet name is required');
    }

    const wallets = this.storage.readJSON<WalletsFile>('wallets.json', {});
    const walletData = wallets[walletName];
    if (!walletData) {
      throw new Error('Wallet not found');
    }

    // Determine import type (default to mnemonic for legacy compatibility)
    const importType = walletData.importType || 'mnemonic';

    if (importType === 'mnemonic') {
        if (!walletData.encryptedMnemonic) throw new Error('Corrupted wallet data');
        
        let mnemonic: string;
        try {
            mnemonic = decryptMnemonic(
                walletData.encryptedMnemonic,
                currentPassword,
                walletData.salt,
                walletData.iv,
                walletData.authTag
            );
        } catch (error) {
            throw new Error('Incorrect password');
        }

        if (!validateMnemonic(mnemonic)) {
            throw new Error('Incorrect password');
        }

        const { encrypted, salt, iv, authTag } = encryptMnemonic(mnemonic, newPassword);

        wallets[walletName] = {
            ...walletData,
            encryptedMnemonic: encrypted,
            salt,
            iv,
            authTag,
        };
        
        // Update current instance if it matches
        if (this.mnemonic === mnemonic) {
            this.encryptedMnemonic = encrypted;
            this.salt = salt;
            this.iv = iv;
            this.authTag = authTag;
        }

    } else {
        // Private Key
        if (!walletData.encryptedPrivateKey) throw new Error('Corrupted wallet data');

        let privateKey: string;
        try {
            // Reconstruct full encrypted string iv:authTag:ciphertext
            const fullEncrypted = `${walletData.iv}:${walletData.authTag}:${walletData.encryptedPrivateKey}`;
            
            privateKey = decryptData(
                fullEncrypted,
                currentPassword,
                walletData.salt
            );
        } catch (error) {
             throw new Error('Incorrect password');
        }

        const { encrypted, salt } = encryptData(privateKey, newPassword);
        // encrypted is iv:authTag:ciphertext
        const parts = encrypted.split(':');
        const [iv, authTag, ciphertext] = parts;

        wallets[walletName] = {
            ...walletData,
            encryptedPrivateKey: ciphertext,
            salt,
            iv,
            authTag
        };

        if (this.privateKey === privateKey) {
            this.encryptedPrivateKey = ciphertext;
            this.salt = salt;
            this.iv = iv;
            this.authTag = authTag;
        }
    }

    this.storage.writeJSON('wallets.json', wallets);
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
        this.importType = walletData.importType || 'mnemonic';
        this.privateKeyType = walletData.privateKeyType;

        if (this.importType === 'mnemonic') {
            if (!walletData.encryptedMnemonic) throw new Error('Missing mnemonic data');
            
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
            this.mnemonic = mnemonic;
            
            const indexToLoad = accountIndex !== null ? accountIndex : (walletData.currentAccountIndex || 0);
            this.currentAccountIndex = indexToLoad;
            const derived = this._deriveAccount(indexToLoad);
            this.wallet = this.provider ? derived.connect(this.provider) : derived;
            
            this.salt = walletData.salt;
            this.iv = walletData.iv;
            this.authTag = walletData.authTag;
    
            return {
              address: this.wallet.address.toLowerCase(),
              mnemonic: this.mnemonic,
              privateKey: this.wallet.privateKey
            };
        } else {
            // Private Key
            if (!walletData.encryptedPrivateKey) throw new Error('Missing private key data');
            
            const fullEncrypted = `${walletData.iv}:${walletData.authTag}:${walletData.encryptedPrivateKey}`;
            const privateKey = decryptData(
                fullEncrypted,
                password,
                walletData.salt
            );

            this.encryptedPrivateKey = walletData.encryptedPrivateKey;
            this.privateKey = privateKey;
            this.salt = walletData.salt;
            this.iv = walletData.iv;
            this.authTag = walletData.authTag;
            this.currentAccountIndex = 0; // Always 0

            let address = '';
            if (this.privateKeyType === 'evm') {
                const wallet = new ethers.Wallet(privateKey, this.provider || undefined);
                this.wallet = wallet;
                address = wallet.address.toLowerCase();
            } else {
                this.wallet = null;
                address = 'derived-on-demand';
            }

            return {
                address,
                privateKey
            };
        }
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
        this.importType = walletData.importType || 'mnemonic';
        this.privateKeyType = walletData.privateKeyType;
        
        if (this.importType === 'mnemonic') {
            if (!walletData.encryptedMnemonic) throw new Error('Missing mnemonic data');

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
            this.mnemonic = mnemonic;
            
            const indexToLoad = accountIndex !== null ? accountIndex : (walletData.currentAccountIndex || 0);
            this.currentAccountIndex = indexToLoad;
            const derived = this._deriveAccount(indexToLoad);
            this.wallet = this.provider ? derived.connect(this.provider) : derived;
            
            this.salt = walletData.salt;
            this.iv = walletData.iv;
            this.authTag = walletData.authTag;
    
            return {
              address: this.wallet.address.toLowerCase(),
              mnemonic: this.mnemonic,
              privateKey: this.wallet.privateKey
            };
        } else {
             // Use sync load for private keys for now (small payload)
             return this.loadWallet(walletName, password, accountIndex);
        }
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

      if (!backupData.wallet) {
        throw new Error('Invalid backup file format');
      }
      
      const importType = backupData.wallet.importType || 'mnemonic';

      try {
        if (importType === 'mnemonic') {
            if (!backupData.wallet.encryptedMnemonic) throw new Error('Missing mnemonic');
            decryptMnemonic(
              backupData.wallet.encryptedMnemonic,
              password,
              backupData.wallet.salt,
              backupData.wallet.iv,
              backupData.wallet.authTag
            );
        } else {
             if (!backupData.wallet.encryptedPrivateKey) throw new Error('Missing private key');
             const fullEncrypted = `${backupData.wallet.iv}:${backupData.wallet.authTag}:${backupData.wallet.encryptedPrivateKey}`;
             decryptData(
              fullEncrypted,
              password,
              backupData.wallet.salt
            );
        }
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
        importType,
        privateKeyType: backupData.wallet.privateKeyType,
        encryptedMnemonic: backupData.wallet.encryptedMnemonic,
        encryptedPrivateKey: backupData.wallet.encryptedPrivateKey,
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
    if (this.importType === 'mnemonic') {
        if (!this.encryptedMnemonic || !this.salt || !this.iv || !this.authTag) {
          throw new Error('No encrypted wallet loaded');
        }
        decryptMnemonic(this.encryptedMnemonic, password, this.salt, this.iv, this.authTag);
        if (!this.wallet) throw new Error('Wallet not initialized');
        return this.wallet.privateKey;
    } else {
        if (!this.encryptedPrivateKey || !this.salt || !this.iv || !this.authTag) {
          throw new Error('No encrypted wallet loaded');
        }
        const fullEncrypted = `${this.iv}:${this.authTag}:${this.encryptedPrivateKey}`;
        return decryptData(fullEncrypted, password, this.salt);
    }
  }

  getMnemonic(password: string): string {
    if (this.importType === 'privateKey') {
        throw new Error('This wallet has no mnemonic phrase');
    }
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
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'bitcoin') {
             throw new Error('This wallet does not support Bitcoin');
        }
        if (!this.privateKey) throw new Error('Private key not loaded');
        // Derive address from the raw private key (WIF)
        return deriveBitcoinAddressFromPrivateKey(this.privateKey, network);
    }

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
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'bitcoin') {
             throw new Error('This wallet does not support Bitcoin');
        }
        return this.getPrivateKey(password);
    }
  
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
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'solana') throw new Error('This wallet does not support Solana');
        if (!this.privateKey) throw new Error('Private key not loaded');
        return deriveSolanaAddressFromSecretKey(this.privateKey);
    }

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
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'xrp') throw new Error('This wallet does not support XRP');
        if (!this.privateKey) throw new Error('Private key not loaded');
        return deriveXRPAddressFromPrivateKey(this.privateKey);
    }

    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveXRPAddress(this.mnemonic, index);
  }

  getXRPPrivateKey(password: string): string {
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'xrp') throw new Error('This wallet does not support XRP');
        return this.getPrivateKey(password);
    }

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
    if (this.importType === 'privateKey') {
        if (this.privateKeyType !== 'ton') throw new Error('This wallet does not support TON');
        if (!this.privateKey) throw new Error('Private key not loaded');
        return deriveTonAddressFromSecretKey(this.privateKey);
    }

    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const index = accountIndex ?? this.currentAccountIndex;
    return deriveTonAddress(this.mnemonic, index);
  }
}
