/**
 * @file price-service.ts
 * @description Token price fetching service with multi-provider fallback.
 *
 * Provides real-time USD prices for native tokens and ERC-20 tokens
 * using CoinPaprika (primary) with CoinGecko fallback.
 *
 * @responsibilities
 * - Fetch current prices for native tokens by chain ID
 * - Fetch current prices for ERC-20 tokens by contract address
 * - Fetch price history for charts
 * - Fetch token metadata (market cap, supply, description)
 * - Calculate transaction costs in USD
 *
 * @security
 * - No sensitive data handled
 * - Read-only API calls
 */

import {
  priceProviderManager,
  type TimeRange,
  type PriceHistoryResult,
  type TokenMetadataResult,
  type PricePoint,
  CHAIN_TO_PLATFORM,
} from './price-providers/index.js';

// ============================================================================
// Types
// ============================================================================

export interface TokenPriceInfo {
  address?: string; // Contract address for ERC-20, undefined for native
  symbol: string;
  price: number | null; // USD price, null if unavailable
  lastUpdated: number;
}

export interface PriceCache {
  [key: string]: {
    // key: 'native' or lowercase contract address
    price: number;
    lastUpdated: number;
  };
}

/**
 * Token info for price fetching
 */
export interface TokenInfo {
  type: 'native' | 'erc20';
  symbol: string;
  address?: string;
  decimals?: number;
}

/**
 * Transaction cost breakdown in USD
 */
export interface TransactionCosts {
  /** USD value of the amount being sent (null if price unavailable) */
  amountUsd: number | null;
  /** USD value of gas cost (null if price unavailable) */
  gasCostUsd: number | null;
  /** Total USD cost: amount + gas (null if either unavailable) */
  totalUsd: number | null;
}

// Re-export types from price-providers
export type { TimeRange, PriceHistoryResult, TokenMetadataResult, PricePoint };

// ============================================================================
// Constants
// ============================================================================

/** Cache TTL: 60 seconds (for legacy cache) */
const CACHE_TTL = 60 * 1000;

/**
 * Maps chain IDs to native token symbols
 */
const CHAIN_TO_NATIVE_SYMBOL: Record<number, string> = {
  1: 'ETH',
  56: 'BNB',
  137: 'MATIC',
  43114: 'AVAX',
  42161: 'ETH', // Arbitrum uses ETH
  10: 'ETH', // Optimism uses ETH
  8453: 'ETH', // Base uses ETH
  59144: 'ETH', // Linea uses ETH
  11155111: 'ETH', // Sepolia testnet
};

/**
 * Maps Bitcoin network keys to symbol
 */
const BITCOIN_NETWORK_TO_ID: Record<string, string> = {
  'bitcoin-mainnet': 'bitcoin',
  'bitcoin-testnet': 'bitcoin',
};

/**
 * Maps Solana network keys to symbol
 */
const SOLANA_NETWORK_TO_ID: Record<string, string> = {
  'solana-mainnet': 'solana',
  'solana-devnet': 'solana',
};

/**
 * Maps XRP network keys to symbol
 */
const XRP_NETWORK_TO_ID: Record<string, string> = {
  'xrp-mainnet': 'ripple',
  'xrp-testnet': 'ripple',
  'xrp-devnet': 'ripple',
};

/**
 * Maps TON network keys to symbol
 */
const TON_NETWORK_TO_ID: Record<string, string> = {
  'ton-mainnet': 'ton',
  'ton-testnet': 'ton',
};

// ============================================================================
// Legacy Price Cache (for ERC-20 batch operations)
// ============================================================================

/** Price cache: chainId -> tokenKey -> price info */
const priceCache: Record<number, PriceCache> = {};

function getCachedPrice(chainId: number, tokenKey: string): number | null {
  const networkCache = priceCache[chainId];
  if (!networkCache) return null;

  const cached = networkCache[tokenKey];
  if (!cached) return null;

  // Check if cache is still valid
  if (Date.now() - cached.lastUpdated > CACHE_TTL) {
    return null;
  }

  return cached.price;
}

function setCachedPrice(chainId: number, tokenKey: string, price: number): void {
  if (!priceCache[chainId]) {
    priceCache[chainId] = {};
  }
  priceCache[chainId][tokenKey] = {
    price,
    lastUpdated: Date.now(),
  };
}

// ============================================================================
// Current Price Functions
// ============================================================================

/**
 * Fetches the native token price for a given chain.
 * Uses provider manager with CoinPaprika primary, CoinGecko fallback.
 *
 * @param chainId - EVM chain ID
 * @returns USD price or null if unavailable
 */
