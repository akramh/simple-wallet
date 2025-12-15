/**
 * @fileoverview XRP Ledger module barrel export.
 *
 * Re-exports all XRP-related functionality for easy importing.
 *
 * @module xrp
 *
 * @example
 * ```typescript
 * import {
 *   deriveXRPAddress,
 *   isValidXRPAddress,
 *   dropsToXrp,
 *   xrpToDrops,
 *   DROPS_PER_XRP,
 * } from './xrp/index.js';
 * ```
 */

// Types
export type {
  XRPAddressInfo,
  XRPBalance,
  XRPTransaction,
  NormalizedXRPTransaction,
  XRPFeeEstimate,
  XRPNetworkConfig,
} from './types.js';

// Constants and unit conversion utilities
export {
  DROPS_PER_XRP,
  XRP_RESERVE_BASE,
  XRP_RESERVE_INCREMENT,
  BASE_FEE_DROPS,
  dropsToXrp,
  xrpToDrops,
  parseXrpToDropsExact,
  formatXrpAmount,
  calculateReserve,
  isValidDestinationTag,
} from './types.js';

// Address derivation
export {
  getXRPDerivationPath,
  deriveXRPAddress,
  deriveXRPAddresses,
  getXRPPrivateKey,
  getXRPWallet,
  isValidXRPAddress,
  isXAddress,
} from './address.js';

// Explorer (XRP Ledger API client)
export {
  XRPExplorer,
  getXRPExplorer,
  clearXRPExplorerCache,
  isXRPNetwork,
} from './explorer.js';

// Provider (unified interface)
export type {
  XRPPortfolioResult,
  XRPProviderConfig,
} from './provider.js';

export {
  XRPProvider,
  getXRPProvider,
  clearXRPProviderCache,
} from './provider.js';

// Transaction building and signing
export type {
  XRPPaymentParams,
  UnsignedXRPPayment,
  SignedXRPTransaction,
  XRPTransactionResult,
} from './transaction.js';

export {
  buildPaymentTransaction,
  signPaymentTransaction,
  buildAndSignPayment,
  validateSufficientBalance,
  calculateMaxSendable,
  estimateTransferCost,
  parseAmountToDrops,
  validateRecipientActivation,
} from './transaction.js';
