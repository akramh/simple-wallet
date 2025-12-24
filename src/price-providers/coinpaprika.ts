/**
 * @fileoverview CoinPaprika price provider implementation.
 *
 * Fallback price data provider with generous free tier (20K calls/month).
 * Supports current prices, price history, and token metadata.
 * Does not support contract-based ERC-20 lookups.
 *
 * @responsibilities
 * - Fetch current token prices from CoinPaprika API
 * - Fetch historical price data for charts
 * - Fetch token metadata (market cap, supply, description)
 * - Map token symbols to CoinPaprika IDs
 *
 * @security
 * - No sensitive data handled
 * - Read-only API calls
 * - No API key required for free tier
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

const COINPAPRIKA_BASE = 'https://api.coinpaprika.com/v1';

/** Request timeout: 15 seconds */
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Maps common token symbols to CoinPaprika IDs.
 * Format: {symbol}-{name}
 */
const SYMBOL_TO_COINPAPRIKA_ID: Record<string, string> = {
  // Native tokens
  ETH: 'eth-ethereum',
  BTC: 'btc-bitcoin',
  SOL: 'sol-solana',
  XRP: 'xrp-xrp',
  TON: 'ton-toncoin',
  MATIC: 'matic-polygon',
  AVAX: 'avax-avalanche',
  BNB: 'bnb-binance-coin',
  DOGE: 'doge-dogecoin',
  ADA: 'ada-cardano',
  DOT: 'dot-polkadot',
  TRX: 'trx-tron',
  SHIB: 'shib-shiba-inu',
  LTC: 'ltc-litecoin',
  ATOM: 'atom-cosmos',
  NEAR: 'near-near-protocol',
  FTM: 'ftm-fantom',

  // Stablecoins
  USDC: 'usdc-usd-coin',
  USDT: 'usdt-tether',
  DAI: 'dai-dai',
  BUSD: 'busd-binance-usd',
  FRAX: 'frax-frax',
  TUSD: 'tusd-trueusd',

  // Popular DeFi tokens
  LINK: 'link-chainlink',
  UNI: 'uni-uniswap',
  AAVE: 'aave-aave',
  CRV: 'crv-curve-dao-token',
  MKR: 'mkr-maker',
  COMP: 'comp-compound',
  SNX: 'snx-synthetix-network-token',
  SUSHI: 'sushi-sushi',
  YFI: 'yfi-yearnfinance',
  '1INCH': '1inch-1inch',
  LDO: 'ldo-lido-dao',
  RPL: 'rpl-rocket-pool',
  GRT: 'grt-the-graph',
  ENS: 'ens-ethereum-name-service',
  APE: 'ape-apecoin',
  PEPE: 'pepe-pepe',
  ARB: 'arb-arbitrum',
  OP: 'op-optimism',

  // Wrapped tokens
  WETH: 'weth-weth',
  WBTC: 'wbtc-wrapped-bitcoin',
  stETH: 'steth-lido-staked-ether',
  cbETH: 'cbeth-coinbase-wrapped-staked-eth',
  rETH: 'reth-rocket-pool-eth',
};

/**
 * Maps TimeRange to CoinPaprika interval and start date calculation.
 */
interface TimeRangeConfig {
  interval: string;
  getStartDate: () => string;
}