export async function getNativeTokenPrice(chainId: number): Promise<number | null> {
  const symbol = CHAIN_TO_NATIVE_SYMBOL[chainId];
  if (!symbol) {
    console.warn(`[PriceService] No symbol for chainId ${chainId}`);
    return null;
  }

  const result = await priceProviderManager.getCurrentPrice(symbol);
  return result?.price ?? null;
}

/**
 * Fetches the Bitcoin price.
 * Works for both bitcoin-mainnet and bitcoin-testnet (uses mainnet price).
 *
 * @param networkKey - Bitcoin network key (e.g., 'bitcoin-mainnet')
 * @returns Bitcoin price in USD, or null if unavailable
 */
export async function getBitcoinPrice(networkKey?: string): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('BTC');
  return result?.price ?? null;
}

/**
 * Check if a network key is a Bitcoin network.
 */
export function isBitcoinNetworkKey(networkKey: string): boolean {
  return networkKey in BITCOIN_NETWORK_TO_ID;
}

/**
 * Check if a network key is a Solana network.
 */
export function isSolanaNetworkKey(networkKey: string): boolean {
  return networkKey in SOLANA_NETWORK_TO_ID;
}

/**
 * Check if a network key is an XRP network.
 */
export function isXRPNetworkKey(networkKey: string): boolean {
  return networkKey in XRP_NETWORK_TO_ID;
}

/**
 * Check if a network key is a TON network.
 */
export function isTonNetworkKey(networkKey: string): boolean {
  return networkKey in TON_NETWORK_TO_ID;
}

/**
 * Fetches the Solana price.
 * Works for both solana-mainnet and solana-devnet (uses mainnet price).
 *
 * @param networkKey - Solana network key (e.g., 'solana-mainnet')
 * @returns Solana price in USD, or null if unavailable
 */
export async function getSolanaPrice(networkKey?: string): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('SOL');
  return result?.price ?? null;
}

/**
 * Fetches the XRP price.
 * Works for xrp-mainnet, xrp-testnet, and xrp-devnet (uses mainnet price).
 *
 * @param networkKey - XRP network key (e.g., 'xrp-mainnet')
 * @returns XRP price in USD, or null if unavailable
 */
export async function getXRPPrice(networkKey?: string): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('XRP');
  return result?.price ?? null;
}

/**
 * Fetches the TON price.
 * Works for ton-mainnet and ton-testnet (uses mainnet price).
 *
 * @param networkKey - TON network key (e.g., 'ton-mainnet')
 * @returns TON price in USD, or null if unavailable
 */
export async function getTonPrice(networkKey?: string): Promise<number | null> {
  const result = await priceProviderManager.getCurrentPrice('TON');
  return result?.price ?? null;
}

/**
 * Fetches the price for an ERC-20 token by contract address.
 * Uses provider manager with fallback.
 *
 * @param chainId - EVM chain ID
 * @param contractAddress - Token contract address
 * @returns USD price or null if unavailable
 */
export async function getERC20TokenPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  const result = await priceProviderManager.getTokenPriceByContract(chainId, contractAddress);
  return result?.price ?? null;
}

/**
 * Fetches prices for multiple ERC-20 tokens in batched requests.
 * Falls back to individual fetches via provider manager.
 *
 * @param chainId - EVM chain ID
 * @param contractAddresses - Array of token contract addresses
 * @param chunkSize - Number of addresses per batch (default 50)
 * @returns Map of address -> price (null if unavailable)
 */
export async function getERC20TokenPricesBatch(
  chainId: number,
  contractAddresses: string[],
  chunkSize: number = 50
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  const platform = CHAIN_TO_PLATFORM[chainId];
  if (!platform) {
    return results;
  }

  // Check cache first, collect addresses that need fetching
  const toFetch: string[] = [];
  for (const addr of contractAddresses) {
    const key = addr.toLowerCase();
    const cached = getCachedPrice(chainId, key);
    if (cached !== null) {
      results.set(key, cached);
    } else {
      toFetch.push(key);
    }
  }

  // Fetch remaining via provider manager
  for (const addr of toFetch) {
    const result = await priceProviderManager.getTokenPriceByContract(chainId, addr);
    const price = result?.price ?? null;
    results.set(addr, price);

    if (price !== null) {
      setCachedPrice(chainId, addr, price);
    }
  }

  return results;
}

/**
 * Fetches prices for multiple tokens.
 * Returns a map of tokenKey -> price (null if unavailable).
 *
 * @param chainId - EVM chain ID
 * @param tokens - Array of token info objects
 * @returns Map of token key -> price
 */
