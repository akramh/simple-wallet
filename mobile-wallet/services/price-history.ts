/**
 * @fileoverview Price history service for token detail charts.
 *
 * Uses the shared priceProviderManager which has CoinGecko as primary
 * (with Pro API key support) and CoinPaprika as fallback.
 *
 * @responsibilities
 * - Fetch price history for tokens across different time ranges
 * - Fetch token metadata (market cap, supply, description)
 * - Provide formatting utilities for display
 *
 * @security
 * - No sensitive data handled
 * - Read-only API calls
 */

import { priceProviderManager } from '@wallet/price-providers/index';
import type {
  TimeRange as SharedTimeRange,
  PriceHistoryResult,
  TokenMetadataResult,
} from '@wallet/price-providers/index';

// ============================================================================
// Types (Re-export shared types with mobile-specific extensions)
// ============================================================================

export type TimeRange = SharedTimeRange;

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface PriceHistoryData {
  data: PricePoint[];
  symbol: string;
  timeRange: TimeRange;
  fetchedAt: number;
  priceChange: {
    value: number;
    percent: number;
  };
}

export interface TokenMetadata {
  description: string;
  marketCap: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  websiteUrl: string | null;
  fetchedAt: number;
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Fetch price history for a token.
 * Uses CoinGecko as primary provider (with Pro API key) and CoinPaprika as fallback.
 *
 * @param symbol - Token symbol (e.g., "ETH", "BTC")
 * @param timeRange - Time range for history
 * @param forceRefresh - Bypass cache (not currently supported, cache managed by priceProviderManager)
 * @returns Price history data or null if unavailable
 */
export async function getPriceHistory(
  symbol: string,
  timeRange: TimeRange,
  forceRefresh = false
): Promise<PriceHistoryData | null> {
  // Note: forceRefresh is not supported by priceProviderManager currently
  // The manager has its own cache with 5-minute TTL for history
  if (forceRefresh) {
    // Clear the provider manager's cache for fresh data
    priceProviderManager.clearHistoryCache();
  }

  try {
    const result: PriceHistoryResult | null = await priceProviderManager.getPriceHistory(
      symbol,
      timeRange
    );

    if (!result || !result.data || result.data.length === 0) {
      console.log(`[PriceHistory] No data available for ${symbol}`);
      return null;
    }

    // Transform to mobile-specific format
    return {
      data: result.data,
      symbol: symbol.toUpperCase(),
      timeRange,
      fetchedAt: Date.now(),
      priceChange: result.priceChange,
    };
  } catch (error) {
    console.error(`[PriceHistory] Failed to fetch history for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch token metadata (description, market cap, supply).
 * Uses CoinGecko as primary provider (with Pro API key) and CoinPaprika as fallback.
 *
 * @param symbol - Token symbol
 * @param forceRefresh - Bypass cache (not currently supported, cache managed by priceProviderManager)
 * @returns Token metadata or null if unavailable
 */
export async function getTokenMetadata(
  symbol: string,
  forceRefresh = false
): Promise<TokenMetadata | null> {
  // Note: forceRefresh is not supported by priceProviderManager currently
  // The manager has its own cache with 1-hour TTL for metadata
  if (forceRefresh) {
    priceProviderManager.clearMetadataCache();
  }

  try {
    const result: TokenMetadataResult | null = await priceProviderManager.getTokenMetadata(symbol);

    if (!result) {
      console.log(`[PriceHistory] No metadata available for ${symbol}`);
      return null;
    }

    // Transform to mobile-specific format
    return {
      description: result.description,
      marketCap: result.marketCap,
      totalSupply: result.totalSupply,
      circulatingSupply: result.circulatingSupply,
      websiteUrl: result.websiteUrl,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error(`[PriceHistory] Failed to fetch metadata for ${symbol}:`, error);
    return null;
  }
}

/**
 * Clear all price history caches.
 * Delegates to the shared priceProviderManager.
 */
export function clearPriceHistoryCache(): void {
  priceProviderManager.clearHistoryCache();
  priceProviderManager.clearMetadataCache();
}

/**
 * Get CoinGecko ID for a token symbol (for backwards compatibility).
 * Note: This is now handled internally by the priceProviderManager.
 */
export function getCoinGeckoId(symbol: string): string | null {
  // Import the mapping from the shared provider for backwards compatibility
  const { SYMBOL_TO_COINGECKO_ID } = require('@wallet/price-providers/coingecko');
  return SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()] || null;
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format large numbers for display
 */
export function formatLargeNumber(value: number | null): string {
  if (value === null) return '--';

  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Format supply numbers
 */
export function formatSupply(value: number | null, symbol: string): string {
  if (value === null) return '--';

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B ${symbol}`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M ${symbol}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K ${symbol}`;
  }
  return `${value.toFixed(2)} ${symbol}`;
}
