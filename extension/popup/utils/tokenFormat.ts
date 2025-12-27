/**
 * @fileoverview Token formatting utilities for the extension UI.
 *
 * Centralizes display formatting for token balances and price lookup keys to
 * avoid duplicating logic across views.
 *
 * @responsibilities
 * - Normalize token price keys for USD lookup
 * - Format token balances for compact display
 *
 * @security
 * - No sensitive data handled
 * - Pure formatting utilities
 */

import type { Token } from '../../../src/types/token.js';

/**
 * Get the price lookup key used by the background price cache.
 *
 * @param token - Token metadata
 * @returns Price key for the token or null if unavailable
 */
export function getTokenPriceKey(token: Token): string | null {
  if (token.type === 'native') return 'native';
  if (token.type === 'spl' || token.type === 'jetton' || token.type === 'brc20') {
    return token.address || null;
  }
  return token.address ? token.address.toLowerCase() : null;
}

/**
 * Format a token balance for compact display.
 *
 * @param balance - Raw balance value
 * @returns Formatted balance string
 */
export function formatBalance(balance: string | number): string {
  const num = typeof balance === 'string' ? parseFloat(balance) : balance;
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num < 0.0001) return num.toFixed(8).replace(/\.?0+$/, '');
  if (num < 1) return num.toFixed(6).replace(/\.?0+$/, '');
  return num.toFixed(4).replace(/\.?0+$/, '');
}
