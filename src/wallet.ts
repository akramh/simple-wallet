import { ethers } from 'ethers';
import { encryptMnemonic, decryptMnemonic, validateMnemonic } from './crypto-utils.js';
import type { Config, TokenMetadata, Token, PortfolioToken } from './types/index.js';
import type { StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];

interface WalletInfo {
  address: string;
  mnemonic: string;
  privateKey: string;
}

interface AccountInfo {
  address: string;
  accountIndex: number;
}

interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  gasUsed: string;
}

interface WalletData {
  encryptedMnemonic: string;
  salt: string;
  iv: string;
  authTag: string;
  createdAt: string;
  accounts: Record<number, { address: string; createdAt: string }>;
  currentAccountIndex: number;
}

interface WalletsFile {
  [walletName: string]: WalletData;
}

interface ExportData {
  version: string;
  exportedAt: string;
  wallet: {
    name: string;
  } & WalletData;
}

interface PortfolioResult {
  token: Token;
  balance: string;
  error?: string;
}

export class Wallet {
  config: Config;
  wallet: ethers.HDNodeWallet | null;
  provider: ethers.JsonRpcProvider | null;
  providers: Record<string, ethers.JsonRpcProvider>;
  rpcIndex: Record<string, number>;
  mnemonic: string | null;
  encryptedMnemonic: string | null;
  salt: string | null;
  iv: string | null;
  authTag: string | null;
  currentAccountIndex: number;
  tokenMetadataCache: Record<string, TokenMetadata>;
  ProviderClass: typeof ethers.JsonRpcProvider;
  ContractClass: typeof ethers.Contract;
  providerFactory: ProviderFactory;
  storage: StorageAdapter;

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
   * Retry RPC requests with exponential backoff
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

  async initialize(): Promise<void> {
    await this._ensureProvider(this.config.network);
  }

  _getRpcList(networkKey: string): string[] {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) return [];
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

  async _ensureProvider(networkKey: string): Promise<ethers.JsonRpcProvider> {
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
      const candidate = this.providerFactory.createProvider(
        rpcUrl,
        this.config.networks[networkKey].chainId
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

  async setNetwork(networkKey: string): Promise<void> {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) {
      throw new Error('Network not found in configuration');
    }

    this.config.network = networkKey;
    await this._ensureProvider(networkKey);

    if (this.wallet && this.mnemonic) {
      this.wallet = this._deriveAccount(this.currentAccountIndex).connect(this.provider!);
    }
  }

  createNewWallet(password: string): WalletInfo {
    const randomWallet = ethers.Wallet.createRandom();
    this.mnemonic = randomWallet.mnemonic!.phrase;

    const { encrypted, salt, iv, authTag } = encryptMnemonic(this.mnemonic, password);
    this.encryptedMnemonic = encrypted;
    this.salt = salt;
    this.iv = iv;
    this.authTag = authTag;

    this.currentAccountIndex = 0;
    this.wallet = this._deriveAccount(0).connect(this.provider!);

    return {
      address: this.wallet.address.toLowerCase(),
      mnemonic: this.mnemonic,
      privateKey: this.wallet.privateKey
    };
  }

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
      this.wallet = this._deriveAccount(accountIndex).connect(this.provider!);

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
    const path = `m/44'/60'/0'/0/${index}`;
    return ethers.HDNodeWallet.fromPhrase(this.mnemonic, "", path);
  }

  switchAccount(accountIndex: number): AccountInfo {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    this.currentAccountIndex = accountIndex;
    this.wallet = this._deriveAccount(accountIndex).connect(this.provider!);
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

  /**
   * Return the currently selected account index.
   * Useful for UI components that need to highlight the active account.
   */
  getCurrentAccountIndex(): number {
    return this.currentAccountIndex;
  }

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

  getAddress(): string {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }
    return this.wallet.address.toLowerCase();
  }

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

  _getTokenContract(address: string, withSigner: boolean = true): ethers.Contract {
    const target = withSigner ? this.wallet : this.provider;
    return new this.ContractClass(address, ERC20_ABI, target);
  }

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

  async _resolveTokenDecimals(token: Token): Promise<number> {
    if (typeof token.decimals === 'number') {
      return token.decimals;
    }

    const metadata = await this.getTokenMetadata(token.address);
    return metadata.decimals;
  }

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
        this.wallet = this._deriveAccount(indexToLoad).connect(this.provider!);

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
}
