import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getNativeTokenPrice,
  getERC20TokenPrice,
  getTokenPrices,
  calculateTotalValue,
  formatUSDValue,
  clearPriceCache
} from '../dist/price-service.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock fetch implementation for testing
 */
class FetchMock {
  constructor() {
    this.calls = [];
    this.responses = new Map();
    this.defaultResponse = { ok: true, status: 200, json: async () => ({}) };
  }

  /**
   * Set up a response for a specific URL
   */
  mockResponse(urlPattern, response) {
    this.responses.set(urlPattern, response);
  }

  /**
   * Mock fetch function
   */
  async fetch(url, options = {}) {
    this.calls.push({ url, options });

    // Check for abort signal timeout
    if (options.signal?.aborted) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }

    // Find matching response
    for (const [pattern, response] of this.responses) {
      if (url.includes(pattern)) {
        if (response instanceof Error) {
          throw response;
        }
        return response;
      }
    }

    return this.defaultResponse;
  }

  /**
   * Get the number of times fetch was called
   */
  getCallCount() {
    return this.calls.length;
  }

  /**
   * Get calls matching a URL pattern
   */
  getCallsMatching(urlPattern) {
    return this.calls.filter(call => call.url.includes(urlPattern));
  }

  /**
   * Reset all calls
   */
  reset() {
    this.calls = [];
    this.responses.clear();
  }
}

let originalFetch;
let fetchMock;

/**
 * Setup fetch mock before tests
 */
function setupFetchMock() {
  fetchMock = new FetchMock();
  originalFetch = global.fetch;
  global.fetch = fetchMock.fetch.bind(fetchMock);
}

/**
 * Restore original fetch after tests
 */
function teardownFetchMock() {
  if (originalFetch) {
    global.fetch = originalFetch;
  }
  clearPriceCache();
}

// ============================================================================
// Native Token Price Tests
// ============================================================================

test('getNativeTokenPrice fetches and caches ETH price', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        ethereum: { usd: 2500.50 }
      })
    });

    const price = await getNativeTokenPrice(1); // mainnet
    assert.equal(price, 2500.50);
    assert.equal(fetchMock.getCallCount(), 1);
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice uses cache on second call', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        ethereum: { usd: 2500.50 }
      })
    });

    const price1 = await getNativeTokenPrice(1);
    const price2 = await getNativeTokenPrice(1);

    assert.equal(price1, 2500.50);
    assert.equal(price2, 2500.50);
    assert.equal(fetchMock.getCallCount(), 1, 'should only call API once');
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice handles API error response', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' })
    });

    const price = await getNativeTokenPrice(1);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice handles network error', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const networkError = new Error('Network request failed');
    fetchMock.mockResponse('simple/price?ids=ethereum', networkError);

    const price = await getNativeTokenPrice(1);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice returns null for missing price data', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        ethereum: {} // no usd field
      })
    });

    const price = await getNativeTokenPrice(1);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice returns null for unsupported chain', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const price = await getNativeTokenPrice(999999); // unknown chain
    assert.equal(price, null);
    assert.equal(fetchMock.getCallCount(), 0, 'should not call API for unknown chain');
  } finally {
    teardownFetchMock();
  }
});

test('getNativeTokenPrice fetches different prices for different chains', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({ ethereum: { usd: 2500 } })
    });

    fetchMock.mockResponse('simple/price?ids=matic-network', {
      ok: true,
      status: 200,
      json: async () => ({ 'matic-network': { usd: 0.85 } })
    });

    const ethPrice = await getNativeTokenPrice(1); // Ethereum
    const maticPrice = await getNativeTokenPrice(137); // Polygon

    assert.equal(ethPrice, 2500);
    assert.equal(maticPrice, 0.85);
  } finally {
    teardownFetchMock();
  }
});

// ============================================================================
// ERC-20 Token Price Tests
// ============================================================================

test('getERC20TokenPrice fetches and caches USDC price', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [usdcAddress.toLowerCase()]: { usd: 1.00 }
      })
    });

    const price = await getERC20TokenPrice(1, usdcAddress);
    assert.equal(price, 1.00);
    assert.equal(fetchMock.getCallCount(), 1);
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice uses cache on second call', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [tokenAddress.toLowerCase()]: { usd: 1.00 }
      })
    });

    const price1 = await getERC20TokenPrice(1, tokenAddress);
    const price2 = await getERC20TokenPrice(1, tokenAddress);

    assert.equal(price1, 1.00);
    assert.equal(price2, 1.00);
    assert.equal(fetchMock.getCallCount(), 1, 'should only call API once');
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice handles 429 rate limit silently', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limit exceeded' })
    });

    const price = await getERC20TokenPrice(1, tokenAddress);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice handles token not found', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xdeadbeef00000000000000000000000000000000';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({}) // empty response - token not found
    });

    const price = await getERC20TokenPrice(1, tokenAddress);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice handles API error_code in response', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        error_code: 10001
      })
    });

    const price = await getERC20TokenPrice(1, tokenAddress);
    assert.equal(price, null);
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice returns null for unsupported chain', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const price = await getERC20TokenPrice(999999, tokenAddress); // unknown chain

    assert.equal(price, null);
    assert.equal(fetchMock.getCallCount(), 0, 'should not call API for unknown chain');
  } finally {
    teardownFetchMock();
  }
});

