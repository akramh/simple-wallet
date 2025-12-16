/**
 * @fileoverview Hook for token balances with refresh functionality.
 *
 * @responsibilities
 * - Provide portfolio balances + price-derived totals to the UI
 * - Coordinate refresh behavior via the global store
 * - Offer small helpers for common UI computations (token fiat value)
 *
 * @notes
 * - Balances/prices ultimately come from `WalletBridge` via `useWalletStore`.
 * - This hook is intentionally “read-mostly”; it does not mutate state directly.
 */

import { useEffect, useCallback } from 'react';
import { useWalletStore } from '../store';

/**
 * Hook for managing token balances.
 *
 * @returns Balance and price state, plus refresh helpers.
 */
export function useBalances() {
  const {
    isUnlocked,
    balances,
    isRefreshingBalances,
    balancesLastUpdated,
    refreshBalances,
    prices,
    totalValue,
    formattedTotal,
    isLoadingPrices,
    refreshPrices,
  } = useWalletStore();

  /**
   * Auto-refresh on mount if unlocked and no prior refresh has happened.
   * This keeps the wallet tab usable immediately after unlock.
   */
  useEffect(() => {
    if (isUnlocked && !balancesLastUpdated) {
      refreshBalances();
    }
  }, [isUnlocked, balancesLastUpdated, refreshBalances]);

  /** Whether cached balances are stale for UI purposes (> 30s). */
  const isStale = balancesLastUpdated
    ? Date.now() - balancesLastUpdated > 30000
    : true;

  /**
   * Force refresh handler.
   * @returns Resolves when balances are refreshed.
   */
  const refresh = useCallback(async () => {
    await refreshBalances();
  }, [refreshBalances]);

  /**
   * Get balance for a specific token symbol.
   * @param symbol - Token symbol (e.g. 'ETH', 'SOL').
   * @returns Balance string (defaults to '0' if not found).
   */
  const getBalance = useCallback(
    (symbol: string) => {
      const item = balances.find((b) => b.token.symbol === symbol);
      return item?.balance ?? '0';
    },
    [balances]
  );

  /**
   * Get cached USD price for a token symbol (if available).
   * @param symbol - Token symbol.
   * @returns Price in USD or null if unknown/unavailable.
   */
  const getPrice = useCallback(
    (symbol: string) => {
      return prices[symbol] ?? null;
    },
    [prices]
  );

  /**
   * Calculate fiat USD value for a token amount using cached prices.
   * @param symbol - Token symbol.
   * @param amount - Token amount (display units).
   * @returns Formatted USD string or null if price unavailable.
   */
  const calculateFiatValue = useCallback(
    (symbol: string, amount: string) => {
      const price = prices[symbol];
      if (!price) return null;
      const value = parseFloat(amount) * price;
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      });
    },
    [prices]
  );

  return {
    // Balances
    balances,
    isRefreshing: isRefreshingBalances,
    lastUpdated: balancesLastUpdated,
    isStale,
    refresh,
    getBalance,

    // Prices
    prices,
    totalValue,
    formattedTotal,
    isLoadingPrices,
    refreshPrices,
    getPrice,
    calculateFiatValue,
  };
}
