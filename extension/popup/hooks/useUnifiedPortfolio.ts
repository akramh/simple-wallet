/**
 * @fileoverview React hook for the unified cross-chain portfolio.
 *
 * Fetches the current snapshot from the service worker's `GET_UNIFIED_PORTFOLIO`
 * handler on mount, subscribes to `UNIFIED_PORTFOLIO_UPDATED` and
 * `BALANCES_UPDATED` broadcasts so the UI stays in sync with background
 * refreshes, and exposes a manual `refresh()` that awaits a fan-out cycle.
 *
 * Stale-while-revalidate: the hook keeps the previous snapshot mounted while
 * a refresh is in flight; rows and hero total update in place when the new
 * snapshot arrives. No full-list skeleton flash after the initial load.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BuildUnifiedPortfolioOptions,
  UnifiedPortfolioSnapshot,
} from '../../../src/types/unified-portfolio.js';
import { sendMessageWithRetry } from '../utils/messaging';

interface UseUnifiedPortfolioResult {
  /** Current snapshot; `null` until the first response lands. */
  snapshot: UnifiedPortfolioSnapshot | null;
  /** True before the first snapshot arrives. Cleared even when snapshot is empty. */
  loading: boolean;
  /** True while a manual refresh is in flight. */
  refreshing: boolean;
  /** Last error message from `GET_UNIFIED_PORTFOLIO`, if any. */
  error: string | null;
  /** Force a fan-out refresh; resolves when the new snapshot is stored. */
  refresh: () => Promise<void>;
}

const DEFAULT_OPTIONS: BuildUnifiedPortfolioOptions = {};

/**
 * Subscribe to the unified portfolio snapshot.
 *
 * @param enabled - Pass `false` to suspend fetches and subscriptions (e.g.
 *   while the wallet is locked or while a different view is active). The hook
 *   still retains the last snapshot so switching back is instant.
 * @param options - Passed through to `buildUnifiedPortfolio` (sort, zero-balance filter, etc.).
 * @param walletName - Identity of the active wallet. When this changes, the
 *   hook clears the cached snapshot before the refetch so the UI does not
 *   render stale rows from the previous wallet during the in-flight fetch.
 *   Pass `null`/`undefined` if no wallet identity is available yet (e.g. the
 *   very first render before the service worker has replied) — the hook
 *   will not reset on subsequent nulls.
 */
export function useUnifiedPortfolio(
  enabled: boolean,
  options: BuildUnifiedPortfolioOptions = DEFAULT_OPTIONS,
  walletName?: string | null
): UseUnifiedPortfolioResult {
  const [snapshot, setSnapshot] = useState<UnifiedPortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [prevWalletName, setPrevWalletName] = useState<string | null | undefined>(walletName);
  const mountedRef = useRef(true);

  // Snapshot options are an object literal at call sites and would churn the
  // dependency array. Stringifying keeps the effect stable when values match.
  const optionsKey = JSON.stringify(options ?? {});

  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await sendMessageWithRetry<{ snapshot?: UnifiedPortfolioSnapshot; error?: string }>({
        type: 'GET_UNIFIED_PORTFOLIO',
        payload: { options },
      });
      if (!mountedRef.current) return;
      if (response?.snapshot) {
        setSnapshot(response.snapshot);
        setError(null);
      } else if (response?.error) {
        setError(response.error);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setRefreshing(true);
    try {
      const response = await sendMessageWithRetry<{ snapshot?: UnifiedPortfolioSnapshot; error?: string }>({
        type: 'REFRESH_UNIFIED_PORTFOLIO',
        payload: { options },
      });
      if (!mountedRef.current) return;
      if (response?.snapshot) {
        setSnapshot(response.snapshot);
        setError(null);
      } else if (response?.error) {
        setError(response.error);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, optionsKey]);

  // Clear the snapshot synchronously when the active wallet changes so the
  // old wallet's rows cannot flash on screen while the new snapshot is
  // in-flight. Follows the React "store information from previous renders"
  // idiom (calling setState during render is allowed when guarded by a prop
  // comparison — React short-circuits and re-renders immediately).
  //
  // Only reset on *real* changes between defined wallet names. A transient
  // `undefined → name` during first load must not wipe any snapshot we
  // already managed to fetch.
  if (prevWalletName !== walletName) {
    setPrevWalletName(walletName);
    if (
      walletName !== undefined &&
      walletName !== null &&
      prevWalletName !== undefined &&
      prevWalletName !== null
    ) {
      setSnapshot(null);
      setError(null);
      setLoading(true);
    }
  }

  // Initial fetch + re-fetch whenever enabled flips back on, options change,
  // or the active wallet changes. `walletName` is in the dep array so a
  // switch always triggers a fresh fetch against the service worker's
  // per-wallet cache.
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }
    setLoading(true);
    fetchSnapshot();
    return () => {
      mountedRef.current = false;
    };
  }, [enabled, fetchSnapshot, walletName]);

  // Background broadcasts — keep the snapshot hot without a re-request.
  useEffect(() => {
    if (!enabled) return;
    const listener = (message: any) => {
      if (!mountedRef.current) return;
      if (message?.type === 'UNIFIED_PORTFOLIO_UPDATED' && message.snapshot) {
        setSnapshot(message.snapshot);
        setLoading(false);
        setError(null);
        return;
      }
      if (message?.type === 'BALANCES_UPDATED') {
        // A single-network refresh landed; re-query for a fresh snapshot.
        // Cheap — it's a cache read on the service-worker side.
        fetchSnapshot();
      }
      if (message?.type === 'WALLET_LOCKED') {
        setSnapshot(null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [enabled, fetchSnapshot]);

  return { snapshot, loading, refreshing, error, refresh };
}
