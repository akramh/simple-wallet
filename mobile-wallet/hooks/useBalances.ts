/**
 * @fileoverview Hook for token balances with refresh functionality.
 */

import { useEffect, useCallback } from 'react';
import { useWalletStore } from '../store';

/**
 * Hook for managing token balances.
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

  // Auto-refresh on mount if unlocked
  useEffect(() => {
    if (isUnlocked && !balancesLastUpdated) {
      refreshBalances();
    }
  }, [isUnlocked, balancesLastUpdated, refreshBalances]);

  // Calculate if data is stale (> 30 seconds)
  const isStale = balancesLastUpdated
    ? Date.now() - balancesLastUpdated > 30000
    : true;

  // Force refresh handler
  const refresh = useCallback(async () => {
    await refreshBalances();
  }, [refreshBalances]);

  // Get balance for a specific token
  const getBalance = useCallback(
    (symbol: string) => {
      const item = balances.find((b) => b.token.symbol === symbol);
      return item?.balance ?? '0';
    },
    [balances]
  );

  // Get price for a specific token
  const getPrice = useCallback(
    (symbol: string) => {
      return prices[symbol] ?? null;
    },
    [prices]
  );

  // Calculate fiat value for a token amount
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
