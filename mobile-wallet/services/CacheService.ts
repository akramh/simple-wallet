/**
 * @fileoverview Persistent cache helper for the mobile wallet.
 *
 * This wraps `MobileStorageAdapter` to provide a small “stale-while-revalidate”
 * building block for UI data (balances, prices, transactions metadata).
 *
 * @responsibilities
 * - Persist non-sensitive UI data in AsyncStorage via `mobileStorage`
 * - Provide TTL-based freshness checks while still allowing “stale” reads
 * - Keep cache keys stable and storage-safe (no `/` or `_` in paths)
 *
 * @security
 * - This cache is ONLY for non-sensitive derived data (balances/prices/etc.).
 * - Do not store secrets (passwords, mnemonics, private keys) here.
 */

import { mobileStorage } from './MobileStorageAdapter';

export interface CachedEnvelope<T> {
  /** Schema version for invalidation. */
  version: number;
  /** Unix timestamp in ms when the value was cached. */
  cachedAt: number;
  /** TTL in ms for “fresh” reads. */
  ttlMs: number;
  /** Original cache key (debugging/diagnostics). */
  key: string;
  /** Cached payload. */
  value: T;
}

export type CacheKey = string;

/**
 * Encode a cache key to a storage-safe identifier.
 *
 * @remarks
 * - Must avoid `/` because `MobileStorageAdapter` path decoding is not invertible for separators.
 * - Must avoid `_` because `MobileStorageAdapter` converts `_` → `.` when restoring paths.
 */
function encodeCacheKey(key: CacheKey): string {
  const base64 = global.Buffer
    ? global.Buffer.from(key, 'utf8').toString('base64')
    : // Fallback should be extremely rare in RN; keep it deterministic.
      encodeURIComponent(key);
  // Make it path-safe AND avoid underscores.
  return base64.replace(/\+/g, '-').replace(/\//g, '~').replace(/=+$/g, '');
}

function makeCachePath(namespace: string, key: CacheKey): string {
  // Dot-separated paths round-trip through MobileStorageAdapter.
  return `cache.${namespace}.${encodeCacheKey(key)}.json`;
}

/**
 * Simple persistent cache with TTL.
 *
 * @remarks
 * This intentionally does not support pattern invalidation because `MobileStorageAdapter`
 * does not expose a “list keys” API. We rely on:
 * - stable, context-specific keys (wallet/account/network/tokens revision)
 * - key evolution to naturally orphan old entries
 */
export class CacheService {
  private readonly version: number;

  constructor(options?: { version?: number }) {
    this.version = options?.version ?? 1;
  }

  /**
   * Read a cached value if it is still fresh.
   *
   * @param namespace - Logical namespace (e.g. `balances`, `prices`).
   * @param key - Cache key.
   * @returns The cached envelope or null if missing/expired/version-mismatch.
   */
  get<T>(namespace: string, key: CacheKey): CachedEnvelope<T> | null {
    const env = this.getStale<T>(namespace, key);
    if (!env) return null;
    if (env.version !== this.version) return null;
    const ageMs = Date.now() - env.cachedAt;
    return ageMs <= env.ttlMs ? env : null;
  }

  /**
   * Read a cached value even if expired (for SWR).
   *
   * @param namespace - Logical namespace (e.g. `balances`, `prices`).
   * @param key - Cache key.
   * @returns The cached envelope or null if missing/version-mismatch.
   */
  getStale<T>(namespace: string, key: CacheKey): CachedEnvelope<T> | null {
    const path = makeCachePath(namespace, key);
    const env = mobileStorage.readJSON<CachedEnvelope<T> | null>(path, null);
    if (!env) return null;
    if (env.version !== this.version) return null;
    return env;
  }

  /**
   * Persist a value to cache.
   *
   * @param namespace - Logical namespace (e.g. `balances`, `prices`).
   * @param key - Cache key.
   * @param value - Payload to store.
   * @param ttlMs - TTL for “fresh” reads.
   */
  set<T>(namespace: string, key: CacheKey, value: T, ttlMs: number): void {
    const path = makeCachePath(namespace, key);
    const env: CachedEnvelope<T> = {
      version: this.version,
      cachedAt: Date.now(),
      ttlMs,
      key,
      value,
    };
    mobileStorage.writeJSON(path, env);
  }
}

// Bump version to invalidate older cached snapshots (e.g., incorrect multi-network EVM holdings).
export const cacheService = new CacheService({ version: 2 });
