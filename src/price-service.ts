/**
 * @file price-service.ts
 * @description Token price fetching service using CoinGecko API.
 * 
 * Provides real-time USD prices for native tokens and ERC-20 tokens
 * with caching to minimize API calls and respect rate limits.
 * 
 * @limitations (CoinGecko Free Tier)
 * - ERC-20 token prices: 1 contract per request
 * - Rate limiting: ~10-30 requests/minute
 * - Some tokens may not have price data
 */

// ============================================================================
// Types
// ============================================================================

export interface TokenPriceInfo {
  address?: string;       // Contract address for ERC-20, undefined for native
  symbol: string;
  price: number | null;   // USD price, null if unavailable
  lastUpdated: number;
}

export interface PriceCache {
  [key: string]: {        // key: 'native' or lowercase contract address
    price: number;
    lastUpdated: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Cache TTL: 60 seconds */
const CACHE_TTL = 60 * 1000;

/** Request timeout: 10 seconds */
const REQUEST_TIMEOUT = 10 * 1000;

/**
 * Maps chain IDs to CoinGecko platform IDs for ERC-20 token lookups
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
  11155111: 'ethereum', // Sepolia testnet (no real prices)
};

/**
 * Maps chain IDs to CoinGecko native token IDs
 */
const CHAIN_TO_NATIVE_ID: Record<number, string> = {
  1: 'ethereum',
  56: 'binancecoin',
  137: 'matic-network',
  43114: 'avalanche-2',
  42161: 'ethereum',       // Arbitrum uses ETH
  10: 'ethereum',          // Optimism uses ETH
  8453: 'ethereum',        // Base uses ETH
  59144: 'ethereum',       // Linea uses ETH
  11155111: 'ethereum',    // Sepolia testnet
};

/**
 * Maps Bitcoin network keys to CoinGecko IDs
 */
const BITCOIN_NETWORK_TO_ID: Record<string, string> = {
  'bitcoin-mainnet': 'bitcoin',
  'bitcoin-testnet': 'bitcoin',  // Use mainnet price for testnet display
};

/** Bitcoin price cache (separate from EVM chain cache) */
let bitcoinPriceCache: { price: number; lastUpdated: number } | null = null;

/**
 * Maps Solana network keys to CoinGecko IDs
 */
const SOLANA_NETWORK_TO_ID: Record<string, string> = {
  'solana-mainnet': 'solana',
  'solana-devnet': 'solana', // Use mainnet price for devnet display
};

/** Solana price cache (separate from EVM chain cache) */
let solanaPriceCache: { price: number; lastUpdated: number } | null = null;

// ============================================================================
// Price Cache (per network)
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
// API Functions
// ============================================================================

/**
 * Fetch with timeout helper
 */
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
 * Fetches the native token price for a given chain
 */
export async function getNativeTokenPrice(chainId: number): Promise<number | null> {
  const cacheKey = 'native';
  
  // Check cache first
  const cached = getCachedPrice(chainId, cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  const coinId = CHAIN_TO_NATIVE_ID[chainId];
  if (!coinId) {
    console.warn(`[PriceService] No CoinGecko ID for chainId ${chainId}`);
    return null;
  }
  
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      console.warn(`[PriceService] API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json() as Record<string, { usd?: number } | undefined>;
    const price = data[coinId]?.usd;
    
    if (typeof price === 'number') {
      setCachedPrice(chainId, cacheKey, price);
      return price;
    }
    
    return null;
  } catch (error) {
    console.warn('[PriceService] Failed to fetch native price:', error);
    return null;
  }
}

/**
 * Fetches the Bitcoin price.
 * Works for both bitcoin-mainnet and bitcoin-testnet (uses mainnet price).
 *
 * @param networkKey - Bitcoin network key (e.g., 'bitcoin-mainnet')
 * @returns Bitcoin price in USD, or null if unavailable
 */
export async function getBitcoinPrice(networkKey?: string): Promise<number | null> {
  // Check cache first
  if (bitcoinPriceCache && Date.now() - bitcoinPriceCache.lastUpdated < CACHE_TTL) {
    return bitcoinPriceCache.price;
  }

  const coinId = 'bitcoin';

  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn(`[PriceService] Bitcoin API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, { usd?: number } | undefined>;
    const price = data[coinId]?.usd;

    if (typeof price === 'number') {
      bitcoinPriceCache = { price, lastUpdated: Date.now() };
      return price;
    }

    return null;
  } catch (error) {
    console.warn('[PriceService] Failed to fetch Bitcoin price:', error);
    return null;
  }
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
 * Fetches the Solana price.
 * Works for both solana-mainnet and solana-devnet (uses mainnet price).
 *
 * @param networkKey - Solana network key (e.g., 'solana-mainnet')
 * @returns Solana price in USD, or null if unavailable
 */
export async function getSolanaPrice(networkKey?: string): Promise<number | null> {
  // Check cache first
  if (solanaPriceCache && Date.now() - solanaPriceCache.lastUpdated < CACHE_TTL) {
    return solanaPriceCache.price;
  }

  const coinId = 'solana';

  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      console.warn(`[PriceService] Solana API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, { usd?: number } | undefined>;
    const price = data[coinId]?.usd;

    if (typeof price === 'number') {
      solanaPriceCache = { price, lastUpdated: Date.now() };
      return price;
    }

    return null;
  } catch (error) {
    console.warn('[PriceService] Failed to fetch Solana price:', error);
    return null;
  }
}

/**
 * Fetches the price for an ERC-20 token by contract address
 * Note: CoinGecko free tier limits to 1 contract per request
 */
export async function getERC20TokenPrice(
  chainId: number,
  contractAddress: string
): Promise<number | null> {
  const cacheKey = contractAddress.toLowerCase();
  
  // Check cache first
  const cached = getCachedPrice(chainId, cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  const platform = CHAIN_TO_PLATFORM[chainId];
  if (!platform) {
    console.warn(`[PriceService] No platform for chainId ${chainId}`);
    return null;
  }
  
  try {
    const url = `${COINGECKO_BASE}/simple/token_price/${platform}?contract_addresses=${cacheKey}&vs_currencies=usd`;
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      // Don't spam console for expected rate limits
      if (response.status !== 429) {
        console.warn(`[PriceService] API error: ${response.status}`);
      }
      return null;
    }
    
    const data = await response.json() as Record<string, { usd?: number } | undefined> & { error_code?: number };
    
    // Check for API error response
    if (data.error_code) {
      return null;
    }
    
    const price = data[cacheKey]?.usd;
    
    if (typeof price === 'number') {
      setCachedPrice(chainId, cacheKey, price);
      return price;
    }
    
    return null;
  } catch (error) {
    console.warn('[PriceService] Failed to fetch ERC-20 price:', error);
    return null;
  }
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
 * Fetches prices for multiple tokens
 * Returns a map of tokenKey -> price (null if unavailable)
 * 
 * Due to CoinGecko free tier limitations, ERC-20 tokens are fetched
 * sequentially with a small delay to avoid rate limiting.
 */
export async function getTokenPrices(
  chainId: number,
  tokens: TokenInfo[]
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  
  // Separate native and ERC-20 tokens
  const nativeToken = tokens.find(t => t.type === 'native');
  const erc20Tokens = tokens.filter(t => t.type === 'erc20' && t.address);
  
  // Fetch native token price first
  if (nativeToken) {
    const price = await getNativeTokenPrice(chainId);
    results.set('native', price);
  }
  
  // Fetch ERC-20 prices with delay to avoid rate limits
  for (const token of erc20Tokens) {
    if (token.address) {
      const price = await getERC20TokenPrice(chainId, token.address);
      results.set(token.address.toLowerCase(), price);
      
      // Small delay between requests to be nice to the API
      if (erc20Tokens.indexOf(token) < erc20Tokens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }
  
  return results;
}

/**
 * Calculate total portfolio value in USD
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
 * Format USD value for display
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
 * Clear the price cache (useful for testing or forcing refresh)
 */
export function clearPriceCache(): void {
  for (const key of Object.keys(priceCache)) {
    delete priceCache[Number(key)];
  }
  // Also clear Bitcoin cache
  bitcoinPriceCache = null;
  solanaPriceCache = null;
}

// ============================================================================
// Transaction Cost Calculations
// ============================================================================

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
