/**
 * @fileoverview Chrome extension storage adapter using chrome.storage.local API.
 * 
 * This module provides a StorageAdapter implementation that persists data using
 * Chrome's extension storage API. It maintains an in-memory cache for synchronous
 * reads while asynchronously persisting changes to chrome.storage.local.
 * 
 * Key features:
 * - Synchronous read interface via in-memory cache
 * - Async persistence to chrome.storage.local
 * - Automatic cache hydration on initialization
 * - Path-to-key mapping for compatibility with FileStorage paths
 * 
 * Usage:
 * ```typescript
 * const storage = await ChromeStorageAdapter.create();
 * const wallets = storage.readJSON('wallets.json', {});
 * ```
 * 
 * @module chrome-storage
 */

import type { StorageAdapter } from './storage.js';

/**
 * Chrome extension storage adapter using chrome.storage.local API.
 * Provides persistent storage for the wallet extension.
 * 
 * Uses a two-tier approach:
 * 1. In-memory cache for fast synchronous reads
 * 2. Async writes to chrome.storage.local for persistence
 * 
 * Must call initialize() before use, or use the static create() factory.
 */
export class ChromeStorageAdapter implements StorageAdapter {
  /** In-memory cache for synchronous read access */
  private cache = new Map<string, any>();

  /**
   * Convenience helper to create and initialize the adapter in one call.
   */
  static async create(): Promise<ChromeStorageAdapter> {
    const storage = new ChromeStorageAdapter();
    await storage.initialize();
    return storage;
  }

  /**
   * Read and parse JSON from the cache.
   * Cache must be hydrated via initialize() first.
   * @param path - Storage key (file path format for compatibility)
   * @param fallback - Default value if key doesn't exist
   * @returns Parsed JSON data or fallback
   */
  readJSON<T>(path: string, fallback: T): T {
    try {
      // Return cached value if available
      if (this.cache.has(path)) {
        return this.cache.get(path) as T;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Serialize and write JSON to storage.
   * Updates cache immediately and persists to chrome.storage.local asynchronously.
   * @param path - Storage key (file path format for compatibility)
   * @param data - Object to serialize and store
   */
  writeJSON<T>(path: string, data: T): void {
    try {
      // Update cache
      this.cache.set(path, data);

      // Persist to chrome.storage.local
      const storageKey = this.getStorageKey(path);
      chrome.storage.local.set({ [storageKey]: JSON.stringify(data) }).catch(err => {
        console.error(`Failed to write to chrome.storage: ${err}`);
      });
    } catch (err) {
      console.error(`Failed to write JSON for ${path}:`, err);
    }
  }

  /**
   * Check if a key exists in the cache.
   * @param path - Storage key to check
   * @returns True if key exists in cache
   */
  exists(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Read raw string value from cache.
   * @param path - Storage key
   * @returns Cached string value or null if not found
   */
  readFile(path: string): string | null {
    try {
      const data = this.cache.get(path);
      return data ? String(data) : null;
    } catch {
      return null;
    }
  }

  /**
   * Write raw string value to storage.
   * Updates cache immediately and persists asynchronously.
   * @param path - Storage key
   * @param contents - String data to store
   */
  writeFile(path: string, contents: string): void {
    try {
      this.cache.set(path, contents);

      const storageKey = this.getStorageKey(path);
      chrome.storage.local.set({ [storageKey]: contents }).catch(err => {
        console.error(`Failed to write file to chrome.storage: ${err}`);
      });
    } catch (err) {
      console.error(`Failed to write file for ${path}:`, err);
    }
  }

  /**
   * Load all data from chrome.storage.local into the cache.
   * Should be called once during initialization.
   */
  async initialize(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(null);

      // Populate cache with all stored data
      for (const [key, value] of Object.entries(result)) {
        const path = this.getPathFromStorageKey(key);
        try {
          // Try to parse as JSON first
          const parsed = JSON.parse(value as string);
          this.cache.set(path, parsed);
        } catch {
          // If not JSON, store as-is
          this.cache.set(path, value);
        }
      }
    } catch (err) {
      console.error('Failed to initialize ChromeStorageAdapter:', err);
    }
  }

  /**
   * Clear all cached data and chrome.storage.
   */
  async clear(): Promise<void> {
    this.cache.clear();
    await chrome.storage.local.clear();
  }

  /**
   * Convert file path to storage key (replace slashes and special chars)
   */
  private getStorageKey(path: string): string {
    return `wallet_${path.replace(/[\/\\]/g, '_')}`;
  }

  /**
   * Convert storage key back to path
   */
  private getPathFromStorageKey(key: string): string {
    return key.replace(/^wallet_/, '').replace(/_/g, '/');
  }
}
