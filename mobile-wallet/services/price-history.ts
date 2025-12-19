/**
 * @fileoverview Price history service for token detail charts.
 *
 * Fetches historical price data from CoinGecko API for charting.
 * Implements caching to minimize API calls and respect rate limits.
 *
 * @responsibilities
 * - Fetch price history for tokens across different time ranges
 * - Cache price history data with TTL
 * - Map token symbols to CoinGecko IDs
 *
 * @security
 * - No sensitive data handled
 * - Read-only API calls
 */

// ============================================================================
// Types
// ============================================================================

export type TimeRange = '1H' | '1D' | '1W' | '1M' | 'YTD' | 'ALL';

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface PriceHistoryData {
  data: PricePoint[];
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
// Constants
// ============================================================================

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Cache TTL for price history: 5 minutes */
const HISTORY_CACHE_TTL = 5 * 60 * 1000;

/** Cache TTL for token metadata: 1 hour */
const METADATA_CACHE_TTL = 60 * 60 * 1000;

/** Request timeout: 15 seconds */
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Maps common token symbols to CoinGecko IDs
 */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  // Native tokens
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
  XRP: 'ripple',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  BNB: 'binancecoin',

  // Stablecoins
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  BUSD: 'binance-usd',
  FRAX: 'frax',

  // Popular tokens
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  CRV: 'curve-dao-token',
  MKR: 'maker',
  COMP: 'compound-governance-token',
  SNX: 'synthetix-network-token',
  SUSHI: 'sushi',
  YFI: 'yearn-finance',
  '1INCH': '1inch',
  LDO: 'lido-dao',
  RPL: 'rocket-pool',
  GRT: 'the-graph',
  ENS: 'ethereum-name-service',
  APE: 'apecoin',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  ARB: 'arbitrum',
  OP: 'optimism',
  DOGE: 'dogecoin',
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
  stETH: 'staked-ether',
  cbETH: 'coinbase-wrapped-staked-eth',
  rETH: 'rocket-pool-eth',
};

/**
 * Maps time range to CoinGecko API days parameter
 */
const TIME_RANGE_TO_DAYS: Record<TimeRange, number | 'max'> = {
  '1H': 1, // Will filter to last hour client-side
  '1D': 1,
  '1W': 7,
  '1M': 30,
  YTD: calculateYTDDays(),
  ALL: 'max',
};

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const historyCache = new Map<string, CacheEntry<PriceHistoryData>>();
const metadataCache = new Map<string, CacheEntry<TokenMetadata>>();

function getCacheKey(symbol: string, timeRange: TimeRange): string {
  return `${symbol.toUpperCase()}-${timeRange}`;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateYTDDays(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diffTime = Math.abs(now.getTime() - startOfYear.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

async function fetchWithTimeout(url: string, timeout = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Get CoinGecko ID for a token symbol
 */
export function getCoinGeckoId(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_TO_COINGECKO_ID[upperSymbol] || null;
}

/**
 * Filter price data to last N hours
 */
function filterToLastHours(data: PricePoint[], hours: number): PricePoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return data.filter((point) => point.timestamp >= cutoff);
}

/**
 * Calculate price change between first and last points
 */
function calculatePriceChange(data: PricePoint[]): { value: number; percent: number } {
  if (data.length < 2) {
    return { value: 0, percent: 0 };
  }

  const firstPrice = data[0].price;
  const lastPrice = data[data.length - 1].price;

  const value = lastPrice - firstPrice;
  const percent = firstPrice > 0 ? (value / firstPrice) * 100 : 0;

  return { value, percent };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch price history for a token
 *
 * @param symbol - Token symbol (e.g., "ETH", "BTC")
 * @param timeRange - Time range for history
 * @param forceRefresh - Bypass cache
 * @returns Price history data or null if unavailable
 */
export async function getPriceHistory(
  symbol: string,
  timeRange: TimeRange,
  forceRefresh = false
): Promise<PriceHistoryData | null> {
  const cacheKey = getCacheKey(symbol, timeRange);

  // Check cache
  if (!forceRefresh) {
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL) {
      return cached.data;
    }
  }

  const coinId = getCoinGeckoId(symbol);
  if (!coinId) {
    console.warn(`[PriceHistory] No CoinGecko ID for symbol: ${symbol}`);
    return null;
  }

  const days = TIME_RANGE_TO_DAYS[timeRange];

  try {
    const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn(`[PriceHistory] API error: ${response.status}`);
      return null;
    }

    const rawData = (await response.json()) as {
      prices?: [number, number][];
    };

    if (!rawData.prices || !Array.isArray(rawData.prices)) {
      console.warn('[PriceHistory] Invalid response format');
      return null;
    }

    // Convert to our format
    let data: PricePoint[] = rawData.prices.map(([timestamp, price]) => ({
      timestamp,
      price,
    }));

    // For 1H, filter to last hour
    if (timeRange === '1H') {
      data = filterToLastHours(data, 1);
    }

    const priceChange = calculatePriceChange(data);

    const result: PriceHistoryData = {
      data,
      symbol: symbol.toUpperCase(),
      timeRange,
      fetchedAt: Date.now(),
      priceChange,
    };

    // Cache result
    historyCache.set(cacheKey, { data: result, fetchedAt: Date.now() });

    return result;
  } catch (error) {
    console.warn('[PriceHistory] Failed to fetch price history:', error);
    return null;
  }
}

/**
 * Fetch token metadata (description, market cap, supply)
 *
 * @param symbol - Token symbol
 * @param forceRefresh - Bypass cache
 * @returns Token metadata or null if unavailable
 */
export async function getTokenMetadata(
  symbol: string,
  forceRefresh = false
): Promise<TokenMetadata | null> {
  const cacheKey = symbol.toUpperCase();

  // Check cache
  if (!forceRefresh) {
    const cached = metadataCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < METADATA_CACHE_TTL) {
      return cached.data;
    }
  }

  const coinId = getCoinGeckoId(symbol);
  if (!coinId) {
    console.warn(`[PriceHistory] No CoinGecko ID for symbol: ${symbol}`);
    return null;
  }

  try {
    const url = `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn(`[PriceHistory] Metadata API error: ${response.status}`);
      return null;
    }

    const rawData = (await response.json()) as {
      description?: { en?: string };
      market_data?: {
        market_cap?: { usd?: number };
        total_supply?: number;
        circulating_supply?: number;
      };
      links?: {
        homepage?: string[];
      };
    };

    const result: TokenMetadata = {
      description: rawData.description?.en || '',
      marketCap: rawData.market_data?.market_cap?.usd || null,
      totalSupply: rawData.market_data?.total_supply || null,
      circulatingSupply: rawData.market_data?.circulating_supply || null,
      websiteUrl: rawData.links?.homepage?.[0] || null,
      fetchedAt: Date.now(),
    };

    // Cache result
    metadataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });

    return result;
  } catch (error) {
    console.warn('[PriceHistory] Failed to fetch token metadata:', error);
    return null;
  }
}

/**
 * Clear all caches
 */
export function clearPriceHistoryCache(): void {
  historyCache.clear();
  metadataCache.clear();
}

/**
 * Format large numbers for display
 */
export function formatLargeNumber(value: number | null): string {
  if (value === null) return '--';

  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Format supply numbers
 */
export function formatSupply(value: number | null, symbol: string): string {
  if (value === null) return '--';

  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B ${symbol}`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M ${symbol}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K ${symbol}`;
  }
  return `${value.toFixed(2)} ${symbol}`;
}
