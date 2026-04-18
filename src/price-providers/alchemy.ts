/**
 * @fileoverview Alchemy Prices API provider (priority 0 — tried first).
 *
 * Replaces CoinGecko for current-price lookups (symbol + contract address).
 * CoinGecko stays for historical charts and token metadata (Alchemy Prices
 * doesn't cover circulating/total supply, ATH/ATL, or description — which
 * the mobile token-detail screen renders).
 *
 * @responsibilities
 * - Fetch current USD price by symbol (`GET /tokens/by-symbol`)
 * - Fetch current USD price by contract address (`POST /tokens/by-address`)
 * - Short-circuit `getPriceHistory` / `getTokenMetadata` so the manager falls
 *   through to CoinGecko without a wasted HTTP round-trip
 *
 * @security
 * - URL-embedded `ALCHEMY_API_KEY` matches the RPC and Transfers paths.
 *   Key is redacted from console output via `src/utils/redact-logs.ts`.
 *   Browser DevTools Network tab still shows the URL (inherent); dashboard
 *   allowlists (referrer / bundle id) are the real defense.
 */

import type {
  PriceProvider,
  CurrentPriceResult,
  PriceHistoryResult,
  TimeRange,
  TokenMetadataResult,
} from './types.js';

// ============================================================================
// Runtime configuration
// ============================================================================

/**
 * Runtime-configurable API key for environments where build-time inlining
 * isn't used (React Native / Hermes). Mirrors the `setCoingeckoApiKey`
 * pattern so the extension and mobile entry points can pass the key in at
 * init time.
 */
let configuredApiKey: string | undefined;

/**
 * Register the Alchemy API key at runtime. Call at app startup in the
 * extension service worker and mobile WalletBridge; the CLI picks up
 * `process.env.ALCHEMY_API_KEY` automatically via dotenv.
 *
 * @param apiKey - Alchemy key (same one used for RPC + Transfers).
 */
export function setAlchemyApiKey(apiKey: string | undefined): void {
  configuredApiKey = apiKey;
}

function resolveApiKey(): string | undefined {
  return (
    configuredApiKey ??
    (typeof process !== 'undefined' ? process.env?.ALCHEMY_API_KEY : undefined)
  );
}

// ============================================================================
// Constants
// ============================================================================

const ALCHEMY_PRICES_BASE = 'https://api.g.alchemy.com/prices/v1';
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Symbols Alchemy Prices is known to handle well (major natives, top
 * stablecoins, top DeFi). Anything outside this set goes straight to
 * CoinGecko via `supportsToken` returning false — avoids per-request
 * warn noise from tokens Alchemy won't have.
 *
 * Keep this list in rough parity with {@link SYMBOL_TO_COINGECKO_ID} in
 * `coingecko.ts`; any new addition there is a candidate for addition here.
 */
const SUPPORTED_SYMBOLS: ReadonlySet<string> = new Set([
  // Native / L1s
  'ETH', 'BTC', 'SOL', 'XRP', 'TON', 'MATIC', 'POL', 'AVAX', 'BNB',
  'DOGE', 'ADA', 'DOT', 'TRX', 'LTC', 'ATOM', 'NEAR',
  // Stablecoins
  'USDC', 'USDT', 'DAI', 'FRAX', 'TUSD', 'USDS',
  // Popular DeFi / governance
  'LINK', 'UNI', 'AAVE', 'CRV', 'MKR', 'COMP', 'SNX', 'SUSHI',
  // Popular alts
  'PEPE', 'SHIB', 'WBTC', 'WETH', 'STETH', 'WSTETH',
  // Solana ecosystem (relevant because this wallet supports SPL)
  'RAY', 'JUP', 'JTO', 'BONK', 'ORCA',
]);

/**
 * Maps EVM chain IDs to Alchemy Prices-by-address network slugs.
 * Same slugs we use for RPC / Transfers (`references/operational-supported-networks.md`).
 */
const CHAIN_ID_TO_ALCHEMY_SLUG: Record<number, string> = {
  1: 'eth-mainnet',
  11155111: 'eth-sepolia',
  137: 'polygon-mainnet',
  42161: 'arb-mainnet',
  10: 'opt-mainnet',
  8453: 'base-mainnet',
  56: 'bnb-mainnet',
  43114: 'avax-mainnet',
  59144: 'linea-mainnet',
};

