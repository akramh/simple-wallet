/**
 * @fileoverview Price history service for token detail charts.
 *
 * Fetches historical price data with CoinPaprika as primary provider
 * and CoinGecko as fallback. Implements caching to minimize API calls.
 *
 * @responsibilities
 * - Fetch price history for tokens across different time ranges
 * - Fetch token metadata (market cap, supply, description)
 * - Cache data with TTL
 * - Map token symbols to provider IDs
 * - Fallback between providers on failure
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

const COINPAPRIKA_BASE = 'https://api.coinpaprika.com/v1';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Cache TTL for price history: 5 minutes */
const HISTORY_CACHE_TTL = 5 * 60 * 1000;

/** Cache TTL for token metadata: 1 hour */
const METADATA_CACHE_TTL = 60 * 60 * 1000;

/** Request timeout: 15 seconds */
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Maps token symbols to CoinPaprika IDs
 */
const SYMBOL_TO_COINPAPRIKA_ID: Record<string, string> = {
  ETH: 'eth-ethereum',
  BTC: 'btc-bitcoin',
  SOL: 'sol-solana',
  XRP: 'xrp-xrp',
  MATIC: 'matic-polygon',
  AVAX: 'avax-avalanche',
  BNB: 'bnb-binance-coin',
  DOGE: 'doge-dogecoin',
  USDC: 'usdc-usd-coin',
  USDT: 'usdt-tether',
  DAI: 'dai-dai',
  LINK: 'link-chainlink',
  UNI: 'uni-uniswap',
  AAVE: 'aave-aave',
  SHIB: 'shib-shiba-inu',
  PEPE: 'pepe-pepe',
  ARB: 'arb-arbitrum',
  OP: 'op-optimism',
  WETH: 'weth-weth',
  WBTC: 'wbtc-wrapped-bitcoin',
  stETH: 'steth-lido-staked-ether',
};

/**
 * Maps token symbols to CoinGecko IDs (fallback)
 */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
  XRP: 'ripple',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  BNB: 'binancecoin',
  DOGE: 'dogecoin',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
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
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
  stETH: 'staked-ether',
  cbETH: 'coinbase-wrapped-staked-eth',
  rETH: 'rocket-pool-eth',
};

/**
 * CoinPaprika time range configuration
 */
interface TimeRangeConfig {
  interval: string;
  getStartDate: () => string;
}

const COINPAPRIKA_TIME_CONFIG: Record<TimeRange, TimeRangeConfig> = {
  '1H': {
    interval: '5m',
    getStartDate: () => new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  '1D': {
    interval: '1h',
    getStartDate: () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  '1W': {
    interval: '6h',
    getStartDate: () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  '1M': {
    interval: '1d',
    getStartDate: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  YTD: {
    interval: '1d',
    getStartDate: () => new Date(new Date().getFullYear(), 0, 1).toISOString(),
  },
  ALL: {
    interval: '7d',
    getStartDate: () => '2013-01-01T00:00:00Z',
  },
};

/**
 * CoinGecko days parameter
 */
function getCoingeckoDays(timeRange: TimeRange): number | 'max' {
  const now = new Date();
  switch (timeRange) {
    case '1H':
    case '1D':
      return 1;
    case '1W':
      return 7;
    case '1M':
      return 30;
    case 'YTD':
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      return Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
    case 'ALL':
      return 'max';
  }
}

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

function filterToLastHours(data: PricePoint[], hours: number): PricePoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return data.filter((point) => point.timestamp >= cutoff);
}

/**
 * Get CoinGecko ID for a token symbol (for backwards compatibility)
 */
export function getCoinGeckoId(symbol: string): string | null {
  return SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()] || null;
}

// ============================================================================
// CoinPaprika Provider Functions
// ============================================================================

async function fetchCoinpaprikaPriceHistory(
  symbol: string,
  timeRange: TimeRange
): Promise<PricePoint[]> {
  const coinId = SYMBOL_TO_COINPAPRIKA_ID[symbol.toUpperCase()];
  if (!coinId) {
    throw new Error(`CoinPaprika: Unsupported token ${symbol}`);
  }

  const config = COINPAPRIKA_TIME_CONFIG[timeRange];
  const url = `${COINPAPRIKA_BASE}/tickers/${coinId}/historical?start=${config.getStartDate()}&interval=${config.interval}`;
  
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`CoinPaprika API error: ${response.status}`);
  }

  const rawData = await response.json();
  if (!Array.isArray(rawData) || rawData.length === 0) {
    throw new Error('CoinPaprika: No historical data');
  }

  return rawData.map((point: { timestamp: string; price: number }) => ({
    timestamp: new Date(point.timestamp).getTime(),
    price: point.price,
  }));
}

