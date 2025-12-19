/**
 * @fileoverview Unit tests for price providers and provider manager.
 *
 * Tests the provider abstraction layer including:
 * - CoinPaprika provider
 * - CoinGecko provider
 * - Provider manager fallback logic
 * - Caching behavior
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock fetch function for testing.
 */
function createMockFetch(responses) {
  let callIndex = 0;
  return async (url, options) => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.data,
    };
  };
}

// ============================================================================
// CoinPaprika Provider Tests
// ============================================================================

describe('CoinPaprikaProvider', () => {
  let originalFetch;
  
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  
  it('should return price for supported token', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        data: {
          id: 'eth-ethereum',
          quotes: {
            USD: {
              price: 3500.00,
              percent_change_24h: 2.5,
            },
          },
        },
      },
    ]);
    
    // Dynamic import after mocking fetch
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const provider = new CoinPaprikaProvider();
    
    assert.strictEqual(provider.supportsToken('ETH'), true);
    
    const result = await provider.getCurrentPrice('ETH');
    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(result.change24h, 2.5);
  });
  
  it('should return false for unsupported token', async () => {
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const provider = new CoinPaprikaProvider();
    
    assert.strictEqual(provider.supportsToken('UNKNOWNTOKEN123'), false);
  });
  
  it('should throw error when API fails', async () => {
    globalThis.fetch = createMockFetch([
      { ok: false, status: 429 },
    ]);
    
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const provider = new CoinPaprikaProvider();
    
    await assert.rejects(
      async () => provider.getCurrentPrice('ETH'),
      /CoinPaprika API error: 429/
    );
  });
  
  it('should fetch price history', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        data: [
          { timestamp: '2024-12-17T00:00:00Z', price: 3400.00 },
          { timestamp: '2024-12-17T01:00:00Z', price: 3450.00 },
          { timestamp: '2024-12-17T02:00:00Z', price: 3500.00 },
        ],
      },
    ]);
    
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const provider = new CoinPaprikaProvider();
    
    const result = await provider.getPriceHistory('ETH', '1D');
    
    assert.strictEqual(result.data.length, 3);
    assert.strictEqual(result.priceChange.value, 100); // 3500 - 3400
    assert.ok(result.priceChange.percent > 0);
  });
});

// ============================================================================
// CoinGecko Provider Tests
// ============================================================================

describe('CoinGeckoProvider', () => {
  let originalFetch;
  
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  
  it('should return price for supported token', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        data: {
          ethereum: {
            usd: 3500.00,
            usd_24h_change: 2.5,
          },
        },
      },
    ]);
    
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    const provider = new CoinGeckoProvider();
    
    assert.strictEqual(provider.supportsToken('ETH'), true);
    
    const result = await provider.getCurrentPrice('ETH');
    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(result.change24h, 2.5);
  });
  
  it('should support contract price lookup', async () => {
    const contractAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC
    
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        data: {
          [contractAddress]: {
            usd: 1.00,
            usd_24h_change: 0.01,
          },
        },
      },
    ]);
    
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    const provider = new CoinGeckoProvider();
    
    const result = await provider.getTokenPriceByContract(1, contractAddress);
    assert.strictEqual(result.price, 1.00);
  });
  
  it('should fetch price history', async () => {
    globalThis.fetch = createMockFetch([
      {
        ok: true,
        data: {
          prices: [
            [1702771200000, 3400.00],
            [1702774800000, 3450.00],
            [1702778400000, 3500.00],
          ],
        },
      },
    ]);
    
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    const provider = new CoinGeckoProvider();
    
    const result = await provider.getPriceHistory('ETH', '1D');
    
    assert.strictEqual(result.data.length, 3);
    assert.strictEqual(result.data[0].price, 3400.00);
    assert.strictEqual(result.priceChange.value, 100);
  });
});

// ============================================================================
// Provider Manager Tests
// ============================================================================

