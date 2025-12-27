/**
 * @fileoverview Transaction formatting helpers for extension views.
 *
 * Shared utilities for formatting timestamps, addresses, and amounts to keep
 * Activity and Token Details screens consistent.
 *
 * @responsibilities
 * - Format transaction timestamps and addresses for compact display
 * - Normalize value display for native and token transfers
 *
 * @security
 * - No sensitive data handled
 * - Pure formatting utilities
 */

/**
 * Format an address for compact display.
 *
 * @param addr - Address string
 * @param prefix - Leading character count
 * @param suffix - Trailing character count
 * @returns Formatted address string
 */
export function formatAddress(addr: string | null | undefined, prefix = 6, suffix = 4): string {
  if (!addr) return 'Unknown';
  return `${addr.substring(0, prefix)}...${addr.substring(addr.length - suffix)}`;
}

/**
 * Format a timestamp into a human-friendly relative date.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Relative time string
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format a transaction value with token symbol context.
 * EVM native values are assumed to be wei strings.
 *
 * @param value - Raw value string
 * @param tokenSymbol - Token symbol
 * @returns Formatted amount string
 */
export function formatTransactionValue(value: string, tokenSymbol?: string): string {
  if (!tokenSymbol || tokenSymbol === 'ETH' || tokenSymbol === 'tETH') {
    const ethValue = parseFloat(value) / 1e18;
    if (!Number.isFinite(ethValue) || ethValue === 0) return '0 ETH';
    if (ethValue < 0.0001) return '<0.0001 ETH';
    return `${ethValue.toFixed(4)} ETH`;
  }

  const numValue = parseFloat(value);
  if (!Number.isFinite(numValue) || numValue === 0) return `0 ${tokenSymbol}`;
  if (numValue < 0.0001) return `<0.0001 ${tokenSymbol}`;
  return `${numValue.toFixed(4)} ${tokenSymbol}`;
}
