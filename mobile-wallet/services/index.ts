/**
 * @fileoverview Mobile services barrel export.
 *
 * This module centralizes exports for the mobile “service layer”, mirroring the
 * structure used by the extension background service and the core SDK.
 *
 * @responsibilities
 * - Export the environment adapters (storage + crypto) used by the shared SDK
 * - Export the `walletBridge` singleton (mobile UI entry point to WalletAppService)
 * - Re-export shared types consumed by store/hooks/components
 */
export { mobileStorage, MobileStorageAdapter } from './MobileStorageAdapter';
export { mobileCrypto, MobileCryptoAdapter } from './MobileCryptoAdapter';
export { walletBridge } from './WalletBridge';
export type {
  WalletState,
  CreateWalletResult,
  ImportWalletResult,
  UnlockWalletResult,
  TokenBalance,
  Token,
  Transaction,
  GasEstimate,
  SendTransactionResult,
  NetworkConfig,
  Config,
} from './WalletBridge';

// Price history service for token detail charts
export {
  getPriceHistory,
  getTokenMetadata,
  getCoinGeckoId,
  clearPriceHistoryCache,
  formatLargeNumber,
  formatSupply,
} from './price-history';

// TON address validation
export { isValidTonAddress } from './ton-utils';
export {
  isValidEvmAddress,
  isValidBitcoinAddress,
  isValidSolanaAddress,
  isValidXRPAddress,
  isValidDestinationTag,
} from './address-utils';
export type {
  TimeRange,
  PricePoint,
  PriceHistoryData,
  TokenMetadata,
} from './price-history';
