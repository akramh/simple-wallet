/**
 * @fileoverview CoinGecko price provider implementation.
 *
 * Fallback price data provider. Widely supported but has strict rate limits
 * on free tier (~10-30 calls/minute without API key).
 *
 * @responsibilities
 * - Fetch current token prices from CoinGecko API
 * - Fetch historical price data for charts
 * - Fetch token metadata (market cap, supply, description)
 * - Support ERC-20 token lookups by contract address
 * - Map token symbols to CoinGecko IDs
 *
 * @security
 * - No sensitive data handled
 * - Read-only API calls
 * - Optional API key support via environment variable
 */

import type {
  PriceProvider,
  CurrentPriceResult,
  PriceHistoryResult,
  TokenMetadataResult,
  TimeRange,
  PricePoint,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Request timeout: 15 seconds */
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Maps common token symbols to CoinGecko IDs.
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
  DOGE: 'dogecoin',
  ADA: 'cardano',
  DOT: 'polkadot',
  TRX: 'tron',
  SHIB: 'shiba-inu',
  LTC: 'litecoin',
  ATOM: 'cosmos',
  NEAR: 'near',
  FTM: 'fantom',

  // Stablecoins
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  BUSD: 'binance-usd',
  FRAX: 'frax',
  TUSD: 'true-usd',

  // Popular DeFi tokens
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
  PEPE: 'pepe',
  ARB: 'arbitrum',
  OP: 'optimism',

  // Wrapped tokens
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
  stETH: 'staked-ether',
  cbETH: 'coinbase-wrapped-staked-eth',
  rETH: 'rocket-pool-eth',
};

/**
 * Maps chain IDs to CoinGecko platform IDs for ERC-20 token lookups.
 */
const CHAIN_TO_PLATFORM: Record<number, string> = {
  1: 'ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  43114: 'avalanche',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  8453: 'base',
  59144: 'linea',
  11155111: 'ethereum', // Sepolia testnet
};

/**
 * Maps TimeRange to CoinGecko days parameter.
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
// Helper Functions
// ============================================================================

/**
 * Calculate days since start of year for YTD range.
 */
