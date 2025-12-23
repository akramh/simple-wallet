/**
 * @fileoverview Background refresh hook for periodic data updates.
 *
 * @description
 * Provides automatic background refreshing of wallet data without blocking the UI.
 * Uses configurable polling intervals and respects app foreground/background state.
 *
 * @responsibilities
 * - Poll for balance/price updates at configured intervals
 * - Pause polling when app is backgrounded
 * - Resume and immediately refresh when app returns to foreground
 * - Use silent refreshes to avoid UI loading indicators
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useWalletStore } from '../store';

/**
 * Default polling intervals in milliseconds.
 * These are conservative defaults to balance freshness vs battery/network usage.
 */
const DEFAULT_BALANCE_INTERVAL = 30_000; // 30 seconds
const DEFAULT_PRICE_INTERVAL = 300_000; // 5 minutes

/**
 * Options for configuring background refresh behavior.
 */
interface BackgroundRefreshOptions {
  /** Interval for balance refresh in ms (default: 30s) */
  balanceInterval?: number;
  /** Interval for price refresh in ms (default: 5min) */
  priceInterval?: number;
  /** Whether to enable polling (default: true) */
  enabled?: boolean;
}

/**
 * Hook for automatic background data refreshing.
 *
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * function WalletScreen() {
 *   // Start background polling with default intervals
 *   useBackgroundRefresh();
 *
 *   // Or with custom intervals
 *   useBackgroundRefresh({
 *     balanceInterval: 60_000, // 1 minute
 *     priceInterval: 600_000,  // 10 minutes
 *   });
 * }
 * ```
 */
export function useBackgroundRefresh(options: BackgroundRefreshOptions = {}) {
  const {
    balanceInterval = DEFAULT_BALANCE_INTERVAL,
    priceInterval = DEFAULT_PRICE_INTERVAL,
    enabled = true,
  } = options;

  const { isUnlocked, refreshBalancesAndPrices, refreshPrices } = useWalletStore(
    (state) => ({
      isUnlocked: state.isUnlocked,
      refreshBalancesAndPrices: state.refreshBalancesAndPrices,
      refreshPrices: state.refreshPrices,
    })
  );

  const balanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const priceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Silent refresh functions
  const refreshBalancesSilently = useCallback(() => {
    if (!isUnlocked) return;
    refreshBalancesAndPrices({ silent: true });
  }, [isUnlocked, refreshBalancesAndPrices]);

  const refreshPricesSilently = useCallback(() => {
    if (!isUnlocked) return;
    refreshPrices({ silent: true });
  }, [isUnlocked, refreshPrices]);

  // Start/stop polling
  const startPolling = useCallback(() => {
    if (!enabled || !isUnlocked) return;

    // Clear existing timers
    if (balanceTimerRef.current) clearInterval(balanceTimerRef.current);
    if (priceTimerRef.current) clearInterval(priceTimerRef.current);

    // Start balance polling
    balanceTimerRef.current = setInterval(refreshBalancesSilently, balanceInterval);

    // Start price polling (only if different from balance interval)
    if (priceInterval !== balanceInterval) {
      priceTimerRef.current = setInterval(refreshPricesSilently, priceInterval);
    }
  }, [
    enabled,
    isUnlocked,
    balanceInterval,
    priceInterval,
    refreshBalancesSilently,
    refreshPricesSilently,
  ]);

  const stopPolling = useCallback(() => {
    if (balanceTimerRef.current) {
      clearInterval(balanceTimerRef.current);
      balanceTimerRef.current = null;
    }
    if (priceTimerRef.current) {
      clearInterval(priceTimerRef.current);
      priceTimerRef.current = null;
    }
  }, []);

  // Handle app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (nextAppState === 'active' && previousState !== 'active') {
        // App came to foreground - refresh immediately and restart polling
        refreshBalancesSilently();
        startPolling();
      } else if (nextAppState === 'background') {
        // App went to background - stop polling to save battery
        stopPolling();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [refreshBalancesSilently, startPolling, stopPolling]);

  // Start/stop polling based on enabled and unlocked state
  useEffect(() => {
    if (enabled && isUnlocked) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enabled, isUnlocked, startPolling, stopPolling]);
}