test('getERC20TokenPrice normalizes address to lowercase', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const mixedCaseAddress = '0xA0B86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const lowerCaseAddress = mixedCaseAddress.toLowerCase();

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [lowerCaseAddress]: { usd: 1.00 }
      })
    });

    const price = await getERC20TokenPrice(1, mixedCaseAddress);
    assert.equal(price, 1.00);

    // Verify the URL contains lowercase address
    const calls = fetchMock.getCallsMatching('simple/token_price/ethereum');
    assert.ok(calls[0].url.includes(lowerCaseAddress));
  } finally {
    teardownFetchMock();
  }
});

// ============================================================================
// Cache Behavior Tests
// ============================================================================

test('clearPriceCache clears all cached prices', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({ ethereum: { usd: 2500 } })
    });

    // First call - fetches from API
    await getNativeTokenPrice(1);
    assert.equal(fetchMock.getCallCount(), 1);

    // Second call - uses cache
    await getNativeTokenPrice(1);
    assert.equal(fetchMock.getCallCount(), 1);

    // Clear cache
    clearPriceCache();

    // Third call - fetches from API again
    await getNativeTokenPrice(1);
    assert.equal(fetchMock.getCallCount(), 2);
  } finally {
    teardownFetchMock();
  }
});

test('cache isolates prices by chainId', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    // Mock responses for different chains
    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [tokenAddress.toLowerCase()]: { usd: 1.00 }
      })
    });

    fetchMock.mockResponse('simple/token_price/polygon-pos', {
      ok: true,
      status: 200,
      json: async () => ({
        [tokenAddress.toLowerCase()]: { usd: 1.01 }
      })
    });

    const ethPrice = await getERC20TokenPrice(1, tokenAddress); // Ethereum
    const polygonPrice = await getERC20TokenPrice(137, tokenAddress); // Polygon

    assert.equal(ethPrice, 1.00);
    assert.equal(polygonPrice, 1.01);
    assert.equal(fetchMock.getCallCount(), 2, 'should fetch separately for each chain');
  } finally {
    teardownFetchMock();
  }
});

// ============================================================================
// getTokenPrices Bulk Fetching Tests
// ============================================================================

test('getTokenPrices fetches native and ERC-20 prices', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({ ethereum: { usd: 2500 } })
    });

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [usdcAddress.toLowerCase()]: { usd: 1.00 }
      })
    });

    const tokens = [
      { type: 'native', symbol: 'ETH' },
      { type: 'erc20', symbol: 'USDC', address: usdcAddress, decimals: 6 }
    ];

    const prices = await getTokenPrices(1, tokens);

    assert.equal(prices.get('native'), 2500);
    assert.equal(prices.get(usdcAddress.toLowerCase()), 1.00);
  } finally {
    teardownFetchMock();
  }
});

test('getTokenPrices handles mixed success and failure', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const unknownAddress = '0xdeadbeef00000000000000000000000000000000';

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({ ethereum: { usd: 2500 } })
    });

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [usdcAddress.toLowerCase()]: { usd: 1.00 }
        // unknownAddress not in response
      })
    });

    const tokens = [
      { type: 'native', symbol: 'ETH' },
      { type: 'erc20', symbol: 'USDC', address: usdcAddress, decimals: 6 },
      { type: 'erc20', symbol: 'UNKNOWN', address: unknownAddress, decimals: 18 }
    ];

    const prices = await getTokenPrices(1, tokens);

    assert.equal(prices.get('native'), 2500);
    assert.equal(prices.get(usdcAddress.toLowerCase()), 1.00);
    assert.equal(prices.get(unknownAddress.toLowerCase()), null);
  } finally {
    teardownFetchMock();
  }
});

test('getTokenPrices handles only native token', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    fetchMock.mockResponse('simple/price?ids=ethereum', {
      ok: true,
      status: 200,
      json: async () => ({ ethereum: { usd: 2500 } })
    });

    const tokens = [
      { type: 'native', symbol: 'ETH' }
    ];

    const prices = await getTokenPrices(1, tokens);

    assert.equal(prices.get('native'), 2500);
    assert.equal(prices.size, 1);
  } finally {
    teardownFetchMock();
  }
});

