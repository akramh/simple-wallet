/**
 * @fileoverview Price provider registration and exports.
 *
 * Configures the provider priority order and exports the singleton manager.
 * All price-related functionality should use this module.
 *
 * Provider Priority:
 * 0. Alchemy (primary, current prices only) - `/prices/v1/...` by-symbol + by-address.
 *    Throws fast for history/metadata so manager falls through.
 * 1. CoinGecko (primary for history + metadata; fallback for current prices) -
 *    has API key, supports contract lookups, only source of description / ATH /
 *    circulating supply fields the mobile token-detail screen renders.
 * 2. CoinPaprika (third-tier fallback) - generous free tier, no API key required.
 *
 * @example
 * ```typescript
 * import { priceProviderManager, setAlchemyApiKey, setCoingeckoApiKey } from './price-providers/index.js';
 *
 * // Configure API keys (for React Native / Chrome extension)
 * setAlchemyApiKey('your-alchemy-key');
 * setCoingeckoApiKey('your-coingecko-key');
 *
 * // Get current price (tries Alchemy first, falls back to CoinGecko)
 * const price = await priceProviderManager.getCurrentPrice('ETH');
 *
 * // Get price history (CoinGecko — Alchemy throws fast; see alchemy.ts comment)
 * const history = await priceProviderManager.getPriceHistory('BTC', '1D');
 * ```
 */

import { AlchemyPriceProvider } from './alchemy.js';
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
priceProviderManager.registerProvider(new AlchemyPriceProvider()); // Priority 0 (primary for current prices)
priceProviderManager.registerProvider(new CoinGeckoProvider());    // Priority 1 (history + metadata; fallback for current prices)
priceProviderManager.registerProvider(new CoinPaprikaProvider());  // Priority 2 (third-tier fallback)

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
export { AlchemyPriceProvider, setAlchemyApiKey } from './alchemy.js';

