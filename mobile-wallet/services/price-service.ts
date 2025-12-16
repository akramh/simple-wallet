/**
 * @fileoverview Price service wrapper for mobile app.
 * 
 * Re-exports price service functions from the shared SDK
 * to work around Metro dynamic import issues with path aliases.
 */

export {
  getSolanaPrice,
  getBitcoinPrice,
  getXRPPrice,
  getNativeTokenPrice,
  isSolanaNetworkKey,
  isBitcoinNetworkKey,
  isXRPNetworkKey,
} from '@wallet/price-service.js';
