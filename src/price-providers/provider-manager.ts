/**
 * @fileoverview Price provider manager with fallback logic.
 *
 * Manages multiple price providers with priority-based fallback.
 * Caches results to reduce API calls and improve performance.
 *
 * @responsibilities
 * - Register and prioritize price providers
 * - Try providers in priority order, fall back on failure
 * - Cache results with configurable TTLs
 * - Log provider usage for debugging
 *
 * @security
 * - No sensitive data handled
 * - Read-only operations
 */

import type {
  PriceProvider,
  CurrentPriceResult,
  PriceHistoryResult,
  TokenMetadataResult,
  TimeRange,
  CacheEntry,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Cache TTL for current prices: 1 minute */
const CURRENT_PRICE_TTL = 60 * 1000;

/** Cache TTL for price history: 5 minutes */
const HISTORY_TTL = 5 * 60 * 1000;

/** Cache TTL for token metadata: 1 hour */
const METADATA_TTL = 60 * 60 * 1000;

// ============================================================================
// Provider Manager
// ============================================================================

/**
 * Manages price providers with fallback logic and caching.
 *
 * Providers are tried in priority order (lower priority number = tried first).
 * If a provider fails, the next one is tried. Results are cached to reduce
 * API calls.
 *
 * @example
 * ```typescript
 * const manager = new PriceProviderManager();
 *
 * // Register providers (sorted by priority automatically)
 * manager.registerProvider(new CoinPaprikaProvider()); // priority 1
 * manager.registerProvider(new CoinGeckoProvider());   // priority 2
 *
 * // Get price - tries CoinPaprika first, falls back to CoinGecko
 * const price = await manager.getCurrentPrice('ETH');
 * ```
 */
export class PriceProviderManager {
  private providers: PriceProvider[] = [];
  private currentPriceCache = new Map<string, CacheEntry<CurrentPriceResult>>();
  private historyCache = new Map<string, CacheEntry<PriceHistoryResult>>();
  private metadataCache = new Map<string, CacheEntry<TokenMetadataResult>>();

  /**
   * Register a provider.
   * Providers are automatically sorted by priority (lower = higher priority).
   *
   * @param provider - Provider to register
   */
  registerProvider(provider: PriceProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get all registered providers (for testing/debugging).
   */
  getProviders(): readonly PriceProvider[] {
    return this.providers;
  }

  /**
   * Check if a cache entry is expired.
   */
  private isExpired<T>(entry: CacheEntry<T>, ttl: number): boolean {
    return Date.now() - entry.fetchedAt > ttl;
  }

  /**
   * Get current price for a token by symbol.
   * Tries providers in priority order.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @returns Price data or null if all providers fail
   */
  async getCurrentPrice(symbol: string): Promise<CurrentPriceResult | null> {
    const cacheKey = symbol.toUpperCase();

    // Check cache
    const cached = this.currentPriceCache.get(cacheKey);
    if (cached && !this.isExpired(cached, CURRENT_PRICE_TTL)) {
      return cached.data;
    }

    // Try providers in order
    for (const provider of this.providers) {
      if (!provider.supportsToken(symbol)) {
        continue;
      }

      try {
        const result = await provider.getCurrentPrice(symbol);
        this.currentPriceCache.set(cacheKey, {
          data: result,
          fetchedAt: Date.now(),
        });
        return result;
      } catch (error) {
        console.warn(
          `[PriceManager] ${provider.name} getCurrentPrice failed for ${symbol}:`,
          error instanceof Error ? error.message : error
        );
        // Continue to next provider
      }
    }

    console.warn(`[PriceManager] All providers failed for getCurrentPrice(${symbol})`);
    return null;
  }

  /**
   * Get current price for an ERC-20 token by contract address.
   * Only uses providers that support contract lookups.
   *
   * @param chainId - EVM chain ID
   * @param contractAddress - Token contract address
   * @returns Price data or null if all providers fail
   */
  async getTokenPriceByContract(
    chainId: number,
    contractAddress: string
  ): Promise<CurrentPriceResult | null> {
    const cacheKey = `${chainId}:${contractAddress.toLowerCase()}`;

    // Check cache
    const cached = this.currentPriceCache.get(cacheKey);
    if (cached && !this.isExpired(cached, CURRENT_PRICE_TTL)) {
      return cached.data;
    }

    // Try providers that support contract lookups
    for (const provider of this.providers) {
      if (!provider.getTokenPriceByContract) {
        continue;
      }

      try {
        const result = await provider.getTokenPriceByContract(chainId, contractAddress);
        this.currentPriceCache.set(cacheKey, {
          data: result,
          fetchedAt: Date.now(),
        });
        return result;
      } catch (error) {
        console.warn(
          `[PriceManager] ${provider.name} getTokenPriceByContract failed for ${contractAddress}:`,
          error instanceof Error ? error.message : error
        );
        // Continue to next provider
      }
    }

    console.warn(
      `[PriceManager] All providers failed for getTokenPriceByContract(${chainId}, ${contractAddress})`
    );
    return null;
  }

  /**
   * Get price history for a token.
   * Tries providers in priority order.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @param timeRange - Time range for history
   * @returns Price history or null if all providers fail
   */
  async getPriceHistory(
    symbol: string,
    timeRange: TimeRange
  ): Promise<PriceHistoryResult | null> {
    const cacheKey = `${symbol.toUpperCase()}-${timeRange}`;

    // Check cache
    const cached = this.historyCache.get(cacheKey);
    if (cached && !this.isExpired(cached, HISTORY_TTL)) {
      return cached.data;
    }

    // Try providers in order
    for (const provider of this.providers) {
      if (!provider.supportsToken(symbol)) {
        continue;
      }

      try {
        const result = await provider.getPriceHistory(symbol, timeRange);
        this.historyCache.set(cacheKey, {
          data: result,
          fetchedAt: Date.now(),
        });
        return result;
      } catch (error) {
        console.warn(
          `[PriceManager] ${provider.name} getPriceHistory failed for ${symbol}/${timeRange}:`,
          error instanceof Error ? error.message : error
        );
        // Continue to next provider
      }
    }

    console.warn(
      `[PriceManager] All providers failed for getPriceHistory(${symbol}, ${timeRange})`
    );
    return null;
  }

  /**
   * Get token metadata.
   * Tries providers in priority order.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @returns Token metadata or null if all providers fail
   */
  async getTokenMetadata(symbol: string): Promise<TokenMetadataResult | null> {
    const cacheKey = symbol.toUpperCase();

    // Check cache
    const cached = this.metadataCache.get(cacheKey);
    if (cached && !this.isExpired(cached, METADATA_TTL)) {
      return cached.data;
    }

    // Try providers in order
    for (const provider of this.providers) {
      if (!provider.supportsToken(symbol)) {
        continue;
      }

      try {
        const result = await provider.getTokenMetadata(symbol);
        this.metadataCache.set(cacheKey, {
          data: result,
          fetchedAt: Date.now(),
        });
        return result;
      } catch (error) {
        console.warn(
          `[PriceManager] ${provider.name} getTokenMetadata failed for ${symbol}:`,
          error instanceof Error ? error.message : error
        );
        // Continue to next provider
      }
    }

    console.warn(`[PriceManager] All providers failed for getTokenMetadata(${symbol})`);
    return null;
  }

  /**
   * Clear all caches.
   * Useful for testing or forcing fresh data.
   */
  clearCache(): void {
    this.currentPriceCache.clear();
    this.historyCache.clear();
    this.metadataCache.clear();
  }

  /**
   * Clear only current price cache.
   */
  clearCurrentPriceCache(): void {
    this.currentPriceCache.clear();
  }

  /**
   * Clear only history cache.
   */
  clearHistoryCache(): void {
    this.historyCache.clear();
  }

  /**
   * Clear only metadata cache.
   */
  clearMetadataCache(): void {
    this.metadataCache.clear();
  }

  /**
   * Get cache statistics (for debugging).
   */
  getCacheStats(): {
    currentPriceEntries: number;
    historyEntries: number;
    metadataEntries: number;
  } {
    return {
      currentPriceEntries: this.currentPriceCache.size,
      historyEntries: this.historyCache.size,
      metadataEntries: this.metadataCache.size,
    };
  }
}

