/**
 * @fileoverview Hook for fetching and managing price history data.
 *
 * Provides a simple interface for components to fetch price history
 * and token metadata with automatic loading states and error handling.
 *
 * @usage
 * ```tsx
 * const { history, metadata, isLoading, error, fetchHistory, fetchMetadata } = usePriceHistory('ETH');
 * ```
 */

import { useState, useCallback, useEffect } from 'react';
import {
  getPriceHistory,
  getTokenMetadata,
  type TimeRange,
  type PriceHistoryData,
  type TokenMetadata,
} from '../services';

// ============================================================================
// Types
// ============================================================================

interface UsePriceHistoryState {
  /** Price history data, null if not loaded or unavailable */
  history: PriceHistoryData | null;
  /** Token metadata, null if not loaded or unavailable */
  metadata: TokenMetadata | null;
  /** Whether price history is currently loading */
  isLoadingHistory: boolean;
  /** Whether metadata is currently loading */
  isLoadingMetadata: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Currently selected time range */
  selectedRange: TimeRange;
}

interface UsePriceHistoryActions {
  /** Fetch price history for a time range */
  fetchHistory: (range: TimeRange, forceRefresh?: boolean) => Promise<void>;
  /** Fetch token metadata */
  fetchMetadata: (forceRefresh?: boolean) => Promise<void>;
  /** Set the selected time range (triggers history fetch) */
  setTimeRange: (range: TimeRange) => void;
  /** Clear all data and errors */
  reset: () => void;
}

type UsePriceHistoryReturn = UsePriceHistoryState & UsePriceHistoryActions;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for fetching price history and token metadata
 *
 * @param symbol - Token symbol (e.g., "ETH", "BTC")
 * @param initialRange - Initial time range (default: "1D")
 * @param autoFetch - Whether to fetch on mount (default: true)
 */
export function usePriceHistory(
  symbol: string,
  initialRange: TimeRange = '1D',
  autoFetch = true
): UsePriceHistoryReturn {
  const [history, setHistory] = useState<PriceHistoryData | null>(null);
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<TimeRange>(initialRange);

  const fetchHistory = useCallback(
    async (range: TimeRange, forceRefresh = false) => {
      if (!symbol) return;

      setIsLoadingHistory(true);
      setError(null);

      try {
        const data = await getPriceHistory(symbol, range, forceRefresh);
        setHistory(data);

        if (!data) {
          // Don't set error for unsupported tokens - just show empty state
          console.log(`[usePriceHistory] No price history available for ${symbol}`);
        }
      } catch (err) {
        console.error('[usePriceHistory] Fetch failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch price history');
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [symbol]
  );

  const fetchMetadata = useCallback(
    async (forceRefresh = false) => {
      if (!symbol) return;

      setIsLoadingMetadata(true);

      try {
        const data = await getTokenMetadata(symbol, forceRefresh);
        setMetadata(data);
      } catch (err) {
        console.error('[usePriceHistory] Metadata fetch failed:', err);
        // Don't set error for metadata - it's optional
      } finally {
        setIsLoadingMetadata(false);
      }
    },
    [symbol]
  );

  const setTimeRange = useCallback(
    (range: TimeRange) => {
      setSelectedRange(range);
      fetchHistory(range);
    },
    [fetchHistory]
  );

  const reset = useCallback(() => {
    setHistory(null);
    setMetadata(null);
    setError(null);
    setIsLoadingHistory(false);
    setIsLoadingMetadata(false);
    setSelectedRange(initialRange);
  }, [initialRange]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && symbol) {
      fetchHistory(initialRange);
      fetchMetadata();
    }
  }, [symbol, autoFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when symbol changes
  useEffect(() => {
    reset();
    if (symbol) {
      fetchHistory(initialRange);
      fetchMetadata();
    }
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    history,
    metadata,
    isLoadingHistory,
    isLoadingMetadata,
    error,
    selectedRange,
    fetchHistory,
    fetchMetadata,
    setTimeRange,
    reset,
  };
}

export default usePriceHistory;
