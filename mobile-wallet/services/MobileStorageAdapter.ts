/**
 * @fileoverview Mobile storage adapter using expo-secure-store and AsyncStorage.
 *
 * Implements the StorageAdapter interface for React Native:
 * - Sensitive data (wallets, mnemonics) → expo-secure-store (Keychain/Keystore)
 * - Non-sensitive data (settings, tx history) → AsyncStorage
 *
 * Note: expo-secure-store has a ~2KB limit per key, so we use it only for
 * wallet data and fall back to AsyncStorage for larger datasets.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Keys that contain sensitive data and should use SecureStore.
 */
const SECURE_KEYS = ['wallets.json'];

/**
 * Check if a path should use secure storage.
 */
function isSecureKey(path: string): boolean {
  return SECURE_KEYS.some((key) => path.includes(key));
}

/**
 * Convert file path to storage key (sanitize for storage APIs).
 */
function toStorageKey(path: string): string {
  return `wallet_${path.replace(/[\/\\\.]/g, '_')}`;
}

/**
 * StorageAdapter interface (must match src/storage.ts).
 */
export interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}

/**
 * Mobile storage adapter for React Native.
 *
 * Uses an in-memory cache for synchronous reads (required by StorageAdapter interface),
 * with async persistence to SecureStore/AsyncStorage.
 */
export class MobileStorageAdapter implements StorageAdapter {
  private cache = new Map<string, any>();
  private initialized = false;

  /**
   * Initialize the storage adapter by loading all cached data.
   * Must be called before any other methods.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load secure keys
      for (const key of SECURE_KEYS) {
        const storageKey = toStorageKey(key);
        const value = await SecureStore.getItemAsync(storageKey);
        if (value) {
          try {
            this.cache.set(key, JSON.parse(value));
          } catch {
            this.cache.set(key, value);
          }
        }
      }

      // Load all AsyncStorage keys
      const allKeys = await AsyncStorage.getAllKeys();
      const walletKeys = allKeys.filter((k) => k.startsWith('wallet_'));
      const pairs = await AsyncStorage.multiGet(walletKeys);

      for (const [storageKey, value] of pairs) {
        if (value) {
          // Convert storage key back to path
          const path = storageKey.replace(/^wallet_/, '').replace(/_/g, '.');
          if (!this.cache.has(path)) {
            try {
              this.cache.set(path, JSON.parse(value));
            } catch {
              this.cache.set(path, value);
            }
          }
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('[MobileStorageAdapter] Failed to initialize:', error);
      this.initialized = true; // Continue with empty cache
    }
  }

  /**
   * Read and parse JSON from cache.
   */
  readJSON<T>(path: string, fallback: T): T {
    if (!this.initialized) {
      console.warn('[MobileStorageAdapter] Reading before initialization');
    }

    const cached = this.cache.get(path);
    if (cached !== undefined) {
      return cached as T;
    }
    return fallback;
  }

  /**
   * Write JSON to cache and persist asynchronously.
   */
  writeJSON<T>(path: string, data: T): void {
    this.cache.set(path, data);
    this.persistAsync(path, JSON.stringify(data));
  }

  /**
   * Check if a path exists in cache.
   */
  exists(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Read raw string from cache.
   */
  readFile(path: string): string | null {
    const cached = this.cache.get(path);
    if (cached === undefined) return null;
    return typeof cached === 'string' ? cached : JSON.stringify(cached);
  }

  /**
   * Write raw string to cache and persist.
   */
  writeFile(path: string, contents: string): void {
    this.cache.set(path, contents);
    this.persistAsync(path, contents);
  }

  /**
   * Persist data to appropriate storage backend.
   */
  private async persistAsync(path: string, value: string): Promise<void> {
    const storageKey = toStorageKey(path);

    try {
      if (isSecureKey(path)) {
        await SecureStore.setItemAsync(storageKey, value);
      } else {
        await AsyncStorage.setItem(storageKey, value);
      }
    } catch (error) {
      console.error(`[MobileStorageAdapter] Failed to persist ${path}:`, error);

      // SecureStore has size limits; fall back to AsyncStorage for large data
      if (isSecureKey(path)) {
        console.warn(`[MobileStorageAdapter] Falling back to AsyncStorage for ${path}`);
        try {
          await AsyncStorage.setItem(storageKey, value);
        } catch (fallbackError) {
          console.error(`[MobileStorageAdapter] Fallback also failed:`, fallbackError);
        }
      }
    }
  }

  /**
   * Delete a key from storage.
   */
  async delete(path: string): Promise<void> {
    const storageKey = toStorageKey(path);
    this.cache.delete(path);

    try {
      if (isSecureKey(path)) {
        await SecureStore.deleteItemAsync(storageKey);
      } else {
        await AsyncStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error(`[MobileStorageAdapter] Failed to delete ${path}:`, error);
    }
  }

  /**
   * Clear all wallet data (for logout/reset).
   */
  async clear(): Promise<void> {
    this.cache.clear();

    try {
      // Clear secure keys
      for (const key of SECURE_KEYS) {
        await SecureStore.deleteItemAsync(toStorageKey(key));
      }

      // Clear AsyncStorage wallet keys
      const allKeys = await AsyncStorage.getAllKeys();
      const walletKeys = allKeys.filter((k) => k.startsWith('wallet_'));
      await AsyncStorage.multiRemove(walletKeys);
    } catch (error) {
      console.error('[MobileStorageAdapter] Failed to clear:', error);
    }
  }
}

/**
 * Singleton instance for use throughout the app.
 */
export const mobileStorage = new MobileStorageAdapter();
