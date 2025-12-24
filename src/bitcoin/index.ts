/**
 * @fileoverview Bitcoin module barrel export.
 *
 * Re-exports all Bitcoin-related functionality for easy importing.
 *
 * @module bitcoin
 *
 * @example
 * ```typescript
 * import {
 *   BitcoinProvider,
 *   getBitcoinProvider,
 *   isBitcoinNetwork,
 *   deriveBitcoinAddress,
 *   satoshisToBtc,
 * } from './bitcoin/index.js';
 * ```
 */

// Types
export type {
  UTXO,
  BitcoinBalance,
  BitcoinAddressInfo,
  BitcoinTransaction,
  BitcoinTransactionInput,
  BitcoinTransactionOutput,
  NormalizedBitcoinTransaction,
  BitcoinFeeEstimate,
  BitcoinNetworkConfig,
} from './types.js';

// Type utilities
export {
  SATOSHIS_PER_BTC,
  satoshisToBtc,
  btcToSatoshis,
  formatBtcAmount,
} from './types.js';

// Address derivation
export {
  deriveBitcoinAddress,
  deriveBitcoinAddressFromPrivateKey,
  deriveBitcoinAddresses,
  getBitcoinPrivateKey,
  isValidBitcoinAddress,
  getNetworkFromAddress,
} from './address.js';

// Transaction building/signing (Phase 3)
export type { FeeEstimation, SelectedInputs, PrevoutInfo, BuildAndSignParams } from './transaction.js';
export {
  estimateVbytesP2wpkh,
  parseBtcToSatoshisExact,
  selectUtxosLargestFirst,
  buildAndSignP2wpkhTransaction,
} from './transaction.js';

// Explorer API
export {
  BitcoinExplorer,
  getBitcoinExplorer,
  bitcoinExplorerMainnet,
  bitcoinExplorerTestnet,
} from './explorer.js';

// Provider
export type { BitcoinPortfolioResult, BitcoinProviderConfig } from './provider.js';
export {
  BitcoinProvider,
  getBitcoinProvider,
  isBitcoinNetwork,
} from './provider.js';
