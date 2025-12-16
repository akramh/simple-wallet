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
  return Number(satoshis) / Number(SATOSHIS_PER_BTC);
};

const btcToSatoshis = (btc) => {
  return BigInt(Math.round(btc * Number(SATOSHIS_PER_BTC)));
};

const formatBtcAmount = (satoshis, decimals = 8) => {
  return satoshisToBtc(satoshis).toFixed(decimals);
};

// Explorer stub
class BitcoinExplorer {
  constructor() {}
  async getBalance() { return { total: 0, confirmed: 0, unconfirmed: 0 }; }
  async getBalanceFormatted() { return '0'; }
  async getTransactions() { return []; }
  async getUTXOs() { return []; }
  getTransactionUrl() { return ''; }
  getAddressUrl() { return ''; }
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
    this.explorer = new BitcoinExplorer();
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

  async getTransactionHistory(address, limit = 20) {
    return [];
  }

  getTransactionUrl(txid) {
    return this.explorer.getTransactionUrl(txid);
  }

  getAddressUrl(address) {
    const addr = address || this.currentAddress?.address;
    return this.explorer.getAddressUrl(addr);
  }
}

function getBitcoinExplorer(network = 'mainnet') {
  return new BitcoinExplorer();
}

function getBitcoinProvider(config = {}) {
  return new BitcoinProvider(config);
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
