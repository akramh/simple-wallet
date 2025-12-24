/**
 * @fileoverview Price provider registration and exports.
 *
 * Configures the provider priority order and exports the singleton manager.
 * All price-related functionality should use this module.
 *
 * Provider Priority:
 * 1. CoinGecko (primary) - has API key, supports contract lookups
 * 2. CoinPaprika (fallback) - generous free tier, no API key required
 *
 * @example
 * ```typescript
 * import { priceProviderManager, setCoingeckoApiKey } from './price-providers/index.js';
 *
 * // Configure API key (for React Native)
 * setCoingeckoApiKey('your-api-key');
 *
 * // Get current price (tries CoinGecko first)
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
 * - CoinGecko as primary provider (priority 1) - has API key, supports contract lookups
 * - CoinPaprika as fallback provider (priority 2) - no API key required
 *
 * Use this instance throughout the application.
 */
export const priceProviderManager = new PriceProviderManager();

// Register providers (automatically sorted by priority)
priceProviderManager.registerProvider(new CoinGeckoProvider());   // Priority 1 (primary)
priceProviderManager.registerProvider(new CoinPaprikaProvider()); // Priority 2 (fallback)

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
export { CoinGeckoProvider, SYMBOL_TO_COINGECKO_ID, CHAIN_TO_PLATFORM, setCoingeckoApiKey } from './coingecko.js';

