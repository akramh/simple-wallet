/**
 * @fileoverview Price service wrapper for mobile app.
 *
 * Re-exports price service functions from the shared SDK
 * to work around Metro dynamic import issues with path aliases.
 *
 * @responsibilities
 * - Re-export shared SDK price functions
 * - Provide unified price fetching by network type
 */

export {
  getSolanaPrice,
  getBitcoinPrice,
  getXRPPrice,
  getTonPrice,
  getNativeTokenPrice,
  isSolanaNetworkKey,
  isBitcoinNetworkKey,
  isXRPNetworkKey,
  isTonNetworkKey,
  getTokenPrices,
  calculateTotalValue,
  formatUSDValue,
  getERC20TokenPrice,
  getERC20TokenPricesBatch,
  clearPriceCache,
} from '@wallet/price-service.js';

export type { TokenInfo, TokenPriceInfo, PriceCache, TransactionCosts } from '@wallet/price-service.js';

import {
  getBitcoinPrice,
  getSolanaPrice,
  getXRPPrice,
  getTonPrice,
} from '@wallet/price-service.js';

/**
 * Network type for price fetching.
 */
export type NetworkType = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';

/**
 * Get the native token price for a network by its type.
 *
 * This provides a unified interface for fetching prices across different
 * blockchain types, abstracting away the chain-specific price functions.
 *
 * @param networkType - Type of the network (bitcoin, solana, xrp, ton, or undefined for EVM)
 * @param networkKey - Network key for the specific chain
 * @returns Price in USD, or null if unavailable
 *
 * @example
 * const btcPrice = await getPriceByNetworkType('bitcoin', 'bitcoin-mainnet');
 * const tonPrice = await getPriceByNetworkType('ton', 'ton-mainnet');
 */
export async function getPriceByNetworkType(
  networkType: NetworkType | undefined,
  networkKey: string
): Promise<number | null> {
  switch (networkType) {
    case 'bitcoin':
      return getBitcoinPrice(networkKey);
    case 'solana':
      return getSolanaPrice(networkKey);
    case 'xrp':
      return getXRPPrice(networkKey);
    case 'ton':
      return getTonPrice(networkKey);
    default:
      // For EVM networks, return null - caller should use getTokenPrices with chainId
      return null;
  }
}

/**
 * Calculate total USD value for a set of assets with a given price.
 *
 * @param assets - Array of objects with balance property
 * @param price - Price per unit in USD
 * @returns Total USD value
 */
export function calculateNativeTotal(
  assets: Array<{ balance?: string | null }>,
  price: number | null
): number {
  if (!price) return 0;
  return assets.reduce((acc, a) => {
    const balance = parseFloat(a.balance || '0');
    return acc + (Number.isFinite(balance) ? balance * price : 0);
  }, 0);
}
