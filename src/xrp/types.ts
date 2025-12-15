/**
 * @fileoverview XRP Ledger-specific type definitions.
 *
 * Defines types for XRP network operations including balances,
 * addresses, transactions, and reserve requirements.
 *
 * @module xrp/types
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Number of drops per XRP.
 * 1 XRP = 1,000,000 drops
 */
export const DROPS_PER_XRP = 1_000_000;

/**
 * Default base reserve requirement in drops (10 XRP).
 * Note: The actual reserve is network-defined and can change. Prefer querying
 * the network-reported reserve_base/reserve_inc when possible.
 */
export const XRP_RESERVE_BASE = 10_000_000;

/**
 * Default owner reserve increment in drops (2 XRP).
 * Note: The actual reserve is network-defined and can change. Prefer querying
 * the network-reported reserve_base/reserve_inc when possible.
 */
export const XRP_RESERVE_INCREMENT = 2_000_000;

/**
 * Base transaction fee in drops (~10-12 drops typical).
 */
export const BASE_FEE_DROPS = 12;

// ============================================================================
// Address Types
// ============================================================================

/**
 * XRP address derivation result.
 * Contains the derived address and associated key information.
 */
export interface XRPAddressInfo {
  /** XRP classic address (r...) */
  address: string;
  /** Public key hex */
  publicKey: string;
  /** BIP-44 derivation path used */
  derivationPath: string;
  /** Network type (addresses work on both mainnet and testnet) */
  network: 'mainnet' | 'testnet';
}

// ============================================================================
// Balance Types
// ============================================================================

/**
 * XRP account balance information.
 * Includes reserve calculations for spendable balance.
 */
