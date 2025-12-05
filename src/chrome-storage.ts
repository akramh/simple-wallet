import type { StorageAdapter } from './storage.js';

/**
 * Chrome extension storage adapter using chrome.storage.local API.
 * Provides persistent storage for the wallet extension.
 */
export class ChromeStorageAdapter implements StorageAdapter {
  private cache = new Map<string, any>();

  /**
   * Convenience helper to create and initialize the adapter in one call.
   */
  static async create(): Promise<ChromeStorageAdapter> {
    const storage = new ChromeStorageAdapter();
    await storage.initialize();
    return storage;
  }

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

  exists(path: string): boolean {
    return this.cache.has(path);
  }

  readFile(path: string): string | null {
    try {
      const data = this.cache.get(path);
      return data ? String(data) : null;
    } catch {
      return null;
    }
  }

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