// ============================================================================
// API response types
// ============================================================================

interface AlchemyPriceEntry {
  currency: string;
  value: string;
  lastUpdatedAt?: string;
}

interface AlchemyBySymbolResponse {
  data?: Array<{
    symbol: string;
    prices?: AlchemyPriceEntry[];
    error?: { message?: string };
  }>;
}

interface AlchemyByAddressResponse {
  data?: Array<{
    network: string;
    address: string;
    prices?: AlchemyPriceEntry[];
    error?: { message?: string };
  }>;
}

// ============================================================================
// Helpers
// ============================================================================

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeout = REQUEST_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickUsd(prices: AlchemyPriceEntry[] | undefined): number | null {
  if (!prices) return null;
  for (const entry of prices) {
    if (entry.currency?.toLowerCase() === 'usd') {
      const n = Number.parseFloat(entry.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// ============================================================================
// Provider
// ============================================================================

export class AlchemyPriceProvider implements PriceProvider {
  readonly name = 'Alchemy';
  readonly priority = 0; // Tried before CoinGecko (1) and CoinPaprika (2).

  supportsToken(symbol: string): boolean {
    return SUPPORTED_SYMBOLS.has(symbol.toUpperCase());
  }

  async getCurrentPrice(symbol: string): Promise<CurrentPriceResult> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error('Alchemy: ALCHEMY_API_KEY not set');
    }

    const url = `${ALCHEMY_PRICES_BASE}/${apiKey}/tokens/by-symbol?symbols=${encodeURIComponent(symbol)}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Alchemy: by-symbol HTTP ${response.status}`);
    }

    const body = (await response.json()) as AlchemyBySymbolResponse;
    const entry = body.data?.[0];
    if (!entry || entry.error) {
      throw new Error(`Alchemy: no price for ${symbol}${entry?.error?.message ? ` (${entry.error.message})` : ''}`);
    }

    const price = pickUsd(entry.prices);
    if (price === null) {
      throw new Error(`Alchemy: no USD price for ${symbol}`);
    }
    return { price };
  }

  async getTokenPriceByContract(
    chainId: number,
    contractAddress: string,
  ): Promise<CurrentPriceResult> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error('Alchemy: ALCHEMY_API_KEY not set');
    }

    const network = CHAIN_ID_TO_ALCHEMY_SLUG[chainId];
    if (!network) {
      throw new Error(`Alchemy: no slug mapped for chainId ${chainId}`);
    }

    const url = `${ALCHEMY_PRICES_BASE}/${apiKey}/tokens/by-address`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [{ network, address: contractAddress }] }),
    });
    if (!response.ok) {
      throw new Error(`Alchemy: by-address HTTP ${response.status}`);
    }

    const body = (await response.json()) as AlchemyByAddressResponse;
    const entry = body.data?.[0];
    if (!entry || entry.error) {
      throw new Error(
        `Alchemy: no price for ${network}:${contractAddress}${entry?.error?.message ? ` (${entry.error.message})` : ''}`,
      );
    }

    const price = pickUsd(entry.prices);
    if (price === null) {
      throw new Error(`Alchemy: no USD price for ${network}:${contractAddress}`);
    }
    return { price };
  }

  /**
   * Not implemented — Alchemy's `/tokens/historical` exists but CoinGecko
   * remains the source of truth for charts (already working, returns the
   * same shape consumers expect). Throws fast so the manager falls through
   * without a wasted HTTP round-trip.
   */
  async getPriceHistory(_symbol: string, _timeRange: TimeRange): Promise<PriceHistoryResult> {
    throw new Error('Alchemy: getPriceHistory not implemented (use CoinGecko)');
  }

  /**
   * Not implemented — Alchemy Prices has no equivalent for description,
   * circulating supply, total supply, or ATH/ATL fields that the mobile
   * token-detail screen renders. Throws fast so the manager falls through.
   */
  async getTokenMetadata(_symbol: string): Promise<TokenMetadataResult> {
    throw new Error('Alchemy: getTokenMetadata not implemented (use CoinGecko)');
  }
}
