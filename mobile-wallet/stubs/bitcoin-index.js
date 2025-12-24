/**
 * @file bitcoin-index.js
 * @description Pure JS Bitcoin address derivation for React Native
 * 
 * Implements BIP-84 Native SegWit (P2WPKH) address derivation using
 * our pure JS bip32 and secp256k1 implementations.
 */

const BIP32Factory = require('./bip32');
const { sha256 } = require('@noble/hashes/sha256');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const { Buffer } = require('buffer');

// Initialize BIP32
const bip32 = BIP32Factory();

// Network configurations
const BITCOIN_NETWORKS = {
  mainnet: {
    bech32: 'bc',
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
  },
  testnet: {
    bech32: 'tb',
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
  },
};

// BIP-84 coin types
const COIN_TYPES = {
  mainnet: 0,
  testnet: 1,
};

const SATOSHIS_PER_BTC = 100000000n;

/**
 * Bech32 encoding for SegWit addresses
 */
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (let i = 0; i < values.length; ++i) {
    const v = values[i];
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let j = 0; j < 5; ++j) {
      if ((top >> j) & 1) {
        chk ^= GENERATOR[j];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const result = [];
  for (let i = 0; i < hrp.length; ++i) {
    result.push(hrp.charCodeAt(i) >> 5);
  }
  result.push(0);
  for (let i = 0; i < hrp.length; ++i) {
    result.push(hrp.charCodeAt(i) & 31);
  }
  return result;
}

function bech32CreateChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const result = [];
  for (let i = 0; i < 6; ++i) {
    result.push((polymod >> (5 * (5 - i))) & 31);
  }
  return result;
}

function bech32Encode(hrp, data) {
  const combined = data.concat(bech32CreateChecksum(hrp, data));
  let result = hrp + '1';
  for (let i = 0; i < combined.length; ++i) {
    result += BECH32_CHARSET.charAt(combined[i]);
  }
  return result;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  
  for (let i = 0; i < data.length; ++i) {
    const value = data[i];
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error('Invalid value');
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  
  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error('Invalid data');
  }
  
  return result;
}

/**
 * Hash160 (SHA256 + RIPEMD160)
 */
function hash160(buffer) {
  return Buffer.from(ripemd160(sha256(buffer)));
}

/**
 * Create P2WPKH (Native SegWit) address from public key
 */
function createP2WPKHAddress(publicKey, network) {
  const pubkeyHash = hash160(publicKey);
  const words = [0].concat(convertBits(Array.from(pubkeyHash), 8, 5, true));
  return bech32Encode(network.bech32, words);
}

/**
 * Derive Bitcoin address from mnemonic (BIP-84)
 */
function deriveBitcoinAddress(mnemonic, network = 'mainnet', accountIndex = 0, addressIndex = 0) {
  // Import crypto-utils for mnemonic validation and seed generation
  const { validateMnemonic, mnemonicToSeed } = require('@wallet/crypto-utils');
  
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  const seed = mnemonicToSeed(mnemonic);
  const btcNetwork = BITCOIN_NETWORKS[network];
  const coinType = COIN_TYPES[network];
  
  // BIP-84 path: m/84'/coin'/account'/0/index
  const path = "m/84'/" + coinType + "'/" + accountIndex + "'/0/" + addressIndex;
  
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(path);
  
  if (!child.publicKey) {
    throw new Error('Failed to derive public key');
  }
  
  const address = createP2WPKHAddress(child.publicKey, btcNetwork);
  
  return {
    address,
    publicKey: Buffer.from(child.publicKey).toString('hex'),
    derivationPath: path,
    network,
  };
}

/**
 * Derive multiple Bitcoin addresses
 */
function deriveBitcoinAddresses(mnemonic, network = 'mainnet', accountIndex = 0, startIndex = 0, count = 10) {
  const addresses = [];
  for (let i = 0; i < count; i++) {
    addresses.push(deriveBitcoinAddress(mnemonic, network, accountIndex, startIndex + i));
  }
  return addresses;
}

/**
 * Get private key for Bitcoin address
 */
