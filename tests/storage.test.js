/**
 * @fileoverview Tests for storage adapters (FileStorage and MemoryStorage)
 * 
 * These tests verify the storage foundation that both CLI and extension rely on.
 * Tests run offline using MemoryStorage and temporary files for FileStorage.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { FileStorage, MemoryStorage } from '../dist/storage.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('MemoryStorage', () => {
  /** @type {MemoryStorage} */
  let storage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('writeJSON / readJSON', () => {
    it('should write and read JSON data correctly', () => {
      const testData = { name: 'test', value: 123, nested: { key: 'value' } };
      
      storage.writeJSON('test-key', testData);
      const result = storage.readJSON('test-key', null);
      
      assert.deepStrictEqual(result, testData);
    });

    it('should return fallback for non-existent keys', () => {
      const result = storage.readJSON('non-existent-key', { default: true });
      
      assert.deepStrictEqual(result, { default: true });
    });

    it('should overwrite existing data', () => {
      storage.writeJSON('key', { version: 1 });
      storage.writeJSON('key', { version: 2 });
      
      const result = storage.readJSON('key', null);
      
      assert.deepStrictEqual(result, { version: 2 });
    });

    it('should handle arrays correctly', () => {
      const testArray = [1, 2, 3, { nested: 'object' }];
      
      storage.writeJSON('array-key', testArray);
      const result = storage.readJSON('array-key', null);
      
      assert.deepStrictEqual(result, testArray);
    });

    it('should handle empty objects', () => {
      storage.writeJSON('empty', {});
      const result = storage.readJSON('empty', null);
      
      assert.deepStrictEqual(result, {});
    });

    it('should handle null values correctly', () => {
      storage.writeJSON('null-key', null);
      // Since null is stored as "null" JSON, reading it back returns null
      const result = storage.readJSON('null-key', { fallback: true });
      
      assert.strictEqual(result, null);
    });
  });

  describe('exists', () => {
    it('should return false for non-existent keys', () => {
      const result = storage.exists('non-existent');
      
      assert.strictEqual(result, false);
    });

    it('should return true for existing keys', () => {
      storage.writeJSON('existing-key', { data: 'value' });
      
      const result = storage.exists('existing-key');
      
      assert.strictEqual(result, true);
    });
  });

  describe('readFile / writeFile', () => {
    it('should write and read raw file content', () => {
      storage.writeFile('test.txt', 'Hello, World!');
      const result = storage.readFile('test.txt');
      
      assert.strictEqual(result, 'Hello, World!');
    });

    it('should return null for non-existent files', () => {
      const result = storage.readFile('non-existent.txt');
      
      assert.strictEqual(result, null);
    });
  });

  describe('isolation', () => {
    it('should isolate data between different keys', () => {
      storage.writeJSON('key-a', { value: 'a' });
      storage.writeJSON('key-b', { value: 'b' });
      
      const resultA = storage.readJSON('key-a', null);
      const resultB = storage.readJSON('key-b', null);
      
      assert.deepStrictEqual(resultA, { value: 'a' });
      assert.deepStrictEqual(resultB, { value: 'b' });
    });

    it('should isolate data between different MemoryStorage instances', () => {
      const storage2 = new MemoryStorage();
      
      storage.writeJSON('shared-key', { instance: 1 });
      storage2.writeJSON('shared-key', { instance: 2 });
      
      const result1 = storage.readJSON('shared-key', null);
      const result2 = storage2.readJSON('shared-key', null);
      
      assert.deepStrictEqual(result1, { instance: 1 });
      assert.deepStrictEqual(result2, { instance: 2 });
    });
  });

  describe('complex data types', () => {
    it('should handle deeply nested objects', () => {
      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep'
              }
            }
          }
        }
      };
      
      storage.writeJSON('deep', deepObject);
      const result = storage.readJSON('deep', null);
      
      assert.deepStrictEqual(result, deepObject);
    });

    it('should handle special characters in data', () => {
      const specialData = {
        emoji: '🔐💰',
        unicode: 'café résumé',
        quotes: '"single\' and "double"',
        newlines: 'line1\nline2\r\nline3'
      };
      
      storage.writeJSON('special', specialData);
      const result = storage.readJSON('special', null);
      
      assert.deepStrictEqual(result, specialData);
    });

    it('should handle large data', () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        data: `item-${i}`,
        nested: { value: i * 2 }
      }));
      
      storage.writeJSON('large', largeArray);
      const result = storage.readJSON('large', null);
      
      assert.strictEqual(result.length, 1000);
      assert.deepStrictEqual(result[0], { id: 0, data: 'item-0', nested: { value: 0 } });
      assert.deepStrictEqual(result[999], { id: 999, data: 'item-999', nested: { value: 1998 } });
    });
  });

  describe('wallet-like usage patterns', () => {
    it('should handle wallets.json structure', () => {
      const walletsData = {
        'my-wallet': {
          encryptedMnemonic: 'encrypted-data-here',
          salt: 'random-salt',
          iv: 'random-iv',
          authTag: 'auth-tag',
          createdAt: new Date().toISOString(),
          accounts: {
            0: { address: '0x1234', createdAt: new Date().toISOString() }
          },
          currentAccountIndex: 0
        }
      };

      storage.writeJSON('wallets.json', walletsData);
      const result = storage.readJSON('wallets.json', {});

      assert.deepStrictEqual(result, walletsData);
      assert.ok(result['my-wallet'].encryptedMnemonic);
    });

    it('should handle config.json structure', () => {
      const configData = {
        network: 'mainnet',
        networks: {
          mainnet: { chainId: 1, rpcUrl: 'https://eth.example.com' },
          base: { chainId: 8453, rpcUrl: 'https://base.example.com' }
        }
      };

      storage.writeJSON('config.json', configData);
      const result = storage.readJSON('config.json', {});

      assert.deepStrictEqual(result, configData);
    });
  });
});