const TIME_RANGE_CONFIG: Record<TimeRange, TimeRangeConfig> = {
  '1H': {
    interval: '5m',
    getStartDate: () => {
      const date = new Date(Date.now() - 60 * 60 * 1000);
      return date.toISOString();
    },
  },
  '1D': {
    interval: '1h',
    getStartDate: () => {
      const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return date.toISOString();
    },
  },
  '1W': {
    interval: '6h',
    getStartDate: () => {
      const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    },
  },
  '1M': {
    interval: '1d',
    getStartDate: () => {
      const date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return date.toISOString();
    },
  },
  YTD: {
    interval: '1d',
    getStartDate: () => {
      const now = new Date();
      return new Date(now.getFullYear(), 0, 1).toISOString();
    },
  },
  ALL: {
    interval: '7d',
    getStartDate: () => '2013-01-01T00:00:00Z',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch with timeout helper.
 */
async function fetchWithTimeout(
  url: string,
  timeout = REQUEST_TIMEOUT
): Promise<Response> {
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
 * Get CoinPaprika ID for a token symbol.
 */
function getCoinPaprikaId(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_TO_COINPAPRIKA_ID[upperSymbol] || null;
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
// CoinPaprika API Response Types
// ============================================================================

interface CoinPaprikaTickerResponse {
  id: string;
  name: string;
  symbol: string;
  quotes: {
    USD: {
      price: number;
      percent_change_24h: number;
      market_cap: number;
      volume_24h: number;
    };
  };
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
}

interface CoinPaprikaHistoricalPoint {
  timestamp: string;
  price: number;
  volume_24h: number;
  market_cap: number;
}

interface CoinPaprikaCoinResponse {
  id: string;
  name: string;
  symbol: string;
  description: string;
  links: {
    website?: string[];
  };
}

// ============================================================================
// CoinPaprika Provider
// ============================================================================

/**
 * CoinPaprika price provider.
 *
 * Fallback provider with generous free tier (20,000 calls/month).
 * Does not support contract-based ERC-20 lookups.
 *
 * @example
 * ```typescript
 * const provider = new CoinPaprikaProvider();
 *
 * if (provider.supportsToken('ETH')) {
 *   const price = await provider.getCurrentPrice('ETH');
 *   console.log(price.price); // 3500.00
 * }
 * ```
 */
export class CoinPaprikaProvider implements PriceProvider {
  readonly name = 'CoinPaprika';
  readonly priority = 2; // Fallback provider (no API key required)

  /**
   * Check if this provider supports the given token.
   */
  supportsToken(symbol: string): boolean {
    return getCoinPaprikaId(symbol) !== null;
  }

  /**
   * Get current price for a token.
   *
   * @param symbol - Token symbol (e.g., "ETH", "BTC")
   * @throws Error if token not supported or API fails
   */
  async getCurrentPrice(symbol: string): Promise<CurrentPriceResult> {
    const coinId = getCoinPaprikaId(symbol);
    if (!coinId) {
      throw new Error(`CoinPaprika: Unsupported token ${symbol}`);
    }

    const url = `${COINPAPRIKA_BASE}/tickers/${coinId}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinPaprika API error: ${response.status}`);
    }

    const data = (await response.json()) as CoinPaprikaTickerResponse;

    return {
      price: data.quotes.USD.price,
      change24h: data.quotes.USD.percent_change_24h,
    };
  }

  /**
   * CoinPaprika does not support contract-based lookups.
   * This method is not implemented.
   */
  // getTokenPriceByContract is not supported by CoinPaprika free tier

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
    const coinId = getCoinPaprikaId(symbol);
    if (!coinId) {
      throw new Error(`CoinPaprika: Unsupported token ${symbol}`);
    }

    const config = TIME_RANGE_CONFIG[timeRange];
    const startDate = config.getStartDate();

    const url = `${COINPAPRIKA_BASE}/tickers/${coinId}/historical?start=${startDate}&interval=${config.interval}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinPaprika history API error: ${response.status}`);
    }

    const rawData = (await response.json()) as CoinPaprikaHistoricalPoint[];

    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('CoinPaprika: No historical data available');
    }

    // Convert to our format
    const data: PricePoint[] = rawData.map((point) => ({
      timestamp: new Date(point.timestamp).getTime(),
      price: point.price,
    }));

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
    const coinId = getCoinPaprikaId(symbol);
    if (!coinId) {
      throw new Error(`CoinPaprika: Unsupported token ${symbol}`);
    }

    // Fetch both ticker (for market data) and coin info (for description)
    const [tickerResponse, coinResponse] = await Promise.all([
      fetchWithTimeout(`${COINPAPRIKA_BASE}/tickers/${coinId}`),
      fetchWithTimeout(`${COINPAPRIKA_BASE}/coins/${coinId}`),
    ]);

    if (!tickerResponse.ok) {
      throw new Error(`CoinPaprika ticker API error: ${tickerResponse.status}`);
    }

    const tickerData = (await tickerResponse.json()) as CoinPaprikaTickerResponse;

    let description = '';
    let websiteUrl: string | null = null;

    if (coinResponse.ok) {
      const coinData = (await coinResponse.json()) as CoinPaprikaCoinResponse;
      description = coinData.description || '';
      websiteUrl = coinData.links?.website?.[0] || null;
    }

    return {
      description,
      marketCap: tickerData.quotes.USD.market_cap || null,
      totalSupply: tickerData.total_supply,
      circulatingSupply: tickerData.circulating_supply,
      websiteUrl,
    };
  }
}