export async function getTokenPrices(
  chainId: number,
  tokens: TokenInfo[]
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();

  // Separate native and ERC-20 tokens
  const nativeToken = tokens.find((t) => t.type === 'native');
  const erc20Tokens = tokens.filter((t) => t.type === 'erc20' && t.address);

  // Fetch native token price first
  if (nativeToken) {
    const price = await getNativeTokenPrice(chainId);
    results.set('native', price);
  }

  // Fetch ERC-20 prices
  const addresses = erc20Tokens.map((t) => t.address!.toLowerCase()).filter(Boolean);

  if (addresses.length) {
    const batchPrices = await getERC20TokenPricesBatch(chainId, addresses);
    for (const [addr, price] of batchPrices.entries()) {
      results.set(addr, price);
    }
  }

  return results;
}

// ============================================================================
// Price History Functions (NEW)
// ============================================================================

/**
 * Fetch price history for a token.
 * Uses provider manager with CoinPaprika primary, CoinGecko fallback.
 *
 * @param symbol - Token symbol (e.g., "ETH", "BTC")
 * @param timeRange - Time range for history (1H, 1D, 1W, 1M, YTD, ALL)
 * @returns Price history data or null if unavailable
 */
export async function getPriceHistory(
  symbol: string,
  timeRange: TimeRange
): Promise<PriceHistoryResult | null> {
  return priceProviderManager.getPriceHistory(symbol, timeRange);
}

/**
 * Fetch token metadata (market cap, supply, description).
 * Uses provider manager with CoinPaprika primary, CoinGecko fallback.
 *
 * @param symbol - Token symbol (e.g., "ETH", "BTC")
 * @returns Token metadata or null if unavailable
 */
export async function getTokenMetadata(symbol: string): Promise<TokenMetadataResult | null> {
  return priceProviderManager.getTokenMetadata(symbol);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate total portfolio value in USD.
 *
 * @param balances - Array of token balances
 * @param prices - Map of token key -> price
 * @returns Total USD value
 */
export function calculateTotalValue(
  balances: Array<{ token: TokenInfo; balance: string }>,
  prices: Map<string, number | null>
): number {
  let total = 0;

  for (const { token, balance } of balances) {
    const priceKey = token.type === 'native' ? 'native' : token.address?.toLowerCase();
    if (!priceKey) continue;

    const price = prices.get(priceKey);
    if (price === null || price === undefined) continue;

    const balanceNum = parseFloat(balance);
    if (isNaN(balanceNum)) continue;

    total += balanceNum * price;
  }

  return total;
}

/**
 * Format USD value for display.
 *
 * @param value - USD value
 * @returns Formatted string (e.g., "$1,234.56", "<$0.01", "$1.23M")
 */
export function formatUSDValue(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
  if (value < 1000) {
    return `$${value.toFixed(2)}`;
  }
  if (value < 1000000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  // Millions
  return `$${(value / 1000000).toFixed(2)}M`;
}

/**
 * Clear the price cache (useful for testing or forcing refresh).
 * Clears both the legacy cache and the provider manager cache.
 */
export function clearPriceCache(): void {
  // Clear legacy cache
  for (const key of Object.keys(priceCache)) {
    delete priceCache[Number(key)];
  }

  // Clear provider manager cache
  priceProviderManager.clearCache();
}

// ============================================================================
// Transaction Cost Calculations
// ============================================================================

/**
 * Calculate USD costs for a transaction.
 * Shared by CLI and extension to avoid code duplication.
 *
 * @param amount - Amount being sent (as string)
 * @param tokenPrice - USD price of the token being sent (null if unavailable)
 * @param gasCostNative - Gas cost in native token units (as string)
 * @param nativePrice - USD price of the native token (null if unavailable)
 * @returns Transaction costs breakdown
 *
 * @example
 * ```typescript
 * const costs = calculateTransactionCosts('0.5', 2500, '0.002', 2500);
 * // { amountUsd: 1250, gasCostUsd: 5, totalUsd: 1255 }
 * ```
 */
export function calculateTransactionCosts(
  amount: string,
  tokenPrice: number | null,
  gasCostNative: string,
  nativePrice: number | null
): TransactionCosts {
  // Calculate amount USD
  const amountNum = parseFloat(amount);
  const amountUsd = tokenPrice !== null && !isNaN(amountNum) ? amountNum * tokenPrice : null;

  // Calculate gas USD
  const gasCostNum = parseFloat(gasCostNative);
  const gasCostUsd = nativePrice !== null && !isNaN(gasCostNum) ? gasCostNum * nativePrice : null;

  // Calculate total USD
  let totalUsd: number | null = null;
  if (amountUsd !== null && gasCostUsd !== null) {
    totalUsd = amountUsd + gasCostUsd;
  } else if (amountUsd !== null) {
    totalUsd = amountUsd;
  }

  return { amountUsd, gasCostUsd, totalUsd };
}
