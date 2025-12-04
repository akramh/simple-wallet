import { ethers } from 'ethers';
import fs from 'fs';
import { encryptMnemonic, decryptMnemonic, validateMnemonic, safeWriteJSON, safeReadJSON } from './crypto-utils.js';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];

export class Wallet {
  constructor(config) {
    this.config = config;
    this.wallet = null;
    this.provider = null;
    this.providers = {};
    this.rpcIndex = {}; // track which RPC is active per network
    this.mnemonic = null;
    this.encryptedMnemonic = null;
    this.salt = null;
    this.currentAccountIndex = 0;
    this.tokenMetadataCache = {};
    // Allow tests to inject mock provider/contract classes without touching the ethers module
    this.ProviderClass = ethers.JsonRpcProvider;
    this.ContractClass = ethers.Contract;
  }

  /**
   * Retry RPC requests with exponential backoff
   * @param {Function} operation - Async function to retry
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} baseDelay - Base delay in ms
   * @returns {Promise} - Result of operation
   */
  async _retryRpcRequest(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          operation(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), 30000)
          )
        ]);
        return result;
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async initialize() {
    // Bootstrap provider for the configured network. Network can be changed later via setNetwork.
    await this._ensureProvider(this.config.network);
  }

  _getRpcList(networkKey) {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) return [];
    const urls = [];
    if (networkConfig.rpcUrl) urls.push(networkConfig.rpcUrl);
    if (Array.isArray(networkConfig.rpcUrls)) {
      urls.push(...networkConfig.rpcUrls);
    }
    // Deduplicate
    return [...new Set(urls)];
  }

  async _ensureProvider(networkKey) {
    // Build/return a provider for the given network with simple failover across configured RPC URLs.
    const rpcList = this._getRpcList(networkKey);
    if (!rpcList.length) {
      throw new Error('No RPC URLs configured for network');
    }

    // Use cached provider if exists
    if (this.providers[networkKey]) {
      this.provider = this.providers[networkKey];
      return this.provider;
    }

    let lastError;
    for (let i = 0; i < rpcList.length; i++) {
      const rpcUrl = rpcList[i];
      const candidate = new this.ProviderClass(
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
        lastError = error;
      }
    }

    throw new Error(`All RPC endpoints failed for ${networkKey}: ${lastError?.message || 'unknown error'}`);
  }

  async setNetwork(networkKey) {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) {
      throw new Error('Network not found in configuration');
    }

    this.config.network = networkKey;
    await this._ensureProvider(networkKey);

    // Reconnect current account to the new provider if wallet is loaded
    if (this.wallet && this.mnemonic) {
      this.wallet = this._deriveAccount(this.currentAccountIndex).connect(this.provider);
    }

    // Light connectivity check already done in _ensureProvider
  }

  createNewWallet(password) {
    // Create a random mnemonic using ethers
    const randomWallet = ethers.Wallet.createRandom();
    this.mnemonic = randomWallet.mnemonic.phrase;

    // Encrypt mnemonic with password
    const { encrypted, salt } = encryptMnemonic(this.mnemonic, password);
    this.encryptedMnemonic = encrypted;
    this.salt = salt;

    // Derive Account 1 (index 0) using the standard BIP-44 path
    this.currentAccountIndex = 0;
    this.wallet = this._deriveAccount(0).connect(this.provider);

    return {
      address: this.wallet.address.toLowerCase(),
      mnemonic: this.mnemonic,
      privateKey: this.wallet.privateKey
    };
  }

  importWallet(mnemonic, password, accountIndex = 0) {
    // Validate mnemonic format first
    const normalizedMnemonic = mnemonic.trim().toLowerCase();

    if (!validateMnemonic(normalizedMnemonic)) {
      throw new Error('Invalid mnemonic phrase format. Must be 12, 15, 18, 21, or 24 words.');
    }

    try {
      this.mnemonic = normalizedMnemonic;

      // Encrypt mnemonic with password
      const { encrypted, salt } = encryptMnemonic(this.mnemonic, password);
      this.encryptedMnemonic = encrypted;
      this.salt = salt;

      this.currentAccountIndex = accountIndex;
      this.wallet = this._deriveAccount(accountIndex).connect(this.provider);

      return {
        address: this.wallet.address.toLowerCase(),
        mnemonic: this.mnemonic,
        privateKey: this.wallet.privateKey
      };
    } catch (error) {
      throw new Error('Invalid mnemonic phrase or unable to derive wallet');
    }
  }

  _deriveAccount(index) {
    // Standard BIP-44 derivation path for Ethereum
    // MetaMask and most wallets use address_index (last position)
    // Account 1: m/44'/60'/0'/0/0
    // Account 2: m/44'/60'/0'/0/1
    // Account 3: m/44'/60'/0'/0/2
    const path = `m/44'/60'/0'/0/${index}`;
    return ethers.HDNodeWallet.fromPhrase(this.mnemonic, "", path);
  }

  switchAccount(accountIndex) {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    this.currentAccountIndex = accountIndex;
    this.wallet = this._deriveAccount(accountIndex).connect(this.provider);
    return {
      address: this.wallet.address.toLowerCase(),
      accountIndex: accountIndex
    };
  }

  getAccountAddress(index) {
    if (!this.mnemonic) {
      throw new Error('No mnemonic loaded');
    }
    const account = this._deriveAccount(index);
    return account.address.toLowerCase();
  }

  async getBalance() {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const balance = await this._retryRpcRequest(
        () => this.provider.getBalance(this.wallet.address),
        3,
        1000
      );
      return ethers.formatEther(balance);
    } catch (error) {
      if (error.message.includes('timeout')) {
        throw new Error('Network request timed out. Please check your internet connection or try a different RPC endpoint.');
      }
      throw error;
    }
  }

  getAddress() {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }
    return this.wallet.address.toLowerCase();
  }

  async sendTransaction(toAddress, amount) {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    try {
      const value = ethers.parseEther(amount);

      // 1. Check balance first
      const balance = await this._retryRpcRequest(
        () => this.provider.getBalance(this.wallet.address)
      );

      // 2. Estimate gas
      let gasLimit;
      let gasPrice;
      try {
        gasLimit = await this._retryRpcRequest(() =>
          this.provider.estimateGas({
            to: toAddress,
            value: value,
            from: this.wallet.address
          })
        );

        // Add 20% buffer to gas limit
        gasLimit = (gasLimit * 120n) / 100n;

        // Get current gas price
        const feeData = await this._retryRpcRequest(() =>
          this.provider.getFeeData()
        );
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        // Fallback gas limit if estimation fails
        gasLimit = 21000n;
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      // 3. Calculate total cost (amount + gas)
      const estimatedGasCost = gasLimit * gasPrice;
      const totalCost = value + estimatedGasCost;

      // 4. Validate sufficient balance
      if (balance < totalCost) {
        const balanceEth = ethers.formatEther(balance);
        const neededEth = ethers.formatEther(totalCost);
        const gasCostEth = ethers.formatEther(estimatedGasCost);
        throw new Error(
          `Insufficient balance. You have ${balanceEth} ETH but need ${neededEth} ETH (${amount} ETH + ~${gasCostEth} ETH gas)`
        );
      }

      // 5. Send transaction
      const tx = await this.wallet.sendTransaction({
        to: toAddress,
        value: value,
        gasLimit: gasLimit
      });

      console.log(`\nTransaction sent! Hash: ${tx.hash}`);
      console.log('Waiting for confirmation...');

      // 6. Wait for confirmation with timeout
      const receipt = await this._retryRpcRequest(
        () => tx.wait(),
        5,
        2000
      );

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      // Provide more helpful error messages
      if (error.message.includes('insufficient funds')) {
        throw new Error('Insufficient funds for transaction');
      }
      if (error.message.includes('nonce')) {
        throw new Error('Transaction nonce error. Please try again.');
      }
      if (error.message.includes('gas')) {
        throw new Error(`Gas estimation failed: ${error.message}`);
      }
      if (error.code === 'CALL_EXCEPTION') {
        throw new Error('Transaction would fail. Check recipient address and amount.');
      }

      throw error;
    }
  }

  _getTokenContract(address, withSigner = true) {
    const target = withSigner ? this.wallet : this.provider;
    return new this.ContractClass(address, ERC20_ABI, target);
  }

  async getTokenMetadata(address) {
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

      const meta = {
        address: address.toLowerCase(),
        symbol,
        name,
        decimals: Number(decimals)
      };

      this.tokenMetadataCache[key] = meta;
      return meta;
    } catch (error) {
      throw new Error(`Unable to fetch token metadata: ${error.message}`);
    }
  }

  async _resolveTokenDecimals(token) {
    if (typeof token.decimals === 'number') {
      return token.decimals;
    }

    const metadata = await this.getTokenMetadata(token.address);
    return metadata.decimals;
  }

  async getTokenBalance(token) {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (token.type === 'native') {
      return this.getBalance();
    }

    const decimals = await this._resolveTokenDecimals(token);
    const contract = this._getTokenContract(token.address, false);

    try {
      const balance = await this._retryRpcRequest(() => contract.balanceOf(this.wallet.address));
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      if (error.code === 'BAD_DATA') {
        throw new Error('Token read failed: RPC returned empty/invalid data (check token address, network, or try another RPC)');
      }
      if (error.message.includes('timeout')) {
        throw new Error('Token balance request timed out. Try again or switch RPC.');
      }
      throw error;
    }
  }

  async getPortfolio(tokens = []) {
    // Fetch balances in parallel per token to keep the UI responsive.
    const promises = tokens.map(async (token) => {
      try {
        const balance = await this.getTokenBalance(token);
        return { token, balance };
      } catch (error) {
        return { token, balance: 'Error', error: error.message };
      }
    });

    return Promise.all(promises);
  }

  async sendToken(token, toAddress, amount) {
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

      // Ensure we have enough ETH for gas
      const nativeBalance = await this._retryRpcRequest(() => this.provider.getBalance(this.wallet.address));

      // Estimate gas for transfer
      let gasLimit;
      let gasPrice;
      try {
        gasLimit = await this._retryRpcRequest(() => contract.transfer.estimateGas(toAddress, value));
        gasLimit = (gasLimit * 120n) / 100n;

        const feeData = await this._retryRpcRequest(() => this.provider.getFeeData());
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        gasLimit = 120000n; // conservative fallback for ERC-20 transfer
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      const estimatedGasCost = gasPrice ? gasLimit * gasPrice : 0n;
      if (nativeBalance < estimatedGasCost) {
        const neededEth = ethers.formatEther(estimatedGasCost);
        const balanceEth = ethers.formatEther(nativeBalance);
        throw new Error(`Insufficient ETH for gas. Need ~${neededEth} ETH, have ${balanceEth} ETH.`);
      }

      const tx = await this._retryRpcRequest(() => contract.transfer(toAddress, value, { gasLimit }));
      console.log(`\nToken transaction sent! Hash: ${tx.hash}`);
      console.log('Waiting for confirmation...');

      const receipt = await this._retryRpcRequest(() => tx.wait(), 5, 2000);

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      if (error.message.includes('insufficient funds')) {
        throw new Error('Insufficient balance for token transfer');
      }
      if (error.code === 'CALL_EXCEPTION') {
        throw new Error('Token transfer would fail. Check recipient and amount.');
      }
      throw error;
    }
  }

  saveWallet(walletName) {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.encryptedMnemonic || !this.salt) {
      throw new Error('Wallet not properly encrypted');
    }

    // Use safe read
    const wallets = safeReadJSON('wallets.json');

    if (!walletName) {
      walletName = this.wallet.address.substring(0, 10);
    }

    // Get or create wallet entry
    if (!wallets[walletName]) {
      wallets[walletName] = {
        encryptedMnemonic: this.encryptedMnemonic,
        salt: this.salt,
        createdAt: new Date().toISOString(),
        accounts: {}
      };
    }

    // Add current account if not exists
    wallets[walletName].accounts[this.currentAccountIndex] = {
      address: this.wallet.address.toLowerCase(),
      createdAt: wallets[walletName].accounts[this.currentAccountIndex]?.createdAt || new Date().toISOString()
    };

    // Update current account
    wallets[walletName].currentAccountIndex = this.currentAccountIndex;

    // Use safe write (atomic with backup)
    safeWriteJSON('wallets.json', wallets);

    console.log(`\nWallet saved as "${walletName}"`);
    console.log('WARNING: Keep this file secure and back up your mnemonic phrase!');

    return walletName;
  }

  loadWallet(walletName, password, accountIndex = null) {
    try {
      const wallets = safeReadJSON('wallets.json');

      if (walletName && wallets[walletName]) {
        const walletData = wallets[walletName];

        // Decrypt mnemonic (throws if password wrong)
        const mnemonic = decryptMnemonic(
          walletData.encryptedMnemonic,
          password,
          walletData.salt
        );

        // Store encrypted version and salt
        this.encryptedMnemonic = walletData.encryptedMnemonic;
        this.salt = walletData.salt;
        this.mnemonic = mnemonic;

        const indexToLoad = accountIndex !== null ? accountIndex : (walletData.currentAccountIndex || 0);
        this.currentAccountIndex = indexToLoad;
        this.wallet = this._deriveAccount(indexToLoad).connect(this.provider);

        return {
          address: this.wallet.address.toLowerCase(),
          mnemonic: this.mnemonic,
          privateKey: this.wallet.privateKey
        };
      }

      return null;
    } catch (error) {
      if (error.message && error.message.includes('Unsupported state or unable to authenticate data')) {
        throw new Error('Incorrect password');
      }
      throw error;
    }
  }

  getWalletAccounts(walletName) {
    try {
      const wallets = safeReadJSON('wallets.json');
      if (wallets[walletName] && wallets[walletName].accounts) {
        return wallets[walletName].accounts;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  getAllWallets() {
    try {
      const wallets = safeReadJSON('wallets.json');
      return wallets;
    } catch (error) {
      return {};
    }
  }

  deleteWallet(walletName) {
    try {
      const wallets = safeReadJSON('wallets.json');
      delete wallets[walletName];
      safeWriteJSON('wallets.json', wallets);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Export wallet to encrypted backup file
   * @param {string} walletName - Name of wallet to export
   * @param {string} exportPath - Path to export file
   * @returns {boolean} - Success status
   */
  exportWallet(walletName, exportPath) {
    try {
      const wallets = safeReadJSON('wallets.json');

      if (!wallets[walletName]) {
        throw new Error('Wallet not found');
      }

      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        wallet: {
          name: walletName,
          ...wallets[walletName]
        }
      };

      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
      return true;
    } catch (error) {
      throw new Error(`Export failed: ${error.message}`);
    }
  }

  /**
   * Import wallet from encrypted backup file
   * @param {string} importPath - Path to import file
   * @param {string} password - Password to verify wallet
   * @returns {string} - Imported wallet name
   */
  importFromBackup(importPath, password) {
    try {
      const backupData = JSON.parse(fs.readFileSync(importPath, 'utf8'));

      if (!backupData.wallet || !backupData.wallet.encryptedMnemonic) {
        throw new Error('Invalid backup file format');
      }

      // Verify password can decrypt the wallet
      try {
        decryptMnemonic(
          backupData.wallet.encryptedMnemonic,
          password,
          backupData.wallet.salt
        );
      } catch {
        throw new Error('Incorrect password for backup file');
      }

      const wallets = safeReadJSON('wallets.json');
      let walletName = backupData.wallet.name;

      // Handle name conflicts
      let counter = 1;
      const originalName = walletName;
      while (wallets[walletName]) {
        walletName = `${originalName}_${counter}`;
        counter++;
      }

      // Import wallet
      wallets[walletName] = {
        encryptedMnemonic: backupData.wallet.encryptedMnemonic,
        salt: backupData.wallet.salt,
        createdAt: backupData.wallet.createdAt,
        accounts: backupData.wallet.accounts || {},
        currentAccountIndex: backupData.wallet.currentAccountIndex || 0
      };

      safeWriteJSON('wallets.json', wallets);

      return walletName;
    } catch (error) {
      throw new Error(`Import failed: ${error.message}`);
    }
  }

  getPrivateKey(password) {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.encryptedMnemonic || !this.salt) {
      throw new Error('No encrypted wallet loaded');
    }

    // Verify password by attempting to decrypt
    decryptMnemonic(this.encryptedMnemonic, password, this.salt);

    // Return the private key from the already-derived wallet
    return this.wallet.privateKey;
  }

  getMnemonic(password) {
    if (!this.encryptedMnemonic || !this.salt) {
      throw new Error('No encrypted wallet loaded');
    }

    // Decrypt and return mnemonic
    return decryptMnemonic(this.encryptedMnemonic, password, this.salt);
  }
}