function getBitcoinPrivateKey(mnemonic, network = 'mainnet', accountIndex = 0, addressIndex = 0) {
  const { validateMnemonic, mnemonicToSeed } = require('@wallet/crypto-utils');
  
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }
  
  const seed = mnemonicToSeed(mnemonic);
  const coinType = COIN_TYPES[network];
  const path = "m/84'/" + coinType + "'/" + accountIndex + "'/0/" + addressIndex;
  
  const root = bip32.fromSeed(seed);
  const child = root.derivePath(path);
  
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }
  
  return Buffer.from(child.privateKey).toString('hex');
}

/**
 * Validate Bitcoin address
 */
function isValidBitcoinAddress(address, network = 'mainnet') {
  if (!address || typeof address !== 'string') return false;
  
  const btcNetwork = BITCOIN_NETWORKS[network];
  
  // Check bech32 (native segwit) addresses
  if (address.toLowerCase().startsWith(btcNetwork.bech32 + '1')) {
    // Basic length check for P2WPKH (42 chars) or P2WSH (62 chars)
    return address.length === 42 || address.length === 62;
  }
  
  // Legacy and P2SH addresses start with specific characters
  if (network === 'mainnet') {
    return address.startsWith('1') || address.startsWith('3');
  } else {
    return address.startsWith('m') || address.startsWith('n') || address.startsWith('2');
  }
}

// Utility functions
const satoshisToBtc = (satoshis) => {
  // Return string to match real implementation
  return (Number(satoshis) / Number(SATOSHIS_PER_BTC)).toFixed(8);
};

const btcToSatoshis = (btc) => {
  return BigInt(Math.round(btc * Number(SATOSHIS_PER_BTC)));
};

const formatBtcAmount = (satoshis, decimals = 8) => {
  return satoshisToBtc(satoshis).toFixed(decimals);
};

/**
 * Mempool.space API base URLs for different networks.
 */
const MEMPOOL_API_URLS = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
  signet: 'https://mempool.space/signet/api',
};

/**
 * Request timeout in milliseconds.
 */
const REQUEST_TIMEOUT = 15000;

/**
 * Cache TTL in milliseconds (30 seconds).
 */
const CACHE_TTL = 30000;

/**
 * Simple in-memory cache for API responses.
 */
const cache = new Map();

/**
 * Get cached data if still valid.
 */
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store data in cache.
 */
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Fetch with timeout helper.
 */