describe('FileStorage', () => {
  /** @type {string} */
  let tempDir;
  /** @type {FileStorage} */
  let storage;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
    storage = new FileStorage();
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('writeJSON / readJSON', () => {
    it('should write and read JSON data correctly', () => {
      const testPath = path.join(tempDir, 'test.json');
      const testData = { name: 'test', value: 123 };
      
      storage.writeJSON(testPath, testData);
      const result = storage.readJSON(testPath, null);
      
      assert.deepStrictEqual(result, testData);
    });

    it('should create actual files on disk', async () => {
      const testPath = path.join(tempDir, 'file.json');
      storage.writeJSON(testPath, { data: 'value' });
      
      const stat = await fs.stat(testPath);
      assert.strictEqual(stat.isFile(), true);
    });

    it('should write valid JSON to files', async () => {
      const testPath = path.join(tempDir, 'valid.json');
      const testData = { key: 'value' };
      storage.writeJSON(testPath, testData);
      
      const content = await fs.readFile(testPath, 'utf-8');
      const parsed = JSON.parse(content);
      
      assert.deepStrictEqual(parsed, testData);
    });

    it('should return fallback for non-existent files', () => {
      const testPath = path.join(tempDir, 'non-existent.json');
      const result = storage.readJSON(testPath, { default: true });
      
      assert.deepStrictEqual(result, { default: true });
    });

    it('should overwrite existing files', () => {
      const testPath = path.join(tempDir, 'overwrite.json');
      storage.writeJSON(testPath, { version: 1 });
      storage.writeJSON(testPath, { version: 2 });
      
      const result = storage.readJSON(testPath, null);
      
      assert.deepStrictEqual(result, { version: 2 });
    });
  });

  describe('exists', () => {
    it('should return false for non-existent files', () => {
      const testPath = path.join(tempDir, 'non-existent.json');
      const result = storage.exists(testPath);
      
      assert.strictEqual(result, false);
    });

    it('should return true for existing files', () => {
      const testPath = path.join(tempDir, 'exists.json');
      storage.writeJSON(testPath, { data: 'value' });
      
      const result = storage.exists(testPath);
      
      assert.strictEqual(result, true);
    });
  });

  describe('readFile / writeFile', () => {
    it('should write and read raw file content', () => {
      const testPath = path.join(tempDir, 'raw.txt');
      storage.writeFile(testPath, 'Hello, World!');
      const result = storage.readFile(testPath);
      
      assert.strictEqual(result, 'Hello, World!');
    });

    it('should return null for non-existent files', () => {
      const testPath = path.join(tempDir, 'non-existent.txt');
      const result = storage.readFile(testPath);
      
      assert.strictEqual(result, null);
    });
  });

  describe('complex data', () => {
    it('should handle wallet-like data structures', () => {
      const testPath = path.join(tempDir, 'wallets.json');
      const walletData = {
        wallets: [
          {
            address: '0x1234567890abcdef1234567890abcdef12345678',
            encryptedMnemonic: 'encrypted-data-here',
            accounts: [
              { index: 0, name: 'Account 1' },
              { index: 1, name: 'Account 2' }
            ]
          }
        ],
        activeWalletIndex: 0
      };
      
      storage.writeJSON(testPath, walletData);
      const result = storage.readJSON(testPath, null);
      
      assert.deepStrictEqual(result, walletData);
    });

    it('should handle token-like data structures', () => {
      const testPath = path.join(tempDir, 'tokens.json');
      const tokenData = {
        tokens: [
          {
            address: '0xtoken1',
            symbol: 'TKN',
            decimals: 18,
            name: 'Test Token'
          }
        ],
        networks: {
          '1': { name: 'Ethereum', rpcUrl: 'https://eth.example.com' }
        }
      };
      
      storage.writeJSON(testPath, tokenData);
      const result = storage.readJSON(testPath, null);
      
      assert.deepStrictEqual(result, tokenData);
    });
  });

  describe('error handling', () => {
    it('should return fallback for invalid JSON in files', async () => {
      const testPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(testPath, 'not valid json {{{', 'utf-8');
      
      // FileStorage.readJSON returns fallback for invalid JSON
      const result = storage.readJSON(testPath, { fallback: true });
      assert.deepStrictEqual(result, { fallback: true });
    });
  });
});