async function fetchCoinpaprikaMetadata(symbol: string): Promise<TokenMetadata> {
  const coinId = SYMBOL_TO_COINPAPRIKA_ID[symbol.toUpperCase()];
  if (!coinId) {
    throw new Error(`CoinPaprika: Unsupported token ${symbol}`);
  }

  const [tickerRes, coinRes] = await Promise.all([
    fetchWithTimeout(`${COINPAPRIKA_BASE}/tickers/${coinId}`),
    fetchWithTimeout(`${COINPAPRIKA_BASE}/coins/${coinId}`),
  ]);

  if (!tickerRes.ok) {
    throw new Error(`CoinPaprika ticker error: ${tickerRes.status}`);
  }

  const ticker = await tickerRes.json();
  let description = '';
  let websiteUrl: string | null = null;

  if (coinRes.ok) {
    const coin = await coinRes.json();
    description = coin.description || '';
    websiteUrl = coin.links?.website?.[0] || null;
  }

  return {
    description,
    marketCap: ticker.quotes?.USD?.market_cap || null,
    totalSupply: ticker.total_supply,
    circulatingSupply: ticker.circulating_supply,
    websiteUrl,
    fetchedAt: Date.now(),
  };
}

// ============================================================================
// CoinGecko Provider Functions (Fallback)
// ============================================================================

async function fetchCoingeckoPriceHistory(
  symbol: string,
  timeRange: TimeRange
): Promise<PricePoint[]> {
  const coinId = SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()];
  if (!coinId) {
    throw new Error(`CoinGecko: Unsupported token ${symbol}`);
  }

  const days = getCoingeckoDays(timeRange);
  const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const rawData = await response.json();
  if (!rawData.prices || !Array.isArray(rawData.prices)) {
    throw new Error('CoinGecko: Invalid response');
  }

  let data: PricePoint[] = rawData.prices.map(([timestamp, price]: [number, number]) => ({
    timestamp,
    price,
  }));

  // For 1H, filter to last hour
  if (timeRange === '1H') {
    data = filterToLastHours(data, 1);
  }

  return data;
}

async function fetchCoingeckoMetadata(symbol: string): Promise<TokenMetadata> {
  const coinId = SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()];
  if (!coinId) {
    throw new Error(`CoinGecko: Unsupported token ${symbol}`);
  }

  const url = `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`CoinGecko metadata error: ${response.status}`);
  }

  const data = await response.json();

  return {
    description: data.description?.en || '',
    marketCap: data.market_data?.market_cap?.usd || null,
    totalSupply: data.market_data?.total_supply || null,
    circulatingSupply: data.market_data?.circulating_supply || null,
    websiteUrl: data.links?.homepage?.[0] || null,
    fetchedAt: Date.now(),
  };
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Fetch price history for a token.
 * Uses CoinPaprika as primary provider with CoinGecko fallback.
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

  let data: PricePoint[] | null = null;

  // Try CoinPaprika first
  try {
    data = await fetchCoinpaprikaPriceHistory(symbol, timeRange);
    console.log(`[PriceHistory] CoinPaprika success for ${symbol}`);
  } catch (error) {
    console.warn(`[PriceHistory] CoinPaprika failed for ${symbol}:`, error);
    
    // Fallback to CoinGecko
    try {
      data = await fetchCoingeckoPriceHistory(symbol, timeRange);
      console.log(`[PriceHistory] CoinGecko fallback success for ${symbol}`);
    } catch (fallbackError) {
      console.warn(`[PriceHistory] CoinGecko fallback failed for ${symbol}:`, fallbackError);
      return null;
    }
  }

  if (!data || data.length === 0) {
    return null;
  }

  const priceChange = calculatePriceChange(data);

  const result: PriceHistoryData = {
    data,
    symbol: symbol.toUpperCase(),
    timeRange,
    fetchedAt: Date.now(),
    priceChange,
  };

  historyCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

/**
 * Fetch token metadata (description, market cap, supply).
 * Uses CoinPaprika as primary provider with CoinGecko fallback.
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

  let result: TokenMetadata | null = null;

  // Try CoinPaprika first
  try {
    result = await fetchCoinpaprikaMetadata(symbol);
    console.log(`[PriceHistory] CoinPaprika metadata success for ${symbol}`);
  } catch (error) {
    console.warn(`[PriceHistory] CoinPaprika metadata failed for ${symbol}:`, error);
    
    // Fallback to CoinGecko
    try {
      result = await fetchCoingeckoMetadata(symbol);
      console.log(`[PriceHistory] CoinGecko metadata fallback success for ${symbol}`);
    } catch (fallbackError) {
      console.warn(`[PriceHistory] CoinGecko metadata fallback failed for ${symbol}:`, fallbackError);
      return null;
    }
  }

  if (result) {
    metadataCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  }

  return result;
}

/**
 * Clear all caches
 */
export function clearPriceHistoryCache(): void {
  historyCache.clear();
  metadataCache.clear();
}

// ============================================================================
// Formatting Utilities
// ============================================================================

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
