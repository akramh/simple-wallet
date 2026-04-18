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

  it('should include API key header when configured', async () => {
    let capturedHeaders = {};
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers || {};
      return {
        ok: true,
        json: async () => ({
          ethereum: { usd: 3500.00, usd_24h_change: 2.5 },
        }),
      };
    };

    const { CoinGeckoProvider, setCoingeckoApiKey } = await import('../dist/price-providers/coingecko.js');
    const provider = new CoinGeckoProvider();

    // Set API key
    const testApiKey = 'test-api-key-123';
    setCoingeckoApiKey(testApiKey);

    await provider.getCurrentPrice('ETH');

    assert.strictEqual(capturedHeaders['x-cg-pro-api-key'], testApiKey);

    // Reset API key for other tests
    setCoingeckoApiKey(undefined);
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
  
  it('should use primary provider (CoinGecko) when available', async () => {
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
          json: async () => ({ ethereum: { usd: 3500.00, usd_24h_change: 2.5 } }),
        };
      }
    };

    const { PriceProviderManager } = await import('../dist/price-providers/provider-manager.js');
    const { CoinPaprikaProvider } = await import('../dist/price-providers/coinpaprika.js');
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');

    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinGeckoProvider());   // Priority 1 (primary)
    manager.registerProvider(new CoinPaprikaProvider()); // Priority 2 (fallback)

    const result = await manager.getCurrentPrice('ETH');

    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(coingeckoCalled, true);  // Primary should be called
    assert.strictEqual(coinpaprikaCalled, false); // Fallback should not be called
  });
  
  it('should fall back to CoinPaprika when CoinGecko fails', async () => {
    let coinpaprikaCalled = false;
    let coingeckoCalled = false;

    globalThis.fetch = async (url) => {
      if (url.includes('coingecko')) {
        coingeckoCalled = true;
        return { ok: false, status: 429 }; // Rate limited
      }
      if (url.includes('coinpaprika')) {
        coinpaprikaCalled = true;
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
    const { CoinGeckoProvider } = await import('../dist/price-providers/coingecko.js');

    const manager = new PriceProviderManager();
    manager.registerProvider(new CoinGeckoProvider());   // Priority 1 (primary)
    manager.registerProvider(new CoinPaprikaProvider()); // Priority 2 (fallback)

    const result = await manager.getCurrentPrice('ETH');

    assert.strictEqual(result.price, 3500.00);
    assert.strictEqual(coingeckoCalled, true);    // Primary tried first
    assert.strictEqual(coinpaprikaCalled, true);  // Fallback used after primary failed
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

    // Register in reverse priority order
    manager.registerProvider(new CoinPaprikaProvider()); // Priority 2
    manager.registerProvider(new CoinGeckoProvider());   // Priority 1

    const providers = manager.getProviders();

    // Should be sorted by priority (CoinGecko first now)
    assert.strictEqual(providers[0].name, 'CoinGecko');
    assert.strictEqual(providers[1].name, 'CoinPaprika');
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

// ============================================================================
// Alchemy Provider Tests
// ============================================================================

describe('AlchemyPriceProvider', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('has priority 0 so it is tried before CoinGecko and CoinPaprika', async () => {
    const { AlchemyPriceProvider } = await import('../dist/price-providers/alchemy.js');
    const provider = new AlchemyPriceProvider();
    assert.strictEqual(provider.priority, 0);
    assert.strictEqual(provider.name, 'Alchemy');
  });

  it('supportsToken returns true for common symbols and false for obscure ones', async () => {
    const { AlchemyPriceProvider } = await import('../dist/price-providers/alchemy.js');
    const provider = new AlchemyPriceProvider();
    assert.strictEqual(provider.supportsToken('ETH'), true);
    assert.strictEqual(provider.supportsToken('btc'), true); // case-insensitive
    assert.strictEqual(provider.supportsToken('USDC'), true);
    assert.strictEqual(provider.supportsToken('OBSCURE_TOKEN_XYZ'), false);
  });

  it('getCurrentPrice calls /tokens/by-symbol and parses USD price', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          data: [
            { symbol: 'ETH', prices: [{ currency: 'usd', value: '3500.12', lastUpdatedAt: '2026-04-17T00:00:00Z' }] },
          ],
        }),
      };
    };

    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key-abc123');
    const provider = new AlchemyPriceProvider();
    const result = await provider.getCurrentPrice('ETH');

    assert.strictEqual(result.price, 3500.12);
    assert.ok(capturedUrl.startsWith('https://api.g.alchemy.com/prices/v1/test-key-abc123/tokens/by-symbol?symbols=ETH'));
    setAlchemyApiKey(undefined);
  });

  it('getCurrentPrice throws on per-symbol error so manager falls through', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [{ symbol: 'WEIRD', error: { message: 'symbol not found' } }],
      }),
    });

    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key');
    const provider = new AlchemyPriceProvider();
    await assert.rejects(() => provider.getCurrentPrice('WEIRD'), /no price for WEIRD/);
    setAlchemyApiKey(undefined);
  });

  it('getCurrentPrice throws when ALCHEMY_API_KEY is not set', async () => {
    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey(undefined);
    const prevEnv = process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_API_KEY;
    try {
      const provider = new AlchemyPriceProvider();
      await assert.rejects(() => provider.getCurrentPrice('ETH'), /ALCHEMY_API_KEY not set/);
    } finally {
      if (prevEnv !== undefined) process.env.ALCHEMY_API_KEY = prevEnv;
    }
  });

  it('getTokenPriceByContract POSTs to /tokens/by-address with network+address body', async () => {
    let capturedUrl = '';
    let capturedInit = null;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              network: 'eth-mainnet',
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              prices: [{ currency: 'usd', value: '1.0001', lastUpdatedAt: '2026-04-17T00:00:00Z' }],
            },
          ],
        }),
      };
    };

    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key-xyz');
    const provider = new AlchemyPriceProvider();
    const result = await provider.getTokenPriceByContract(1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eB48');

    assert.strictEqual(result.price, 1.0001);
    assert.strictEqual(capturedUrl, 'https://api.g.alchemy.com/prices/v1/test-key-xyz/tokens/by-address');
    assert.strictEqual(capturedInit.method, 'POST');
    const body = JSON.parse(capturedInit.body);
    assert.deepStrictEqual(body, {
      addresses: [{ network: 'eth-mainnet', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eB48' }],
    });
    setAlchemyApiKey(undefined);
  });

  it('getTokenPriceByContract throws for unmapped chainId', async () => {
    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key');
    const provider = new AlchemyPriceProvider();
    await assert.rejects(
      () => provider.getTokenPriceByContract(999999, '0xabc'),
      /no slug mapped for chainId 999999/,
    );
    setAlchemyApiKey(undefined);
  });

  it('getPriceHistory throws fast without hitting the network', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({}) };
    };

    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key');
    const provider = new AlchemyPriceProvider();
    await assert.rejects(() => provider.getPriceHistory('ETH', '1D'), /getPriceHistory not implemented/);
    assert.strictEqual(fetchCalled, false, 'must not make an HTTP request');
    setAlchemyApiKey(undefined);
  });

  it('getTokenMetadata throws fast without hitting the network', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({}) };
    };

    const { AlchemyPriceProvider, setAlchemyApiKey } = await import('../dist/price-providers/alchemy.js');
    setAlchemyApiKey('test-key');
    const provider = new AlchemyPriceProvider();
    await assert.rejects(() => provider.getTokenMetadata('ETH'), /getTokenMetadata not implemented/);
    assert.strictEqual(fetchCalled, false, 'must not make an HTTP request');
    setAlchemyApiKey(undefined);
  });
});

