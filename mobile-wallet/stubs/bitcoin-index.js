/**
 * @file bitcoin-index.js
 * @description Stub for the entire Bitcoin module in React Native
 * 
 * The Bitcoin module requires WebAssembly-based tiny-secp256k1 which
 * doesn't work in React Native. This stub exports no-op implementations
 * that allow the app to compile and run for EVM chains.
 * 
 * Bitcoin functionality will require a native module like 
 * react-native-secp256k1 for production use.
 */

const SATOSHIS_PER_BTC = 100000000n;

const satoshisToBtc = (satoshis) => {
  return Number(satoshis) / Number(SATOSHIS_PER_BTC);
};

const btcToSatoshis = (btc) => {
  return BigInt(Math.round(btc * Number(SATOSHIS_PER_BTC)));
};

const formatBtcAmount = (satoshis, decimals = 8) => {
  return satoshisToBtc(satoshis).toFixed(decimals);
};

const deriveBitcoinAddress = async (mnemonic, network, accountIndex = 0) => {
  console.warn('[Bitcoin] deriveBitcoinAddress is not available in React Native');
  return {
    address: 'btc_stub_address_not_implemented',
    publicKey: 'stub_pubkey',
    path: `m/84'/0'/${accountIndex}'/0/0`,
    network: network || 'bitcoin',
  };
};

const deriveBitcoinAddresses = async (mnemonic, network, count = 1, accountIndex = 0) => {
  console.warn('[Bitcoin] deriveBitcoinAddresses is not available in React Native');
  return [await deriveBitcoinAddress(mnemonic, network, accountIndex)];
};

const getBitcoinPrivateKey = async (mnemonic, network, accountIndex = 0) => {
  console.warn('[Bitcoin] getBitcoinPrivateKey is not available in React Native');
  return 'btc_private_key_stub_not_implemented';
};

const isValidBitcoinAddress = (address, network) => {
  console.warn('[Bitcoin] isValidBitcoinAddress is stubbed in React Native');
  if (!address) return false;
  // Basic format check only
  return address.startsWith('bc1') || address.startsWith('tb1') || 
         address.startsWith('1') || address.startsWith('3') ||
         address.startsWith('m') || address.startsWith('n') || address.startsWith('2');
};

const getNetworkFromAddress = (address) => {
  if (!address) return null;
  if (address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')) {
    return 'bitcoin';
  }
  if (address.startsWith('tb1') || address.startsWith('m') || address.startsWith('n') || address.startsWith('2')) {
    return 'bitcoin-testnet';
  }
  return null;
};

// Transaction stubs
const estimateVbytesP2wpkh = (inputCount, outputCount) => {
  return 10.5 + 68 * inputCount + 31 * outputCount;
};

const parseBtcToSatoshisExact = (btcString) => {
  return btcToSatoshis(parseFloat(btcString));
};

const selectUtxosLargestFirst = (utxos, targetSatoshis, feeRateSatPerVbyte) => {
  console.warn('[Bitcoin] selectUtxosLargestFirst is stubbed in React Native');
  return null;
};

const buildAndSignP2wpkhTransaction = async (params) => {
  console.warn('[Bitcoin] buildAndSignP2wpkhTransaction is not available in React Native');
  throw new Error('Bitcoin transactions are not supported in React Native. Native crypto module required.');
};

// Explorer stubs
const fetchBitcoinBalance = async (address, network) => {
  console.warn('[Bitcoin] fetchBitcoinBalance is stubbed in React Native');
  return { confirmed: 0n, unconfirmed: 0n, total: 0n };
};

const fetchBitcoinUtxos = async (address, network) => {
  console.warn('[Bitcoin] fetchBitcoinUtxos is stubbed in React Native');
  return [];
};

const fetchBitcoinTransactions = async (address, network) => {
  console.warn('[Bitcoin] fetchBitcoinTransactions is stubbed in React Native');
  return [];
};

const broadcastBitcoinTransaction = async (txHex, network) => {
  console.warn('[Bitcoin] broadcastBitcoinTransaction is not available in React Native');
  throw new Error('Bitcoin transactions are not supported in React Native.');
};

// Provider stub
class BitcoinProvider {
  constructor(config, network) {
    this.config = config;
    this.network = network;
    console.warn('[Bitcoin] BitcoinProvider is stubbed in React Native');
  }

  async getBalance(address) {
    return fetchBitcoinBalance(address, this.network);
  }

  async getUtxos(address) {
    return fetchBitcoinUtxos(address, this.network);
  }

  async getTransactions(address) {
    return fetchBitcoinTransactions(address, this.network);
  }

  async broadcastTransaction(txHex) {
    return broadcastBitcoinTransaction(txHex, this.network);
  }
}

const getBitcoinProvider = (config, network) => {
  return new BitcoinProvider(config, network);
};

const isBitcoinNetwork = (networkId) => {
  return networkId === 'bitcoin' || networkId === 'bitcoin-testnet';
};

module.exports = {
  // Types/constants
  SATOSHIS_PER_BTC,
  satoshisToBtc,
  btcToSatoshis,
  formatBtcAmount,
  
  // Address derivation
  deriveBitcoinAddress,
  deriveBitcoinAddresses,
  getBitcoinPrivateKey,
  isValidBitcoinAddress,
  getNetworkFromAddress,
  
  // Transaction
  estimateVbytesP2wpkh,
  parseBtcToSatoshisExact,
  selectUtxosLargestFirst,
  buildAndSignP2wpkhTransaction,
  
  // Explorer
  fetchBitcoinBalance,
  fetchBitcoinUtxos,
  fetchBitcoinTransactions,
  broadcastBitcoinTransaction,
  
  // Provider
  BitcoinProvider,
  getBitcoinProvider,
  isBitcoinNetwork,
};