function calculateYTDDays(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diffTime = Math.abs(now.getTime() - startOfYear.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Fetch with timeout and optional API key header.
 */
async function fetchWithTimeout(
  url: string,
  timeout = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const headers: Record<string, string> = {};
  // Support optional API key for better rate limits
  const apiKey = typeof process !== 'undefined' ? process.env?.COINGECKO_API_KEY : undefined;
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Get CoinGecko ID for a token symbol.
 */
function getCoinGeckoId(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_TO_COINGECKO_ID[upperSymbol] || null;
}

/**
 * Filter price data to last N hours.
 */
function filterToLastHours(data: PricePoint[], hours: number): PricePoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return data.filter((point) => point.timestamp >= cutoff);
}

/**
 * Calculate price change between first and last points.
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
// CoinGecko API Response Types
// ============================================================================

interface CoinGeckoSimplePriceResponse {
  [coinId: string]:
    | {
        usd?: number;
        usd_24h_change?: number;
      }
    | undefined;
}

interface CoinGeckoMarketChartResponse {
  prices?: [number, number][];
}

interface CoinGeckoCoinResponse {
  description?: { en?: string };
  market_data?: {
    market_cap?: { usd?: number };
    total_supply?: number;
    circulating_supply?: number;
  };
  links?: {
    homepage?: string[];
  };
}

// ============================================================================
// CoinGecko Provider
// ============================================================================

/**
 * CoinGecko price provider.
 *
 * Fallback provider with wide token support. Free tier has stricter
 * rate limits than CoinPaprika (~10-30 calls/minute).
 *
 * Supports optional API key via COINGECKO_API_KEY environment variable
 * for better rate limits (30 calls/minute with demo key).
 *
 * @example
 * ```typescript
 * const provider = new CoinGeckoProvider();
 *
 * // By symbol
 * const price = await provider.getCurrentPrice('ETH');
 *
 * // By contract address
 * const tokenPrice = await provider.getTokenPriceByContract(1, '0x...');
 * ```
 */
export class CoinGeckoProvider implements PriceProvider {
  readonly name = 'CoinGecko';
  readonly priority = 2; // Fallback provider

  /**
   * Check if this provider supports the given token.
   */
  supportsToken(symbol: string): boolean {
    return getCoinGeckoId(symbol) !== null;
  }

  /**
   * Get current price for a token.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @throws Error if token not supported or API fails
   */
  async getCurrentPrice(symbol: string): Promise<CurrentPriceResult> {
    const coinId = getCoinGeckoId(symbol);
    if (!coinId) {
      throw new Error(`CoinGecko: Unsupported token ${symbol}`);
    }

    const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoSimplePriceResponse;
    const priceData = data[coinId];

    if (!priceData?.usd) {
      throw new Error(`CoinGecko: No price data for ${symbol}`);
    }

    return {
      price: priceData.usd,
      change24h: priceData.usd_24h_change,
    };
  }

  /**
   * Get current price for an ERC-20 token by contract address.
   *
   * @param chainId - EVM chain ID
   * @param contractAddress - Token contract address
   * @throws Error if chain not supported or API fails
   */
  async getTokenPriceByContract(
    chainId: number,
    contractAddress: string
  ): Promise<CurrentPriceResult> {
    const platform = CHAIN_TO_PLATFORM[chainId];
    if (!platform) {
      throw new Error(`CoinGecko: Unsupported chain ${chainId}`);
    }

    const normalizedAddress = contractAddress.toLowerCase();
    const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${normalizedAddress}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinGecko token API error: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoSimplePriceResponse;
    const priceData = data[normalizedAddress];

    if (!priceData?.usd) {
      throw new Error(`CoinGecko: No price data for contract ${contractAddress}`);
    }

    return {
      price: priceData.usd,
      change24h: priceData.usd_24h_change,
    };
  }

  /**
   * Fetch price history for a token.
   *
   * @param symbol - Token symbol
   * @param timeRange - Time range for history
   * @throws Error if token not supported or API fails
   */
  async getPriceHistory(
    symbol: string,
    timeRange: TimeRange
  ): Promise<PriceHistoryResult> {
    const coinId = getCoinGeckoId(symbol);
    if (!coinId) {
      throw new Error(`CoinGecko: Unsupported token ${symbol}`);
    }

    const days = TIME_RANGE_TO_DAYS[timeRange];
    const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinGecko history API error: ${response.status}`);
    }

    const rawData = (await response.json()) as CoinGeckoMarketChartResponse;

    if (!rawData.prices || !Array.isArray(rawData.prices)) {
      throw new Error('CoinGecko: Invalid response format');
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

    return {
      data,
      priceChange,
    };
  }

  /**
   * Fetch token metadata.
   *
   * @param symbol - Token symbol
   * @throws Error if token not supported or API fails
   */
  async getTokenMetadata(symbol: string): Promise<TokenMetadataResult> {
    const coinId = getCoinGeckoId(symbol);
    if (!coinId) {
      throw new Error(`CoinGecko: Unsupported token ${symbol}`);
    }

    const url = `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinGecko metadata API error: ${response.status}`);
    }

    const rawData = (await response.json()) as CoinGeckoCoinResponse;

    return {
      description: rawData.description?.en || '',
      marketCap: rawData.market_data?.market_cap?.usd || null,
      totalSupply: rawData.market_data?.total_supply || null,
      circulatingSupply: rawData.market_data?.circulating_supply || null,
      websiteUrl: rawData.links?.homepage?.[0] || null,
    };
  }
}

// ============================================================================
// Exports for backwards compatibility
// ============================================================================

/**
 * Re-export mappings for use in price-service.ts during transition.
 */
export { SYMBOL_TO_COINGECKO_ID, CHAIN_TO_PLATFORM };