describe('StorageAdapter Interface Compliance', () => {
  describe('MemoryStorage interface', () => {
    let storage;

    beforeEach(() => {
      storage = new MemoryStorage();
    });

    it('should implement readJSON method', () => {
      assert.strictEqual(typeof storage.readJSON, 'function');
    });

    it('should implement writeJSON method', () => {
      assert.strictEqual(typeof storage.writeJSON, 'function');
    });

    it('should implement exists method', () => {
      assert.strictEqual(typeof storage.exists, 'function');
    });

    it('should implement readFile method', () => {
      assert.strictEqual(typeof storage.readFile, 'function');
    });

    it('should implement writeFile method', () => {
      assert.strictEqual(typeof storage.writeFile, 'function');
    });

    it('readJSON should be synchronous', () => {
      storage.writeJSON('key', { value: 1 });
      const result = storage.readJSON('key', null);
      // Synchronous methods return directly, not a Promise
      assert.deepStrictEqual(result, { value: 1 });
    });

    it('exists should be synchronous', () => {
      storage.writeJSON('key', { value: 1 });
      const result = storage.exists('key');
      assert.strictEqual(result, true);
    });
  });

  describe('FileStorage interface', () => {
    let storage;

    beforeEach(() => {
      storage = new FileStorage();
    });

    it('should implement readJSON method', () => {
      assert.strictEqual(typeof storage.readJSON, 'function');
    });

    it('should implement writeJSON method', () => {
      assert.strictEqual(typeof storage.writeJSON, 'function');
    });

    it('should implement exists method', () => {
      assert.strictEqual(typeof storage.exists, 'function');
    });

    it('should implement readFile method', () => {
      assert.strictEqual(typeof storage.readFile, 'function');
    });

    it('should implement writeFile method', () => {
      assert.strictEqual(typeof storage.writeFile, 'function');
    });
  });
});