describe('PriceProviderManager', () => {
  let originalFetch;
  
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  
  it('should use primary provider when available', async () => {
    let coinpaprikaCalled = false;
    let coingeckoCalled = false;
    
    globalThis.fetch = async (url) => {
      if (url.includes('coinpaprika')) {
        coinpaprikaCalled = true;
        return {
          ok: true,
          json: async () => ({
            quotes: { USD: { price: 3500.00, percent_change_24h: 2.5 } },
          }),
        };
      }
      if (url.includes('coingecko')) {
        coingeckoCalled = true;
        return {
          ok: true,
          json: async () => ({ ethereum: { usd: 3500.00 } }),
        };
      }
    };
    
    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    
    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinPaprikaProvider());
    manager.registerProvider(new CoinGeckoProvider());
    
    const result = await manager.getCurrentPrice('ETH');
    
    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(coinpaprikaCalled, true);
    assert.strictEqual(coingeckoCalled, false); // Should not call fallback
  });
  
  it('should fall back to secondary provider on primary failure', async () => {
    let coinpaprikaCalled = false;
    let coingeckoCalled = false;
    
    globalThis.fetch = async (url) => {
      if (url.includes('coinpaprika')) {
        coinpaprikaCalled = true;
        return { ok: false, status: 429 }; // Rate limited
      }
      if (url.includes('coingecko')) {
        coingeckoCalled = true;
        return {
          ok: true,
          json: async () => ({
            ethereum: { usd: 3500.00, usd_24h_change: 2.5 },
          }),
        };
      }
    };
    
    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    
    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinPaprikaProvider());
    manager.registerProvider(new CoinGeckoProvider());
    
    const result = await manager.getCurrentPrice('ETH');
    
    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(coinpaprikaCalled, true);
    assert.strictEqual(coingeckoCalled, true); // Should call fallback
  });
  
  it('should return null when all providers fail', async () => {
    globalThis.fetch = async () => {
      return { ok: false, status: 500 };
    };
    
    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    
    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinPaprikaProvider());
    manager.registerProvider(new CoinGeckoProvider());
    
    const result = await manager.getCurrentPrice('ETH');
    
    assert.strictEqual(result, null);
  });
  
  it('should cache results', async () => {
    let fetchCount = 0;
    
    globalThis.fetch = async (url) => {
      fetchCount++;
      if (url.includes('coinpaprika')) {
        return {
          ok: true,
          json: async () => ({
            quotes: { USD: { price: 3500.00, percent_change_24h: 2.5 } },
          }),
        };
      }
    };
    
    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    
    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinPaprikaProvider());
    
    // First call should fetch
    await manager.getCurrentPrice('ETH');
    assert.strictEqual(fetchCount, 1);
    
    // Second call should use cache
    await manager.getCurrentPrice('ETH');
    assert.strictEqual(fetchCount, 1); // Still 1, used cache
    
    // Clear cache and fetch again
    manager.clearCache();
    await manager.getCurrentPrice('ETH');
    assert.strictEqual(fetchCount, 2);
  });
  
  it('should register providers in priority order', async () => {
    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');
    
    const manager = new PriceProviderManager();
    
    // Register in reverse order
    manager.registerProvider(new CoinGeckoProvider());  // Priority 2
    manager.registerProvider(new CoinPaprikaProvider()); // Priority 1
    
    const providers = manager.getProviders();
    
    // Should be sorted by priority
    assert.strictEqual(providers[0].name, 'CoinPaprika');
    assert.strictEqual(providers[1].name, 'CoinGecko');
  });
});

// ============================================================================
// Price Service Integration Tests
// ============================================================================

describe('Price Service (Integration)', () => {
  let originalFetch;
  
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  
  it('should get native token price via provider manager', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('coinpaprika')) {
        return {
          ok: true,
          json: async () => ({
            quotes: { USD: { price: 3500.00, percent_change_24h: 2.5 } },
          }),
        };
      }
    };
    
    const { getNativeTokenPrice, clearPriceCache } = await import('../dist/price-service.js');
    
    clearPriceCache();
    const price = await getNativeTokenPrice(1); // Ethereum mainnet
    
    assert.strictEqual(price, 3500.00);
  });
  
  it('should get Bitcoin price via provider manager', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('coinpaprika')) {
        return {
          ok: true,
          json: async () => ({
            quotes: { USD: { price: 100000.00, percent_change_24h: 1.5 } },
          }),
        };
      }
    };
    
    const { getBitcoinPrice, clearPriceCache } = await import('../dist/price-service.js');
    
    clearPriceCache();
    const price = await getBitcoinPrice();
    
    assert.strictEqual(price, 100000.00);
  });
  
  it('should get price history', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('coinpaprika') && url.includes('historical')) {
        return {
          ok: true,
          json: async () => [
            { timestamp: '2024-12-17T00:00:00Z', price: 3400.00 },
            { timestamp: '2024-12-17T12:00:00Z', price: 3500.00 },
          ],
        };
      }
    };
    
    const { getPriceHistory, clearPriceCache } = await import('../dist/price-service.js');
    
    clearPriceCache();
    const history = await getPriceHistory('ETH', '1D');
    
    assert.ok(history);
    assert.strictEqual(history.data.length, 2);
    assert.strictEqual(history.priceChange.value, 100);
  });
});

