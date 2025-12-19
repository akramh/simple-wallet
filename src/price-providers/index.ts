/**
 * @fileoverview Price provider registration and exports.
 *
 * Configures the provider priority order and exports the singleton manager.
 * All price-related functionality should use this module.
 *
 * Provider Priority:
 * 1. CoinPaprika (primary) - better free tier rate limits
 * 2. CoinGecko (fallback) - widely supported, has contract lookups
 *
 * @example
 * ```typescript
 * import { priceProviderManager } from './price-providers/index.js';
 *
 * // Get current price (tries CoinPaprika first)
 * const price = await priceProviderManager.getCurrentPrice('ETH');
 *
 * // Get price history
 * const history = await priceProviderManager.getPriceHistory('BTC', '1D');
 * ```
 */

import { CoinPaprikaProvider } from './coinpaprika.js';
import { CoinGeckoProvider } from './coingecko.js';
import { PriceProviderManager } from './provider-manager.js';

// ============================================================================
// Singleton Manager Instance
// ============================================================================

/**
 * Singleton price provider manager.
 *
 * Pre-configured with:
 * - CoinPaprika as primary provider (priority 1)
 * - CoinGecko as fallback provider (priority 2)
 *
 * Use this instance throughout the application.
 */
export const priceProviderManager = new PriceProviderManager();

// Register providers in priority order
priceProviderManager.registerProvider(new CoinPaprikaProvider()); // Priority 1 (primary)
priceProviderManager.registerProvider(new CoinGeckoProvider()); // Priority 2 (fallback)

// ============================================================================
// Re-exports
// ============================================================================

// Types
export type {
  TimeRange,
  PricePoint,
  CurrentPriceResult,
  PriceHistoryResult,
  TokenMetadataResult,
  PriceProvider,
  CacheEntry,
} from './types.js';

// Classes (for custom provider registration or testing)
export { PriceProviderManager } from './provider-manager.js';
export { CoinPaprikaProvider } from './coinpaprika.js';
export { CoinGeckoProvider, SYMBOL_TO_COINGECKO_ID, CHAIN_TO_PLATFORM } from './coingecko.js';