export interface XRPBalance {
  /** Total balance in drops */
  total: number;
  /** Reserved balance (base + owner reserve) in drops */
  reserved: number;
  /** Available (spendable) balance in drops */
  available: number;
  /** Whether account exists on the ledger */
  isActivated: boolean;
  /** Number of owned objects (trust lines, offers, etc.) */
  ownerCount: number;
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * XRP transaction from the ledger.
 */
export interface XRPTransaction {
  /** Transaction hash */
  hash: string;
  /** Account that initiated the transaction */
  Account: string;
  /** Transaction type (Payment, TrustSet, etc.) */
  TransactionType: string;
  /** Destination account (for Payment transactions) */
  Destination?: string;
  /** Amount in drops (for Payment transactions) */
  Amount?: string | { currency: string; value: string; issuer: string };
  /** Destination tag (optional, for exchange deposits) */
  DestinationTag?: number;
  /** Source tag (optional) */
  SourceTag?: number;
  /** Transaction fee in drops */
  Fee: string;
  /** Account sequence number */
  Sequence: number;
  /** Ledger index where transaction was validated */
  ledger_index?: number;
  /** Close time of the ledger (Unix timestamp) */
  date?: number;
  /** Transaction result metadata */
  meta?: {
    TransactionResult: string;
    delivered_amount?: string | { currency: string; value: string; issuer: string };
  };
}

/**
 * Normalized XRP transaction for display.
 * Matches the structure used by the existing transaction history system.
 */
export interface NormalizedXRPTransaction {
  /** Transaction hash */
  hash: string;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** Value in drops as string */
  value: string;
  /** Value in XRP as string */
  valueXrp: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Ledger index */
  ledgerIndex: number;
  /** Transaction fee in drops */
  fee: string;
  /** Transaction fee in XRP */
  feeXrp: string;
  /** Transaction status */
  status: 'confirmed' | 'pending' | 'failed';
  /** Transaction type relative to the queried address */
  type: 'send' | 'receive' | 'other';
  /** Destination tag (if present) */
  destinationTag?: number;
  /** Source tag (if present) */
  sourceTag?: number;
  /** Network identifier */
  network: string;
}

/**
 * Fee estimation result from the XRP Ledger.
 */
export interface XRPFeeEstimate {
  /** Base fee in drops */
  baseFee: number;
  /** Median fee in drops */
  medianFee: number;
  /** Minimum fee in drops */
  minimumFee: number;
  /** Open ledger fee in drops (current network load) */
  openLedgerFee: number;
}

// ============================================================================
// Network Configuration
// ============================================================================

/**
 * XRP network configuration.
 * Extends the base network config with XRP-specific fields.
 */
export interface XRPNetworkConfig {
  /** Network type discriminator */
  type: 'xrp';
  /** XRP network (mainnet, testnet, devnet) */
  xrpNetwork: 'mainnet' | 'testnet' | 'devnet';
  /** JSON-RPC URL(s) for XRP Ledger */
  rpcUrl?: string | string[];
  /** WebSocket URL(s) for XRP Ledger */
  wsUrl?: string | string[];
  /** Native token symbol */
  nativeSymbol: string;
  /** Native token name */
  nativeName: string;
  /** Block explorer URL */
  blockExplorer?: string;
  /** Human-readable network name */
  name?: string;
}

// ============================================================================
// Unit Conversion Functions
// ============================================================================

/**
 * Convert drops to XRP.
 * @param drops - Amount in drops
 * @returns Amount in XRP as string with 6 decimal places
 */
export function dropsToXrp(drops: number | string): string {
  const dropsNum = typeof drops === 'string' ? parseInt(drops, 10) : drops;
  return (dropsNum / DROPS_PER_XRP).toFixed(6);
}

/**
 * Convert XRP to drops.
 * @param xrp - Amount in XRP
 * @returns Amount in drops as integer
 */
export function xrpToDrops(xrp: string | number): number {
  const xrpNum = typeof xrp === 'string' ? parseFloat(xrp) : xrp;
  return Math.round(xrpNum * DROPS_PER_XRP);
}

/**
 * Parse XRP string to drops with exact precision.
 * Handles decimal strings without floating point errors.
 * @param xrpString - Amount in XRP as string
 * @returns Amount in drops as integer
 * @throws Error if the string format is invalid
 */
export function parseXrpToDropsExact(xrpString: string): number {
  const trimmed = xrpString.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid XRP amount format: ${xrpString}`);
  }

  const parts = trimmed.split('.');
  const wholePart = parts[0];
  let fractionalPart = parts[1] || '';

  // XRP has 6 decimal places
  if (fractionalPart.length > 6) {
    throw new Error(`XRP amount has too many decimal places (max 6): ${xrpString}`);
  }

  // Pad or truncate to 6 decimal places
  fractionalPart = fractionalPart.padEnd(6, '0');

  const drops = parseInt(wholePart, 10) * DROPS_PER_XRP + parseInt(fractionalPart, 10);
  return drops;
}

/**
 * Format drops for display with XRP symbol.
 * @param drops - Amount in drops
 * @param symbol - Currency symbol (default: 'XRP')
 * @returns Formatted string like "1.234567 XRP"
 */
export function formatXrpAmount(drops: number | string, symbol: string = 'XRP'): string {
  const dropsNum = typeof drops === 'string' ? parseInt(drops, 10) : drops;
  const xrp = dropsNum / DROPS_PER_XRP;
  // Remove trailing zeros but keep at least 2 decimal places
  const formatted = xrp.toFixed(6).replace(/\.?0+$/, '');
  const parts = formatted.split('.');
  if (parts.length === 1) {
    return `${parts[0]}.00 ${symbol}`;
  }
  if (parts[1].length < 2) {
    return `${parts[0]}.${parts[1].padEnd(2, '0')} ${symbol}`;
  }
  return `${formatted} ${symbol}`;
}

/**
 * Calculate the reserve requirement for an account.
 * @param ownerCount - Number of owned objects (trust lines, offers, etc.)
 * @returns Reserve amount in drops
 */
export function calculateReserve(
  ownerCount: number,
  reserveBaseDrops: number = XRP_RESERVE_BASE,
  reserveIncrementDrops: number = XRP_RESERVE_INCREMENT
): number {
  return reserveBaseDrops + (ownerCount * reserveIncrementDrops);
}

/**
 * Check if a destination tag is valid.
 * Destination tags are unsigned 32-bit integers (0 to 4294967295).
 * @param tag - The destination tag to validate
 * @returns True if valid, false otherwise
 */
export function isValidDestinationTag(tag: number | string | undefined | null): boolean {
  if (tag === undefined || tag === null || tag === '') {
    return true; // Destination tag is optional
  }

  // Handle string input
  if (typeof tag === 'string') {
    // Must be a string of digits only (no decimals, no negative)
    if (!/^\d+$/.test(tag)) {
      return false;
    }
    const num = parseInt(tag, 10);
    return !isNaN(num) && num >= 0 && num <= 4294967295;
  }

  // Handle number input - must be an integer
  if (!Number.isInteger(tag)) {
    return false;
  }

  // Must be a 32-bit unsigned integer
  return tag >= 0 && tag <= 4294967295;
}
