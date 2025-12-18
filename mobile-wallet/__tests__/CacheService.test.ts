/**
 * @fileoverview Unit tests for CacheService TTL + stale read semantics.
 *
 * These tests use a lightweight in-memory mock of `mobileStorage` to keep
 * behavior deterministic and hermetic (no real AsyncStorage/SecureStore).
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../services/MobileStorageAdapter', () => {
  const store = new Map<string, any>();
  return {
    __esModule: true,
    mobileStorage: {
      readJSON: (path: string, fallback: any) => (store.has(path) ? store.get(path) : fallback),
      writeJSON: (path: string, data: any) => store.set(path, data),
    },
  };
});

import { CacheService } from '../services/CacheService';

describe('CacheService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('get returns null after TTL, but getStale returns the cached value', () => {
    const cache = new CacheService({ version: 1 });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    cache.set('balances', 'k1', { v: 1 }, 1_000);
    expect(cache.get('balances', 'k1')?.value).toEqual({ v: 1 });

    nowSpy.mockReturnValue(2_001);
    expect(cache.get('balances', 'k1')).toBeNull();
    expect(cache.getStale('balances', 'k1')?.value).toEqual({ v: 1 });
  });

  test('version mismatch hides cached values', () => {
    const cacheV1 = new CacheService({ version: 1 });
    const cacheV2 = new CacheService({ version: 2 });

    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    cacheV1.set('balances', 'k1', { v: 1 }, 10_000);

    expect(cacheV2.get('balances', 'k1')).toBeNull();
    expect(cacheV2.getStale('balances', 'k1')).toBeNull();
  });
});