test('getTokenPrices handles only ERC-20 tokens', async () => {
  setupFetchMock();
  try {
    clearPriceCache();

    const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    fetchMock.mockResponse('simple/token_price/ethereum', {
      ok: true,
      status: 200,
      json: async () => ({
        [usdcAddress.toLowerCase()]: { usd: 1.00 }
      })
    });

    const tokens = [
      { type: 'erc20', symbol: 'USDC', address: usdcAddress, decimals: 6 }
    ];

    const prices = await getTokenPrices(1, tokens);

    assert.equal(prices.get(usdcAddress.toLowerCase()), 1.00);
    assert.ok(!prices.has('native'), 'should not have native price');
  } finally {
    teardownFetchMock();
  }
});

// ============================================================================
// Portfolio Calculation Tests
// ============================================================================

test('calculateTotalValue computes correct total', () => {
  const balances = [
    { token: { type: 'native', symbol: 'ETH' }, balance: '2.5' },
    { token: { type: 'erc20', symbol: 'USDC', address: '0xabc', decimals: 6 }, balance: '1000' }
  ];

  const prices = new Map([
    ['native', 2500],
    ['0xabc', 1.00]
  ]);

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 7250); // 2.5 * 2500 + 1000 * 1.00
});

test('calculateTotalValue handles missing prices', () => {
  const balances = [
    { token: { type: 'native', symbol: 'ETH' }, balance: '2.5' },
    { token: { type: 'erc20', symbol: 'UNKNOWN', address: '0xdef', decimals: 18 }, balance: '100' }
  ];

  const prices = new Map([
    ['native', 2500]
    // 0xdef price is missing
  ]);

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 6250); // only ETH counted
});

test('calculateTotalValue handles invalid balance strings', () => {
  const balances = [
    { token: { type: 'native', symbol: 'ETH' }, balance: '2.5' },
    { token: { type: 'erc20', symbol: 'USDC', address: '0xabc', decimals: 6 }, balance: 'invalid' }
  ];

  const prices = new Map([
    ['native', 2500],
    ['0xabc', 1.00]
  ]);

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 6250); // only ETH counted
});

test('calculateTotalValue handles zero balances', () => {
  const balances = [
    { token: { type: 'native', symbol: 'ETH' }, balance: '0' },
    { token: { type: 'erc20', symbol: 'USDC', address: '0xabc', decimals: 6 }, balance: '0' }
  ];

  const prices = new Map([
    ['native', 2500],
    ['0xabc', 1.00]
  ]);

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 0);
});

test('calculateTotalValue handles empty balances array', () => {
  const balances = [];
  const prices = new Map();

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 0);
});

test('calculateTotalValue handles token without address', () => {
  const balances = [
    { token: { type: 'native', symbol: 'ETH' }, balance: '2.5' },
    { token: { type: 'erc20', symbol: 'BADTOKEN', decimals: 18 }, balance: '100' } // no address
  ];

  const prices = new Map([
    ['native', 2500]
  ]);

  const total = calculateTotalValue(balances, prices);
  assert.equal(total, 6250); // only ETH counted
});

// ============================================================================
// USD Formatting Tests
// ============================================================================

test('formatUSDValue formats zero correctly', () => {
  assert.equal(formatUSDValue(0), '$0.00');
});

test('formatUSDValue formats very small values', () => {
  assert.equal(formatUSDValue(0.001), '<$0.01');
  assert.equal(formatUSDValue(0.009), '<$0.01');
});

test('formatUSDValue formats cents correctly', () => {
  assert.equal(formatUSDValue(0.01), '$0.01');
  assert.equal(formatUSDValue(0.99), '$0.99');
});

test('formatUSDValue formats dollars correctly', () => {
  assert.equal(formatUSDValue(1), '$1.00');
  assert.equal(formatUSDValue(10), '$10.00');
  assert.equal(formatUSDValue(99.99), '$99.99');
});

test('formatUSDValue formats hundreds correctly', () => {
  assert.equal(formatUSDValue(100), '$100.00');
  assert.equal(formatUSDValue(999.99), '$999.99');
});

test('formatUSDValue formats thousands with commas', () => {
  assert.equal(formatUSDValue(1000), '$1,000.00');
  assert.equal(formatUSDValue(10000), '$10,000.00');
  assert.equal(formatUSDValue(100000), '$100,000.00');
  assert.equal(formatUSDValue(999999), '$999,999.00');
});

test('formatUSDValue formats millions with M suffix', () => {
  assert.equal(formatUSDValue(1000000), '$1.00M');
  assert.equal(formatUSDValue(1500000), '$1.50M');
  assert.equal(formatUSDValue(10000000), '$10.00M');
  assert.equal(formatUSDValue(123456789), '$123.46M');
});

test('formatUSDValue handles decimal precision', () => {
  assert.equal(formatUSDValue(123.456), '$123.46'); // rounds to 2 decimals
  assert.equal(formatUSDValue(123.454), '$123.45'); // rounds down
  assert.equal(formatUSDValue(123.457), '$123.46'); // rounds up
});