// ============================================================================
// Registration Order Tests — verifies Alchemy is tried first for current prices
// ============================================================================

describe('Provider registration order', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('singleton priceProviderManager tries Alchemy first, then CoinGecko, then CoinPaprika', async () => {
    const callOrder = [];
    globalThis.fetch = async (url) => {
      if (url.includes('api.g.alchemy.com/prices')) {
        callOrder.push('alchemy');
        return {
          ok: true,
          json: async () => ({
            data: [{ symbol: 'ETH', prices: [{ currency: 'usd', value: '3600.00' }] }],
          }),
        };
      }
      if (url.includes('coingecko')) {
        callOrder.push('coingecko');
        return { ok: true, json: async () => ({ ethereum: { usd: 3500.00 } }) };
      }
      if (url.includes('coinpaprika')) {
        callOrder.push('coinpaprika');
        return { ok: true, json: async () => ({ quotes: { USD: { price: 3400.00 } } }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { priceProviderManager, setAlchemyApiKey } = await import('../dist/price-providers/index.js');
    priceProviderManager.clearCache();
    setAlchemyApiKey('test-key');

    const result = await priceProviderManager.getCurrentPrice('ETH');

    assert.strictEqual(result.price, 3600.00, 'should return Alchemy price (tried first)');
    assert.deepStrictEqual(callOrder, ['alchemy'], 'only Alchemy should have been called');
    setAlchemyApiKey(undefined);
    priceProviderManager.clearCache();
  });

  it('falls through to CoinGecko when Alchemy returns a per-symbol error', async () => {
    const callOrder = [];
    globalThis.fetch = async (url) => {
      if (url.includes('api.g.alchemy.com/prices')) {
        callOrder.push('alchemy');
        return {
          ok: true,
          json: async () => ({
            data: [{ symbol: 'ETH', error: { message: 'Alchemy miss for ETH in this test' } }],
          }),
        };
      }
      if (url.includes('coingecko')) {
        callOrder.push('coingecko');
        return { ok: true, json: async () => ({ ethereum: { usd: 3500.00 } }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const { priceProviderManager, setAlchemyApiKey } = await import('../dist/price-providers/index.js');
    priceProviderManager.clearCache();
    setAlchemyApiKey('test-key');

    const result = await priceProviderManager.getCurrentPrice('ETH');
    assert.strictEqual(result.price, 3500.00, 'should fall through to CoinGecko');
    assert.deepStrictEqual(callOrder, ['alchemy', 'coingecko'], 'Alchemy tried first, then CoinGecko');
    setAlchemyApiKey(undefined);
    priceProviderManager.clearCache();
  });
});

