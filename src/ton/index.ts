/**
 * @fileoverview TON module barrel export.
 *
 * Re-exports all TON-related functionality for easy importing.
 *
 * @module ton
 */

export type {
  TonAddressInfo,
  TonBalance,
  NormalizedTonTransaction,
  TonFeeEstimate,
} from './types.js';

export {
  TON_COIN_TYPE,
  NANO_TON,
  tonToNano,
  nanoToTon,
} from './types.js';

export {
  getTonDerivationPath,
  deriveTonKeypair,
  deriveTonAddress,
  isValidTonAddress,
  parseTonAddress,
  formatTonAddress,
  normalizeTonAddress,
} from './address.js';

export { buildTonTransferMessage, type TonTransferParams } from './transaction.js';

export {
  TonExplorer,
  getTonExplorer,
  clearTonExplorerCache,
  isTonNetwork,
} from './explorer.js';

export {
  TonProvider,
  getTonProvider,
  clearTonProviderCache,
  type TonProviderConfig,
  type TonPortfolioResult,
} from './provider.js';
