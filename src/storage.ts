/**
 * @fileoverview Storage abstraction layer for wallet data persistence.
 * 
 * This module provides a unified StorageAdapter interface that abstracts
 * file system operations, enabling the wallet to run in different environments:
 * - Node.js/CLI: Uses FileStorage with fs module
 * - Tests: Uses MemoryStorage for isolated, fast tests
 * - Browser: Uses ChromeStorageAdapter (separate module)
 * 
 * All storage operations are synchronous to match the simple wallet use case.
 * 
 * @module storage
 */

import fs from 'fs';

/**
 * Abstract interface for key-value storage operations.
 * Implementations provide environment-specific persistence mechanisms.
 */
export interface StorageAdapter {
  /**
   * Read and parse a JSON file.
   * @param path - Storage key or file path
   * @param fallback - Default value if file doesn't exist or is invalid
   * @returns Parsed JSON data or fallback value
   */
  readJSON<T>(path: string, fallback: T): T;

  /**
   * Serialize and write data as JSON.
   * @param path - Storage key or file path
   * @param data - Data to serialize and store
   */
  writeJSON<T>(path: string, data: T): void;

  /**
   * Check if a storage key/file exists.
   * @param path - Storage key or file path
   * @returns True if the key/file exists
   */
  exists(path: string): boolean;

  /**
   * Read raw file contents as string.
   * @param path - Storage key or file path
   * @returns File contents or null if not found
   */
  readFile(path: string): string | null;

  /**
   * Write raw string contents to storage.
   * @param path - Storage key or file path
   * @param contents - String data to write
   */
  writeFile(path: string, contents: string): void;
}

/**
 * File system-backed storage for Node.js/CLI usage.
 * Reads and writes JSON files directly to disk.
 */
export class FileStorage implements StorageAdapter {
  /**
   * Read and parse a JSON file from disk.
   * @param path - Relative or absolute file path
   * @param fallback - Default value returned if file doesn't exist or JSON is invalid
   * @returns Parsed JSON object or fallback
   */
  readJSON<T>(path: string, fallback: T): T {
    try {
      if (!fs.existsSync(path)) return fallback;
      return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Write data as formatted JSON to disk.
   * @param path - Relative or absolute file path
   * @param data - Object to serialize (pretty-printed with 2-space indent)
   */
  writeJSON<T>(path: string, data: T): void {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  }

  /**
   * Check if a file exists on disk.
   * @param path - File path to check
   * @returns True if file exists
   */
  exists(path: string): boolean {
    return fs.existsSync(path);
  }

  /**
   * Read raw file contents as UTF-8 string.
   * @param path - File path to read
   * @returns File contents or null on error
   */
  readFile(path: string): string | null {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Write raw string data to file.
   * @param path - File path to write
   * @param contents - String data to write
   */
  writeFile(path: string, contents: string): void {
    fs.writeFileSync(path, contents);
  }
}

/**
 * In-memory storage for tests, browser fallback, or ephemeral sessions.
 * Data is stored in a Map and lost when the process exits.
 * Provides identical interface to FileStorage for seamless swapping.
 */
export class MemoryStorage implements StorageAdapter {
  /** Internal key-value store */
  private store = new Map<string, string>();

  /**
   * Read and parse JSON from memory.
   * @param path - Storage key
   * @param fallback - Default value if key doesn't exist
   * @returns Parsed JSON or fallback
   */
  readJSON<T>(path: string, fallback: T): T {
    try {
      const raw = this.store.get(path);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Serialize and store JSON in memory.
   * @param path - Storage key
   * @param data - Object to serialize and store
   */
  writeJSON<T>(path: string, data: T): void {
    this.store.set(path, JSON.stringify(data));
  }

  /**
   * Check if a key exists in memory.
   * @param path - Storage key to check
   * @returns True if key exists
   */
  exists(path: string): boolean {
    return this.store.has(path);
  }

  /**
   * Read raw string value from memory.
   * @param path - Storage key
   * @returns Stored string or null if not found
   */
  readFile(path: string): string | null {
    const val = this.store.get(path);
    return val ?? null;
  }

  /**
   * Store raw string value in memory.
   * @param path - Storage key
   * @param contents - String data to store
   */
  writeFile(path: string, contents: string): void {
    this.store.set(path, contents);
  }
}
