# Price Provider Refactor Plan

**Date:** December 18, 2025  
**Status:** Planning  
**Goal:** Unified price provider architecture in Core SDK with CoinPaprika primary + CoinGecko fallback, used by CLI, Chrome Extension, and Mobile.

---

## Overview

Create a pluggable price provider abstraction in the Core SDK (`src/`) that:
1. Uses **CoinPaprika** as the primary provider (better free tier: 20K calls/month)
2. Falls back to **CoinGecko** when CoinPaprika fails
3. Makes it easy to add/swap providers via configuration
4. Is consumed by CLI, Chrome Extension, and Mobile Wallet
5. Supports both **current prices** and **price history**

---

## Current State

| File | Location | Purpose | Consumers |
|------|----------|---------|-----------|
| `price-service.ts` | `src/` | Current prices for portfolio/transactions | CLI, Extension |
| `price-history.ts` | `mobile-wallet/services/` | Price history charts + metadata | Mobile |

Both use CoinGecko directly with no fallback.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONSUMERS                                       │
├─────────────────────┬─────────────────────┬─────────────────────────────────┤
│   CLI (src/index)   │  Chrome Extension   │     Mobile Wallet               │
│                     │  (extension/)       │     (mobile-wallet/)            │
└─────────┬───────────┴──────────┬──────────┴────────────────┬────────────────┘
          │                      │                           │
          ▼                      ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         src/price-service.ts                                 │
│                    (Public API - backwards compatible)                       │
│  getNativeTokenPrice() | getERC20TokenPrice() | getTokenPrices()            │
│  getPriceHistory() | getTokenMetadata()  [NEW]                              │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    src/price-providers/provider-manager.ts                   │
│  - Manages provider priority                                                 │
│  - Handles fallback logic                                                    │
│  - Caching layer                                                             │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          ┌───────────────────┐       ┌───────────────────┐
          │ coinpaprika.ts    │       │ coingecko.ts      │
          │ (Primary)         │       │ (Fallback)        │
          │                   │       │                   │
          │ Priority: 1       │       │ Priority: 2       │
          └───────────────────┘       └───────────────────┘
```

---

## New File Structure

```
src/
├── price-service.ts              # MODIFIED - Add history API, use provider manager
├── price-providers/
│   ├── index.ts                  # NEW - Exports & provider registration
│   ├── types.ts                  # NEW - PriceProvider interface
│   ├── provider-manager.ts       # NEW - Fallback logic & caching
│   ├── coinpaprika.ts            # NEW - CoinPaprika implementation
│   └── coingecko.ts              # NEW - CoinGecko implementation

mobile-wallet/services/
├── price-history.ts              # MODIFIED - Import from SDK, thin wrapper
```

---

## Phase 1: Define Provider Interface

### File: `src/price-providers/types.ts`

```typescript
/**
 * @fileoverview Price provider interface and shared types.
 * 
 * Defines the contract that all price data providers must implement.
 * Supports both current prices and historical price data.
 */

// ============================================================================
// Time Range Types
// ============================================================================

export type TimeRange = '1H' | '1D' | '1W' | '1M' | 'YTD' | 'ALL';

// ============================================================================
// Price Data Types
// ============================================================================

export interface PricePoint {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Price in USD */
  price: number;
}

export interface CurrentPriceResult {
  /** USD price */
  price: number;
  /** Optional 24h change percentage */
  change24h?: number;
}

export interface PriceHistoryResult {
  /** Array of price points */
  data: PricePoint[];
  /** Price change over the period */
  priceChange: {
    value: number;
    percent: number;
  };
}

export interface TokenMetadataResult {
  description: string;
  marketCap: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  websiteUrl: string | null;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface that all price providers must implement.
 * 
 * Providers can support current prices, price history, or both.
 * The manager will try providers in priority order.
 */
export interface PriceProvider {
  /** Provider name for logging */
  readonly name: string;
  