async function fetchWithTimeout(url, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Bitcoin explorer using Mempool.space API.
 * Provides real balance and transaction data for Bitcoin addresses.
 */
class BitcoinExplorer {
  constructor(network = 'mainnet', customApiUrl) {
    this.network = network;
    this.apiUrl = customApiUrl || MEMPOOL_API_URLS[network] || MEMPOOL_API_URLS.mainnet;
  }

  getNetwork() {
    return this.network;
  }

  /**
   * Get the balance for a Bitcoin address.
   *
   * @param {string} address - Bitcoin address (bc1q... or tb1q...)
   * @returns {Promise<{confirmed: number, unconfirmed: number, total: number}>}
   */
  async getBalance(address) {
    const cacheKey = `balance:${this.network}:${address}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      const confirmed =
        data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      const unconfirmed =
        data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;

      const balance = {
        confirmed,
        unconfirmed,
        total: confirmed + unconfirmed,
      };

      setCache(cacheKey, balance);
      return balance;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch balance:', error);
      return { confirmed: 0, unconfirmed: 0, total: 0 };
    }
  }

  /**
   * Get the formatted balance in BTC.
   *
   * @param {string} address - Bitcoin address
   * @returns {Promise<string>} Balance in BTC as string
   */
  async getBalanceFormatted(address) {
    const balance = await this.getBalance(address);
    return satoshisToBtc(balance.total).toString();
  }

  /**
   * Get unspent transaction outputs (UTXOs) for an address.
   *
   * @param {string} address - Bitcoin address
   * @returns {Promise<Array>} Array of UTXOs
   */
  async getUTXOs(address) {
    const cacheKey = `utxos:${this.network}:${address}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}/utxo`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const utxos = await response.json();
      setCache(cacheKey, utxos);
      return utxos;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch UTXOs:', error);
      return [];
    }
  }

  /**
   * Get transaction history for an address.
   *
   * @param {string} address - Bitcoin address
   * @returns {Promise<Array>} Array of transactions
   */
  async getTransactions(address) {
    const cacheKey = `txs:${this.network}:${address}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}/txs`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const txs = await response.json();
      setCache(cacheKey, txs);
      return txs;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch transactions:', error);
      return [];
    }
  }

  /**
   * Get normalized transaction history matching the app's transaction format.
   *
   * @param {string} address - Bitcoin address
   * @param {number} limit - Maximum number of transactions
   * @returns {Promise<Array>} Normalized transactions
   */
  async getNormalizedTransactions(address, limit = 25) {
    const txs = await this.getTransactions(address);
    const lowerAddress = address.toLowerCase();

    return txs.slice(0, limit).map((tx) => {
      let inputsFromMe = 0;
      let outputsToMe = 0;
      let outputsToOthers = 0;

      for (const input of tx.vin) {
        if (input.prevout?.scriptpubkey_address?.toLowerCase() === lowerAddress) {
          inputsFromMe += input.prevout.value;
        }
      }

      for (const output of tx.vout) {
        const outAddr = output.scriptpubkey_address?.toLowerCase();
        if (outAddr === lowerAddress) {
          outputsToMe += output.value;
        } else {
          outputsToOthers += output.value;
        }
      }

      const type = inputsFromMe > 0 ? 'send' : 'receive';
      const displayValue = type === 'send' ? outputsToOthers : outputsToMe;

      // Get the counterparty address
      let counterparty = '';
      if (type === 'send') {
        const recipient = tx.vout.find(
          (o) => o.scriptpubkey_address?.toLowerCase() !== lowerAddress
        );
        counterparty = recipient?.scriptpubkey_address || '';
      } else {
        const sender = tx.vin.find(
          (input) => input.prevout?.scriptpubkey_address?.toLowerCase() !== lowerAddress
        )?.prevout?.scriptpubkey_address;
        counterparty = sender || '';
      }

      const blockHeight = tx.status.block_height || 0;

      return {
        hash: tx.txid,
        from: type === 'send' ? address : counterparty,
        to: type === 'send' ? counterparty : address,
        value: displayValue.toString(),
        timestamp: tx.status.block_time
          ? tx.status.block_time * 1000
          : Date.now(),
        blockNumber: blockHeight,
        fee: tx.fee.toString(),
        status: tx.status.confirmed ? 'confirmed' : 'pending',
        type,
        network: this.network === 'mainnet' ? 'bitcoin-mainnet' : 'bitcoin-testnet',
      };
    });
  }

  /**
   * Get recommended fee rates.
   *
   * @returns {Promise<{fastestFee: number, halfHourFee: number, hourFee: number, economyFee: number, minimumFee: number}>}
   */
  async getFeeEstimates() {
    const cacheKey = `fees:${this.network}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/v1/fees/recommended`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const fees = await response.json();
      setCache(cacheKey, fees);
      return fees;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch fee estimates:', error);
      return {
        fastestFee: 10,
        halfHourFee: 5,
        hourFee: 3,
        economyFee: 1,
        minimumFee: 1,
      };
    }
  }

  /**
   * Generate a block explorer URL for a transaction.
   *
   * @param {string} txid - Transaction ID
   * @returns {string} URL to view the transaction
   */
  getTransactionUrl(txid) {
    const baseUrl = this.network === 'mainnet'
      ? 'https://mempool.space'
      : `https://mempool.space/${this.network}`;
    return `${baseUrl}/tx/${txid}`;
  }

  /**
   * Generate a block explorer URL for an address.
   *
   * @param {string} address - Bitcoin address
   * @returns {string} URL to view the address
   */
  getAddressUrl(address) {
    const baseUrl = this.network === 'mainnet'
      ? 'https://mempool.space'
      : `https://mempool.space/${this.network}`;
    return `${baseUrl}/address/${address}`;
  }

  /**
   * Clear the cache for this network.
   */
  clearCache() {
    for (const key of cache.keys()) {
      if (key.includes(this.network)) {
        cache.delete(key);
      }
    }
  }

  /**
   * Get a specific transaction by txid.
   *
   * @param {string} txid - Transaction ID
   * @returns {Promise<Object|null>} Transaction data or null if not found
   */
  async getTransaction(txid) {
    const cacheKey = `tx:${this.network}:${txid}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/tx/${txid}`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`API error: ${response.status}`);
      }

      const tx = await response.json();
      setCache(cacheKey, tx);
      return tx;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch transaction:', error);
      return null;
    }
  }

  /**
   * Broadcast a signed transaction to the network.
   *
   * @param {string} txHex - Signed transaction in hex format
   * @returns {Promise<string>} Transaction ID if successful
   */
  async broadcastTransaction(txHex) {
    try {
      const url = `${this.apiUrl}/tx`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: txHex,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Broadcast failed: ${errorText}`);
      }

      const txid = await response.text();
      return txid.trim();
    } catch (error) {
      console.error('[BitcoinExplorer] Failed to broadcast transaction:', error);
      throw error;
    }
  }
}

// Provider class matching the real BitcoinProvider interface
class BitcoinProvider {
  constructor(config = {}) {
    this.config = {
      network: config.network || 'mainnet',
      networkKey: config.networkKey || 'bitcoin-mainnet',
      ...config,
    };
    this.currentAddress = null;
    this.accountIndex = 0;
    // Initialize explorer with the correct network
    this.explorer = new BitcoinExplorer(this.config.network);
  }

  getNetwork() {
    return this.config.network;
  }

  getNetworkKey() {
    return this.config.networkKey;
  }

  deriveAddress(mnemonic, accountIndex = 0, addressIndex = 0) {
    this.accountIndex = accountIndex;
    this.currentAddress = deriveBitcoinAddress(mnemonic, this.config.network, accountIndex, addressIndex);
    return this.currentAddress;
  }

  getCurrentAddress() {
    return this.currentAddress?.address || null;
  }

  getCurrentAccountIndex() {
    return this.accountIndex;
  }

  async getBalance(address) {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getBalance(addr);
  }

  async getBalanceFormatted(address) {
    const balance = await this.getBalance(address);
    return satoshisToBtc(balance.total);
  }

  getNativeToken() {
    return {
      symbol: this.config.network === 'mainnet' ? 'BTC' : 'tBTC',
      name: this.config.network === 'mainnet' ? 'Bitcoin' : 'Bitcoin Testnet',
      decimals: 8,
      address: '',
      type: 'native',
    };
  }

  async getPortfolio(address) {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [{
        token: this.getNativeToken(),
        balance: '0',
        balanceSatoshis: 0,
        error: 'No address available',
      }];
    }

    try {
      const balance = await this.getBalance(addr);
      return [{
        token: this.getNativeToken(),
        balance: satoshisToBtc(balance.total),
        balanceSatoshis: balance.total,
      }];
    } catch (error) {
      return [{
        token: this.getNativeToken(),
        balance: '0',
        balanceSatoshis: 0,
        error: error.message,
      }];
    }
  }

  async getUTXOs(address) {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getUTXOs(addr);
  }

  async getTransactionHistory(address, limit = 25) {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [];
    }
    return this.explorer.getNormalizedTransactions(addr, limit);
  }

  getTransactionUrl(txid) {
    return this.explorer.getTransactionUrl(txid);
  }

  getAddressUrl(address) {
    const addr = address || this.currentAddress?.address;
    return this.explorer.getAddressUrl(addr);
  }

  /**
   * Get recommended fee rates.
   * Delegates to explorer.
   *
   * @returns {Promise<{fastestFee: number, halfHourFee: number, hourFee: number, economyFee: number, minimumFee: number}>}
   */
  async getFeeEstimates() {
    return this.explorer.getFeeEstimates();
  }

  /**
   * Estimate inputs and fee for sending BTC.
   * Stub implementation that returns a basic estimate.
   *
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {string} amountBtc - Amount in BTC
   * @param {number} feeRateSatVb - Fee rate in sat/vB
   */
  async estimateSendTransaction(fromAddress, toAddress, amountBtc, feeRateSatVb) {
    // Get UTXOs
    const utxos = await this.getUTXOs(fromAddress);
    const confirmedUtxos = utxos.filter(u => u.status && u.status.confirmed);
    
    // Parse amount to satoshis
    const amountSats = Math.round(parseFloat(amountBtc) * 100000000);
    
    // Estimate vbytes (1 input ~68 vB, 2 outputs ~31 vB each, overhead ~10 vB)
    // Simple estimate: 1-2 inputs, 2 outputs (recipient + change)
    const estimatedVbytes = 140; // Typical P2WPKH tx size
    const feeSats = Math.ceil(estimatedVbytes * feeRateSatVb);
    
    // Find enough UTXOs
    let totalInputSats = 0;
    const selectedUtxos = [];
    for (const utxo of confirmedUtxos.sort((a, b) => b.value - a.value)) {
      selectedUtxos.push(utxo);
      totalInputSats += utxo.value;
      if (totalInputSats >= amountSats + feeSats) break;
    }
    
    if (totalInputSats < amountSats + feeSats) {
      throw new Error('Insufficient balance for transaction + fees');
    }
    
    const changeSats = totalInputSats - amountSats - feeSats;
    
    return {
      amountSats,
      inputs: selectedUtxos,
      totalInputSats,
      changeSats,
      fee: {
        feeRateSatVb,
        vbytes: estimatedVbytes,
        feeSats,
        inputCount: selectedUtxos.length,
        outputCount: changeSats > 546 ? 2 : 1, // Dust threshold
        hasChange: changeSats > 546,
      },
    };
  }

  /**
   * Build, sign, and broadcast a Bitcoin transaction.
   * 
   * NOTE: Full transaction signing is not yet implemented in the mobile stub.
   * This requires implementing P2WPKH transaction building with secp256k1 signing.
   *
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {string} amountBtc - Amount in BTC string
   * @param {string} wif - Private key in WIF format
   * @param {number} [feeRateSatVb] - Optional fee rate in sat/vB
   * @returns {Promise<{txid: string, feeSats: number, feeBtc: string, vbytes: number}>}
   */
  async sendTransaction(fromAddress, toAddress, amountBtc, wif, feeRateSatVb) {
    // TODO: Implement full P2WPKH transaction signing
    // This requires:
    // 1. Fetching prevouts for each input
    // 2. Building the transaction with proper witness data
    // 3. Signing with secp256k1
    // 4. Broadcasting the signed transaction
    throw new Error('Bitcoin transaction signing is not yet implemented on mobile. Please use the CLI or browser extension to send BTC.');
  }
}

function getBitcoinExplorer(network = 'mainnet') {
  // Handle network key format (e.g., 'bitcoin-mainnet' -> 'mainnet')
  const normalizedNetwork = network.includes('testnet') ? 'testnet' : 'mainnet';
  return new BitcoinExplorer(normalizedNetwork);
}

// Provider cache to match real implementation
const providerCache = new Map();

function getBitcoinProvider(networkKey) {
  // Accept either a networkKey string or config object for compatibility
  if (typeof networkKey === 'object') {
    const config = networkKey;
    return new BitcoinProvider(config);
  }
  
  // Match the real implementation signature: getBitcoinProvider(networkKey: string)
  let provider = providerCache.get(networkKey);
  if (!provider) {
    const network = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    provider = new BitcoinProvider({ network, networkKey });
    providerCache.set(networkKey, provider);
  }
  return provider;
}

/**
 * Check if a network key is a Bitcoin network.
 */
function isBitcoinNetwork(networkKey) {
  return networkKey === 'bitcoin-mainnet' || networkKey === 'bitcoin-testnet';
}

// Types
const BitcoinNetwork = { mainnet: 'mainnet', testnet: 'testnet' };

module.exports = {
  deriveBitcoinAddress,
  deriveBitcoinAddresses,
  getBitcoinPrivateKey,
  isValidBitcoinAddress,
  satoshisToBtc,
  btcToSatoshis,
  formatBtcAmount,
  getBitcoinExplorer,
  getBitcoinProvider,
  BitcoinProvider,
  BitcoinExplorer,
  isBitcoinNetwork,
  BitcoinNetwork,
  SATOSHIS_PER_BTC,
};
