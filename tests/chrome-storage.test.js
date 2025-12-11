import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChromeStorageAdapter } from '../dist/chrome-storage.js';

// ============================================================================
// Chrome Storage API Mock
// ============================================================================

/**
 * Mock implementation of chrome.storage.local API for testing
 */
class ChromeStorageMock {
  constructor() {
    this.data = {};
  }

  /**
   * Get items from storage
   * @param {null|string|string[]} keys - Keys to retrieve (null = all)
   * @returns {Promise<Object>} Storage data
   */
  async get(keys) {
    if (keys === null) {
      return { ...this.data };
    }

    if (typeof keys === 'string') {
      return this.data[keys] !== undefined ? { [keys]: this.data[keys] } : {};
    }

    if (Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        if (this.data[key] !== undefined) {
          result[key] = this.data[key];
        }
      }
      return result;
    }

    return {};
  }

  /**
   * Set items in storage
   * @param {Object} items - Key-value pairs to store
   * @returns {Promise<void>}
   */
  async set(items) {
    Object.assign(this.data, items);
  }

  /**
   * Remove items from storage
   * @param {string|string[]} keys - Keys to remove
   * @returns {Promise<void>}
   */
  async remove(keys) {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keysArray) {
      delete this.data[key];
    }
  }

  /**
   * Clear all items from storage
   * @returns {Promise<void>}
   */
  async clear() {
    this.data = {};
  }

  /**
   * Get the raw data (for testing)
   */
  getRawData() {
    return this.data;
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Set up chrome.storage.local mock
 */
function setupChromeMock() {
  const mock = new ChromeStorageMock();
  global.chrome = {
    storage: {
      local: mock
    }
  };
  return mock;
}

/**
 * Tear down chrome mock
 */
function teardownChromeMock() {
  delete global.chrome;
}

/**
 * Helper to wait for async operations
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Initialization Tests
// ============================================================================

test('ChromeStorageAdapter.create() initializes and returns instance', async () => {
  const chromeMock = setupChromeMock();

  try {
    // Pre-populate chrome.storage with some data
    await chromeMock.set({
      'wallet_config.json': JSON.stringify({ network: 'mainnet' }),
      'wallet_wallets.json': JSON.stringify({ wallet1: { address: '0x123' } })
    });

    const adapter = await ChromeStorageAdapter.create();

    assert.ok(adapter instanceof ChromeStorageAdapter);

    // Verify cache was hydrated
    const config = adapter.readJSON('config.json', null);
    const wallets = adapter.readJSON('wallets.json', null);

    assert.deepEqual(config, { network: 'mainnet' });
    assert.deepEqual(wallets, { wallet1: { address: '0x123' } });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.initialize() hydrates cache from chrome.storage', async () => {
  const chromeMock = setupChromeMock();

  try {
    // Pre-populate chrome.storage
    await chromeMock.set({
      'wallet_data1.json': JSON.stringify({ value: 'test1' }),
      'wallet_data2.json': JSON.stringify({ value: 'test2' })
    });

    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Verify data is in cache
    const data1 = adapter.readJSON('data1.json', null);
    const data2 = adapter.readJSON('data2.json', null);

    assert.deepEqual(data1, { value: 'test1' });
    assert.deepEqual(data2, { value: 'test2' });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.initialize() handles non-JSON data', async () => {
  const chromeMock = setupChromeMock();

  try {
    // Store raw string data
    await chromeMock.set({
      'wallet_text.txt': 'plain text content'
    });

    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Should store as-is when JSON parsing fails
    const text = adapter.readFile('text.txt');
    assert.equal(text, 'plain text content');
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.initialize() handles empty storage', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Should not throw, cache should be empty
    const data = adapter.readJSON('nonexistent.json', { default: true });
    assert.deepEqual(data, { default: true });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.initialize() handles errors gracefully', async () => {
  setupChromeMock();

  try {
    // Make chrome.storage.local.get throw an error
    global.chrome.storage.local.get = async () => {
      throw new Error('Storage error');
    };

    const adapter = new ChromeStorageAdapter();

    // Should not throw, just log error
    await adapter.initialize();

    // Cache should be empty
    assert.ok(!adapter.exists('anything.json'));
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// readJSON / writeJSON Tests
// ============================================================================

test('ChromeStorageAdapter.writeJSON() updates cache immediately', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const testData = { name: 'test', value: 123 };
    adapter.writeJSON('test.json', testData);

    // Should be immediately available from cache
    const result = adapter.readJSON('test.json', null);
    assert.deepEqual(result, testData);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.writeJSON() persists to chrome.storage asynchronously', async () => {
  const chromeMock = setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const testData = { name: 'test', value: 456 };
    adapter.writeJSON('persist.json', testData);

    // Wait for async persistence
    await sleep(50);

    // Verify it was written to chrome.storage
    const rawData = chromeMock.getRawData();
    assert.ok(rawData['wallet_persist.json']);
    assert.deepEqual(JSON.parse(rawData['wallet_persist.json']), testData);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.readJSON() returns fallback for non-existent keys', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const result = adapter.readJSON('nonexistent.json', { default: 'value' });
    assert.deepEqual(result, { default: 'value' });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.readJSON() reads from cache without chrome.storage call', async () => {
  const chromeMock = setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Write to cache
    adapter.writeJSON('cached.json', { cached: true });
    await sleep(50);

    // Clear chrome.storage to verify it reads from cache
    await chromeMock.clear();

    const result = adapter.readJSON('cached.json', null);
    assert.deepEqual(result, { cached: true });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.writeJSON() overwrites existing data', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('data.json', { version: 1 });
    adapter.writeJSON('data.json', { version: 2 });

    const result = adapter.readJSON('data.json', null);
    assert.deepEqual(result, { version: 2 });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.writeJSON() handles complex data structures', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const complexData = {
      nested: {
        deep: {
          array: [1, 2, 3],
          object: { key: 'value' }
        }
      },
      nullValue: null,
      emptyArray: [],
      emptyObject: {}
    };

    adapter.writeJSON('complex.json', complexData);

    const result = adapter.readJSON('complex.json', null);
    assert.deepEqual(result, complexData);
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// exists() Tests
// ============================================================================

test('ChromeStorageAdapter.exists() returns true for cached keys', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('exists.json', { data: 'test' });

    assert.equal(adapter.exists('exists.json'), true);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.exists() returns false for non-existent keys', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    assert.equal(adapter.exists('nonexistent.json'), false);
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// readFile / writeFile Tests
// ============================================================================

test('ChromeStorageAdapter.writeFile() stores raw string data', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const content = 'Hello, World!';
    adapter.writeFile('test.txt', content);

    const result = adapter.readFile('test.txt');
    assert.equal(result, content);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.writeFile() persists to chrome.storage', async () => {
  const chromeMock = setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const content = 'Persistent text';
    adapter.writeFile('persist.txt', content);

    // Wait for async persistence
    await sleep(50);

    const rawData = chromeMock.getRawData();
    assert.equal(rawData['wallet_persist.txt'], content);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.readFile() returns null for non-existent files', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const result = adapter.readFile('nonexistent.txt');
    assert.equal(result, null);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.readFile() returns null for empty strings', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    adapter.writeFile('empty.txt', '');

    // Note: Current implementation returns null for empty strings (falsy check)
    const result = adapter.readFile('empty.txt');
    assert.equal(result, null);
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// clear() Tests
// ============================================================================

test('ChromeStorageAdapter.clear() removes all cached data', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('data1.json', { test: 1 });
    adapter.writeJSON('data2.json', { test: 2 });

    await adapter.clear();

    assert.equal(adapter.exists('data1.json'), false);
    assert.equal(adapter.exists('data2.json'), false);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.clear() removes all data from chrome.storage', async () => {
  const chromeMock = setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('data.json', { test: 'value' });
    await sleep(50);

    await adapter.clear();

    const rawData = chromeMock.getRawData();
    assert.deepEqual(rawData, {});
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// Path/Key Conversion Tests
// ============================================================================

test('ChromeStorageAdapter converts file paths to storage keys correctly', async () => {
  const chromeMock = setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Write with various path formats
    adapter.writeJSON('simple.json', { value: 1 });
    adapter.writeJSON('nested/path/file.json', { value: 2 });
    adapter.writeJSON('with\\backslash.json', { value: 3 });

    await sleep(50);

    const rawData = chromeMock.getRawData();

    // Verify keys are properly prefixed and paths converted
    assert.ok(rawData['wallet_simple.json']);
    assert.ok(rawData['wallet_nested_path_file.json']);
    assert.ok(rawData['wallet_with_backslash.json']);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter converts storage keys back to paths on initialize', async () => {
  const chromeMock = setupChromeMock();

  try {
    // Pre-populate with storage keys
    await chromeMock.set({
      'wallet_simple.json': JSON.stringify({ value: 1 }),
      'wallet_nested_path_file.json': JSON.stringify({ value: 2 })
    });

    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Should be able to read using file paths
    const simple = adapter.readJSON('simple.json', null);
    const nested = adapter.readJSON('nested/path/file.json', null);

    assert.deepEqual(simple, { value: 1 });
    assert.deepEqual(nested, { value: 2 });
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('ChromeStorageAdapter.writeJSON() handles chrome.storage errors gracefully', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Make chrome.storage.local.set throw an error
    global.chrome.storage.local.set = async () => {
      throw new Error('Storage quota exceeded');
    };

    // Should not throw, just log error
    adapter.writeJSON('test.json', { data: 'value' });

    // Data should still be in cache
    const result = adapter.readJSON('test.json', null);
    assert.deepEqual(result, { data: 'value' });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter.writeFile() handles chrome.storage errors gracefully', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Make chrome.storage.local.set throw an error
    global.chrome.storage.local.set = async () => {
      throw new Error('Storage error');
    };

    // Should not throw
    adapter.writeFile('test.txt', 'content');

    // Data should still be in cache
    const result = adapter.readFile('test.txt');
    assert.equal(result, 'content');
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// Wallet-like Usage Pattern Tests
// ============================================================================

test('ChromeStorageAdapter handles wallet data structures', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const walletData = {
      'my-wallet': {
        encryptedMnemonic: 'encrypted-data',
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

    adapter.writeJSON('wallets.json', walletData);
    await sleep(50);

    const result = adapter.readJSON('wallets.json', {});
    assert.deepEqual(result, walletData);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter handles config data structures', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const configData = {
      network: 'mainnet',
      networks: {
        mainnet: { chainId: 1, rpcUrl: 'https://eth.example.com' },
        base: { chainId: 8453, rpcUrl: 'https://base.example.com' }
      }
    };

    adapter.writeJSON('config.json', configData);

    const result = adapter.readJSON('config.json', {});
    assert.deepEqual(result, configData);
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter handles token registry data', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    const tokenData = {
      mainnet: [
        { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, type: 'erc20' },
        { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, type: 'erc20' }
      ]
    };

    adapter.writeJSON('tokens-user.json', tokenData);

    const result = adapter.readJSON('tokens-user.json', {});
    assert.deepEqual(result, tokenData);
  } finally {
    teardownChromeMock();
  }
});

// ============================================================================
// Concurrent Operations Tests
// ============================================================================

test('ChromeStorageAdapter handles multiple writes without corruption', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Write multiple keys rapidly
    adapter.writeJSON('key1.json', { value: 1 });
    adapter.writeJSON('key2.json', { value: 2 });
    adapter.writeJSON('key3.json', { value: 3 });

    await sleep(100);

    // All should be persisted correctly
    const result1 = adapter.readJSON('key1.json', null);
    const result2 = adapter.readJSON('key2.json', null);
    const result3 = adapter.readJSON('key3.json', null);

    assert.deepEqual(result1, { value: 1 });
    assert.deepEqual(result2, { value: 2 });
    assert.deepEqual(result3, { value: 3 });
  } finally {
    teardownChromeMock();
  }
});

test('ChromeStorageAdapter handles updates to same key', async () => {
  setupChromeMock();

  try {
    const adapter = new ChromeStorageAdapter();
    await adapter.initialize();

    // Rapidly update the same key
    adapter.writeJSON('key.json', { version: 1 });
    adapter.writeJSON('key.json', { version: 2 });
    adapter.writeJSON('key.json', { version: 3 });

    await sleep(100);

    // Should have the latest version
    const result = adapter.readJSON('key.json', null);
    assert.deepEqual(result, { version: 3 });
  } finally {
    teardownChromeMock();
  }
});