  /** Priority (lower = higher priority, tried first) */
  readonly priority: number;
  
  /**
   * Check if this provider supports the given token.
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   */
  supportsToken(symbol: string): boolean;
  
  /**
   * Get current price for a token by symbol.
   * @throws Error on failure (manager will try next provider)
   */
  getCurrentPrice(symbol: string): Promise<CurrentPriceResult>;
  
  /**
   * Get current price for an ERC-20 token by contract address.
   * @param chainId - EVM chain ID
   * @param contractAddress - Token contract address
   * @throws Error on failure
   */
  getTokenPriceByContract?(chainId: number, contractAddress: string): Promise<CurrentPriceResult>;
  
  /**
   * Fetch price history for a token.
   * @throws Error on failure (manager will try next provider)
   */
  getPriceHistory(symbol: string, timeRange: TimeRange): Promise<PriceHistoryResult>;
  
  /**
   * Fetch token metadata (market cap, supply, description).
   * @throws Error on failure (manager will try next provider)
   */
  getTokenMetadata(symbol: string): Promise<TokenMetadataResult>;
}
```

---

## Phase 2: Implement CoinPaprika Provider

### File: `src/price-providers/coinpaprika.ts`

**API Endpoints:**
- Base: `https://api.coinpaprika.com/v1`
- Current price: `GET /tickers/{coin_id}`
- Historical: `GET /tickers/{coin_id}/historical?start={date}&interval={interval}`
- Coin info: `GET /coins/{coin_id}` (for metadata)

**Symbol Mapping:**
```typescript
const SYMBOL_TO_COINPAPRIKA_ID: Record<string, string> = {
  // Native tokens
  ETH: 'eth-ethereum',
  BTC: 'btc-bitcoin',
  SOL: 'sol-solana',
  XRP: 'xrp-xrp',
  MATIC: 'matic-polygon',
  AVAX: 'avax-avalanche',
  BNB: 'bnb-binance-coin',
  
  // Stablecoins
  USDC: 'usdc-usd-coin',
  USDT: 'usdt-tether',
  DAI: 'dai-dai',
  
  // Popular tokens
  LINK: 'link-chainlink',
  UNI: 'uni-uniswap',
  AAVE: 'aave-aave',
  // ... more mappings
};
```

**Time Range Mapping:**
| TimeRange | interval | start calculation |
|-----------|----------|-------------------|
| 1H        | 5m       | now - 1 hour |
| 1D        | 1h       | now - 24 hours |
| 1W        | 6h       | now - 7 days |
| 1M        | 1d       | now - 30 days |
| YTD       | 1d       | Jan 1 of current year |
| ALL       | 7d       | 2013-01-01 |

**Implementation Notes:**
- CoinPaprika returns ISO timestamps, convert to Unix ms
- Historical endpoint returns array of `{ timestamp, price, volume_24h, market_cap }`
- No API key required for free tier (20K calls/month)

---

## Phase 3: Implement CoinGecko Provider

### File: `src/price-providers/coingecko.ts`

Extract existing CoinGecko logic from `price-service.ts` and `mobile-wallet/services/price-history.ts`.

**API Endpoints:**
- Base: `https://api.coingecko.com/api/v3`
- Current price: `GET /simple/price?ids={id}&vs_currencies=usd`
- ERC-20 price: `GET /simple/token_price/{platform}?contract_addresses={addr}&vs_currencies=usd`
- Historical: `GET /coins/{id}/market_chart?vs_currency=usd&days={days}`
- Coin info: `GET /coins/{id}` (for metadata)

**Existing Mappings (keep):**
- `SYMBOL_TO_COINGECKO_ID` - token symbol to CoinGecko ID
- `CHAIN_TO_PLATFORM` - chain ID to CoinGecko platform
- `CHAIN_TO_NATIVE_ID` - chain ID to native token CoinGecko ID

**API Key Support (optional):**
```typescript
// Support optional API key for better rate limits
const headers: HeadersInit = {};
if (process.env.COINGECKO_API_KEY) {
  headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
}
```

---

## Phase 4: Implement Provider Manager

### File: `src/price-providers/provider-manager.ts`

```typescript
/**
 * @fileoverview Manages price providers with fallback logic.
 * 
 * @responsibilities
 * - Register and prioritize providers
 * - Try providers in order, fall back on failure
 * - Cache results to reduce API calls
 * - Log provider usage for debugging
 */

export class PriceProviderManager {
  private providers: PriceProvider[] = [];
  private currentPriceCache: Map<string, CacheEntry<CurrentPriceResult>>;
  private historyCache: Map<string, CacheEntry<PriceHistoryResult>>;
  private metadataCache: Map<string, CacheEntry<TokenMetadataResult>>;
  
  /** Cache TTLs */
  private static CURRENT_PRICE_TTL = 60 * 1000;      // 1 minute
  private static HISTORY_TTL = 5 * 60 * 1000;        // 5 minutes
  private static METADATA_TTL = 60 * 60 * 1000;      // 1 hour
  
  /**
   * Register a provider (automatically sorted by priority).
   */
  registerProvider(provider: PriceProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Get current price, trying providers in priority order.
   */
  async getCurrentPrice(symbol: string): Promise<CurrentPriceResult | null> {
    const cacheKey = symbol.toUpperCase();
    
    // Check cache
    const cached = this.currentPriceCache.get(cacheKey);
    if (cached && !this.isExpired(cached, PriceProviderManager.CURRENT_PRICE_TTL)) {
      return cached.data;
    }
    
    // Try providers
    for (const provider of this.providers) {
      if (!provider.supportsToken(symbol)) continue;
      
      try {
        const result = await provider.getCurrentPrice(symbol);
        this.currentPriceCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
        return result;
      } catch (error) {
        console.warn(`[PriceManager] ${provider.name} failed for ${symbol}:`, error);
        // Continue to next provider
      }
    }
    
    return null;
  }
  
  /**
   * Get price history, trying providers in priority order.
   */
  async getPriceHistory(
    symbol: string, 
    timeRange: TimeRange
  ): Promise<PriceHistoryResult | null> {
    const cacheKey = `${symbol.toUpperCase()}-${timeRange}`;
    
    // Check cache
    const cached = this.historyCache.get(cacheKey);
    if (cached && !this.isExpired(cached, PriceProviderManager.HISTORY_TTL)) {
      return cached.data;
    }
    
    // Try providers
    for (const provider of this.providers) {
      if (!provider.supportsToken(symbol)) continue;
      
      try {
        const result = await provider.getPriceHistory(symbol, timeRange);
        this.historyCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
        return result;
      } catch (error) {
        console.warn(`[PriceManager] ${provider.name} history failed for ${symbol}:`, error);
      }
    }
    
    return null;
  }
  
  /**
   * Get token metadata, trying providers in priority order.
   */
  async getTokenMetadata(symbol: string): Promise<TokenMetadataResult | null> {
    // Similar pattern...
  }
  
  /**
   * Get ERC-20 token price by contract address.
   * Falls back through providers that support contract lookups.
   */
  async getTokenPriceByContract(
    chainId: number, 
    contractAddress: string
  ): Promise<CurrentPriceResult | null> {
    const cacheKey = `${chainId}:${contractAddress.toLowerCase()}`;
    
    // Check cache
    const cached = this.currentPriceCache.get(cacheKey);
    if (cached && !this.isExpired(cached, PriceProviderManager.CURRENT_PRICE_TTL)) {
      return cached.data;
    }
    
    // Try providers that support contract lookups
    for (const provider of this.providers) {
      if (!provider.getTokenPriceByContract) continue;
      
      try {
        const result = await provider.getTokenPriceByContract(chainId, contractAddress);
        this.currentPriceCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
        return result;
      } catch (error) {
        console.warn(`[PriceManager] ${provider.name} contract lookup failed:`, error);
      }
    }
    
    return null;
  }
  
  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.currentPriceCache.clear();
    this.historyCache.clear();
    this.metadataCache.clear();
  }
}
```

---

## Phase 5: Provider Registration

### File: `src/price-providers/index.ts`

```typescript
/**
 * @fileoverview Price provider registration and exports.
 * 
 * Configures the provider priority order:
 * 1. CoinPaprika (primary) - better free tier
 * 2. CoinGecko (fallback) - widely supported
 */

import { CoinPaprikaProvider } from './coinpaprika.js';
import { CoinGeckoProvider } from './coingecko.js';
import { PriceProviderManager } from './provider-manager.js';

// Create singleton manager
export const priceProviderManager = new PriceProviderManager();

// Register providers in priority order
priceProviderManager.registerProvider(new CoinPaprikaProvider());  // Priority 1
priceProviderManager.registerProvider(new CoinGeckoProvider());    // Priority 2

// Re-export types
export * from './types.js';
export { PriceProviderManager } from './provider-manager.js';
```

**To change provider priority:**
```typescript
// Option 1: Change priority in provider class
class CoinGeckoProvider implements PriceProvider {
  readonly priority = 1;  // Make it primary
}

// Option 2: Register in different order
priceProviderManager.registerProvider(new CoinGeckoProvider());   // First = primary
priceProviderManager.registerProvider(new CoinPaprikaProvider()); // Fallback
```

---

## Phase 6: Update Price Service

### File: `src/price-service.ts` (modified)

Keep backwards-compatible API, delegate to provider manager:

```typescript
import { priceProviderManager } from './price-providers/index.js';

// ============================================================================
// Existing API (unchanged signatures)
// ============================================================================

export async function getNativeTokenPrice(chainId: number): Promise<number | null> {
  const symbol = CHAIN_TO_NATIVE_SYMBOL[chainId];
  if (!symbol) return null;
  
  const result = await priceProviderManager.getCurrentPrice(symbol);
  return result?.price ?? null;
}

export async function getERC20TokenPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  const result = await priceProviderManager.getTokenPriceByContract(chainId, contractAddress);
  return result?.price ?? null;
}

export async function getBitcoinPrice(): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('BTC');
  return result?.price ?? null;
}

export async function getSolanaPrice(): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('SOL');
  return result?.price ?? null;
}

export async function getXRPPrice(): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('XRP');
  return result?.price ?? null;
}

// ============================================================================
// NEW: Price History API (for mobile + future CLI/extension use)
// ============================================================================

export type { TimeRange, PricePoint, PriceHistoryResult, TokenMetadataResult } from './price-providers/types.js';

export async function getPriceHistory(
  symbol: string,
  timeRange: TimeRange
): Promise<PriceHistoryResult | null> {
  return priceProviderManager.getPriceHistory(symbol, timeRange);
}

export async function getTokenMetadata(
  symbol: string
): Promise<TokenMetadataResult | null> {
  return priceProviderManager.getTokenMetadata(symbol);
}

export function clearPriceCache(): void {
  priceProviderManager.clearCache();
}
```

---

## Phase 7: Update Mobile Wallet

### File: `mobile-wallet/services/price-history.ts` (simplified)

```typescript
/**
 * @fileoverview Price history service for token detail charts.
 * 
 * Thin wrapper around Core SDK price providers.
 * Adds mobile-specific formatting and types.
 */

// Import from Core SDK
import {
  getPriceHistory as sdkGetPriceHistory,
  getTokenMetadata as sdkGetTokenMetadata,
  type TimeRange,
  type PriceHistoryResult,
  type TokenMetadataResult,
} from 'simple-wallet-sdk';  // or relative import

// Re-export types
export type { TimeRange, PriceHistoryResult, TokenMetadataResult };

// ============================================================================
// Mobile-specific wrapper types
// ============================================================================

export interface PriceHistoryData {
  data: Array<{ timestamp: number; price: number }>;
  symbol: string;
  timeRange: TimeRange;
  fetchedAt: number;
  priceChange: {
    value: number;
    percent: number;
  };
}

export interface TokenMetadata {
  description: string;
  marketCap: number | null;
  totalSupply: number | null;
  circulatingSupply: number | null;
  websiteUrl: string | null;
  fetchedAt: number;
}

// ============================================================================
// Public API (unchanged signatures for mobile consumers)
// ============================================================================

export async function getPriceHistory(
  symbol: string,
  timeRange: TimeRange,
  _forceRefresh = false  // Handled by SDK cache
): Promise<PriceHistoryData | null> {
  const result = await sdkGetPriceHistory(symbol, timeRange);
  
  if (!result) return null;
  
  return {
    data: result.data,
    symbol: symbol.toUpperCase(),
    timeRange,
    fetchedAt: Date.now(),
    priceChange: result.priceChange,
  };
}

export async function getTokenMetadata(
  symbol: string,
  _forceRefresh = false
): Promise<TokenMetadata | null> {
  const result = await sdkGetTokenMetadata(symbol);
  
  if (!result) return null;
  
  return {
    ...result,
    fetchedAt: Date.now(),
  };
}

// Keep existing formatting utilities
export function formatLargeNumber(value: number | null): string { /* ... */ }
export function formatSupply(value: number | null, symbol: string): string { /* ... */ }
```

---

## Implementation Tasks

| # | Task | Effort | File(s) | Platform Impact |
|---|------|--------|---------|-----------------|
| 1 | Create `types.ts` with PriceProvider interface | S | `src/price-providers/types.ts` | All |
| 2 | Implement CoinPaprika provider | M | `src/price-providers/coinpaprika.ts` | All |
| 3 | Extract CoinGecko into provider class | M | `src/price-providers/coingecko.ts` | All |
| 4 | Implement provider manager with fallback | M | `src/price-providers/provider-manager.ts` | All |
| 5 | Create index with provider registration | S | `src/price-providers/index.ts` | All |
| 6 | Update `price-service.ts` to use manager | M | `src/price-service.ts` | CLI, Extension |
| 7 | Simplify mobile `price-history.ts` | S | `mobile-wallet/services/price-history.ts` | Mobile |
| 8 | Update SDK exports (index.ts) | S | `src/index.ts` | All |
| 9 | Add unit tests for providers | M | `tests/price-providers.test.js` | All |
| 10 | Add fallback integration test | S | `tests/price-providers.test.js` | All |
| 11 | Update mobile to import from SDK | S | `mobile-wallet/services/index.ts` | Mobile |

**Total Effort:** ~5-6 hours

---

## API Reference

### CoinPaprika Endpoints

```
# Get ticker (current price + basic metadata)
GET https://api.coinpaprika.com/v1/tickers/eth-ethereum

Response:
{
  "id": "eth-ethereum",
  "name": "Ethereum",
  "symbol": "ETH",
  "quotes": {
    "USD": {
      "price": 3500.00,
      "market_cap": 420000000000,
      "percent_change_24h": 2.5
    }
  },
  "max_supply": null,
  "circulating_supply": 120000000,
  "total_supply": 120000000
}

# Get historical prices
GET https://api.coinpaprika.com/v1/tickers/eth-ethereum/historical?start=2024-12-17T00:00:00Z&interval=1h

Response:
[
  { "timestamp": "2024-12-17T00:00:00Z", "price": 3450.00, "volume_24h": 1000000, "market_cap": 400000000000 },
  { "timestamp": "2024-12-17T01:00:00Z", "price": 3465.00, "volume_24h": 1100000, "market_cap": 402000000000 },
  ...
]

# Get coin details (for description)
GET https://api.coinpaprika.com/v1/coins/eth-ethereum

Response:
{
  "id": "eth-ethereum",
  "name": "Ethereum",
  "symbol": "ETH",
  "description": "Ethereum is a decentralized platform...",
  "links": {
    "website": ["https://ethereum.org"]
  }
}
```

### CoinGecko Endpoints (existing)

```
# Simple price
GET https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd

# Token price by contract
GET https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0x...&vs_currencies=usd

# Market chart (history)
GET https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1

# Coin details
GET https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false
```

---

## Testing Strategy

### Unit Tests (Node test runner)

**File:** `tests/price-providers.test.js`

1. **CoinPaprika provider**
   - `getCurrentPrice()` - returns formatted data
   - `getPriceHistory()` - returns array of price points
   - `getTokenMetadata()` - returns metadata
   - API error → throws error
   - Unsupported token → `supportsToken()` returns false

2. **CoinGecko provider**
   - Same test cases as above
   - Contract price lookup (`getTokenPriceByContract`)

3. **Provider manager**
   - Uses primary provider when available
   - Falls back when primary fails (mock CoinPaprika error)
   - Caches results (second call doesn't hit API)
   - Returns null when all providers fail
   - Cache expiry triggers new fetch

### Mocking

```javascript
// Mock fetch globally
import { mock } from 'node:test';

const mockFetch = mock.fn(async (url) => {
  if (url.includes('coinpaprika')) {
    return { ok: true, json: async () => mockCoinPaprikaResponse };
  }
  if (url.includes('coingecko')) {
    return { ok: true, json: async () => mockCoinGeckoResponse };
  }
});

globalThis.fetch = mockFetch;
```

---

## Migration Notes

### Backwards Compatibility

All existing function signatures in `price-service.ts` remain unchanged:
- `getNativeTokenPrice(chainId)` ✅
- `getERC20TokenPrice(chainId, address)` ✅
- `getBitcoinPrice()` ✅
- `getSolanaPrice()` ✅
- `getXRPPrice()` ✅
- `getTokenPrices(chainId, tokens)` ✅
- `calculateTransactionCosts()` ✅
- `formatUSDValue()` ✅

### New Exports

Added to `src/price-service.ts`:
- `getPriceHistory(symbol, timeRange)`
- `getTokenMetadata(symbol)`
- `TimeRange`, `PricePoint`, `PriceHistoryResult`, `TokenMetadataResult` types

---

## Rollback Plan

If issues arise after deployment:

1. **Quick fix:** In `src/price-providers/index.ts`, swap registration order:
   ```typescript
   priceProviderManager.registerProvider(new CoinGeckoProvider());   // Make primary
   priceProviderManager.registerProvider(new CoinPaprikaProvider()); // Fallback
   ```

2. **Full rollback:** Revert to previous `price-service.ts` (single file, CoinGecko only)

---

## Future Enhancements

1. **Add API key support** for CoinGecko Demo tier (env var)
2. **Add Coinranking** as third fallback option
3. **Circuit breaker pattern** - temporarily disable failing provider
4. **Metrics/logging** - track which provider serves requests
5. **Rate limit tracking** - proactively switch before hitting limits
6. **WebSocket prices** - real-time updates for mobile

---

## Acceptance Criteria

- [ ] CoinPaprika is called first for all price requests
- [ ] If CoinPaprika fails, CoinGecko is used automatically
- [ ] CLI `checkBalance` shows USD prices (works as before)
- [ ] Extension wallet shows USD prices (works as before)
- [ ] Mobile token detail chart loads price history
- [ ] All existing tests pass
- [ ] New unit tests for both providers pass
- [ ] Fallback behavior verified with integration test

---

## References

- CoinPaprika API Docs: https://api.coinpaprika.com/
- CoinGecko API Docs: https://docs.coingecko.com/
- Current price service: `src/price-service.ts`
- Current mobile history: `mobile-wallet/services/price-history.ts`
