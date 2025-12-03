import { ethers } from 'ethers';
import fs from 'fs';
import { encryptMnemonic, decryptMnemonic } from './crypto-utils.js';

export class Wallet {
  constructor(config) {
    this.config = config;
    this.wallet = null;
    this.provider = null;
    this.mnemonic = null;
    this.encryptedMnemonic = null;
    this.salt = null;
    this.currentAccountIndex = 0;
  }

  async initialize() {
    const networkConfig = this.config.networks[this.config.network];
    this.provider = new ethers.JsonRpcProvider(
      networkConfig.rpcUrl,
      networkConfig.chainId
    );

    // Test connection
    try {
      await Promise.race([
        this.provider.getBlockNumber(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);
    } catch (error) {
      console.log('\n⚠️  Warning: RPC connection slow or unavailable');
      console.log('Network operations may take longer than usual\n');
    }
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
    try {
      this.mnemonic = mnemonic;

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
      throw new Error('Invalid mnemonic phrase');
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
      const balance = await Promise.race([
        this.provider.getBalance(this.wallet.address),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout after 15 seconds')), 15000)
        )
      ]);
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
      const tx = await this.wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount)
      });

      console.log(`\nTransaction sent! Hash: ${tx.hash}`);
      console.log('Waiting for confirmation...');

      const receipt = await tx.wait();
      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  saveWallet(walletName) {
    if (!this.wallet) {
      throw new Error('No wallet loaded');
    }

    if (!this.encryptedMnemonic || !this.salt) {
      throw new Error('Wallet not properly encrypted');
    }

    let wallets = {};
    try {
      if (fs.existsSync('wallets.json')) {
        wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
      }
    } catch (error) {
      wallets = {};
    }

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

    fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));
    console.log(`\nWallet saved as "${walletName}"`);
    console.log('WARNING: Keep this file secure and back up your mnemonic phrase!');

    return walletName;
  }

  loadWallet(walletName, password, accountIndex = null) {
    try {
      const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));

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
      const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
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
      if (!fs.existsSync('wallets.json')) {
        return {};
      }
      return JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
    } catch (error) {
      return {};
    }
  }

  deleteWallet(walletName) {
    try {
      const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
      delete wallets[walletName];
      fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));
      return true;
    } catch (error) {
      return false;
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
