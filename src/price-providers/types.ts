/**
 * @fileoverview Price provider interface and shared types.
 *
 * Defines the contract that all price data providers must implement.
 * Supports both current prices and historical price data.
 *
 * @responsibilities
 * - Define PriceProvider interface for pluggable providers
 * - Define shared types for price data across all platforms
 * - Enable fallback logic through consistent interface
 */

// ============================================================================
// Time Range Types
// ============================================================================

/**
 * Supported time ranges for price history charts.
 */
export type TimeRange = '1H' | '1D' | '1W' | '1M' | 'YTD' | 'ALL';

// ============================================================================
// Price Data Types
// ============================================================================

/**
 * Single price point for historical charts.
 */
export interface PricePoint {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Price in USD */
  price: number;
}

/**
 * Result from current price lookup.
 */
export interface CurrentPriceResult {
  /** USD price */
  price: number;
  /** Optional 24h change percentage */
  change24h?: number;
}

/**
 * Result from price history lookup.
 */
export interface PriceHistoryResult {
  /** Array of price points */
  data: PricePoint[];
  /** Price change over the period */
  priceChange: {
    /** Absolute value change in USD */
    value: number;
    /** Percentage change */
    percent: number;
  };
}

/**
 * Token metadata from price provider.
 */
export interface TokenMetadataResult {
  /** Token description */
  description: string;
  /** Market capitalization in USD, null if unavailable */
  marketCap: number | null;
  /** Total token supply, null if unavailable */
  totalSupply: number | null;
  /** Circulating supply, null if unavailable */
  circulatingSupply: number | null;
  /** Official website URL, null if unavailable */
  websiteUrl: string | null;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface that all price providers must implement.
 *
 * Providers can support current prices, price history, or both.
 * The manager will try providers in priority order.
 *
 * @example
 * ```typescript
 * class MyProvider implements PriceProvider {
 *   readonly name = 'MyProvider';
 *   readonly priority = 1;
 *
 *   supportsToken(symbol: string): boolean {
 *     return SUPPORTED_TOKENS.includes(symbol.toUpperCase());
 *   }
 *
 *   async getCurrentPrice(symbol: string): Promise<CurrentPriceResult> {
 *     // Fetch from API...
 *   }
 * }
 * ```
 */
export interface PriceProvider {
  /** Provider name for logging and debugging */
  readonly name: string;

  /** Priority (lower = higher priority, tried first) */
  readonly priority: number;

  /**
   * Check if this provider supports the given token.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @returns true if this provider can fetch data for this token
   */
  supportsToken(symbol: string): boolean;

  /**
   * Get current price for a token by symbol.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @returns Current price data
   * @throws Error on failure (manager will try next provider)
   */
  getCurrentPrice(symbol: string): Promise<CurrentPriceResult>;

  /**
   * Get current price for an ERC-20 token by contract address.
   * Optional - not all providers support contract lookups.
   *
   * @param chainId - EVM chain ID
   * @param contractAddress - Token contract address
   * @returns Current price data
   * @throws Error on failure
   */
  getTokenPriceByContract?(
    chainId: number,
    contractAddress: string
  ): Promise<CurrentPriceResult>;

  /**
   * Fetch price history for a token.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @param timeRange - Time range for history
   * @returns Historical price data
   * @throws Error on failure (manager will try next provider)
   */
  getPriceHistory(symbol: string, timeRange: TimeRange): Promise<PriceHistoryResult>;

  /**
   * Fetch token metadata (market cap, supply, description).
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @returns Token metadata
   * @throws Error on failure (manager will try next provider)
   */
  getTokenMetadata(symbol: string): Promise<TokenMetadataResult>;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache entry with timestamp for TTL checking.
 */
export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

