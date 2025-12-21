/**
 * @fileoverview TON-specific type definitions and unit helpers.
 *
 * Defines types for TON network operations including addresses, balances,
 * transactions, and fee estimates.
 *
 * @module ton/types
 */

// ============================================================================
// Constants
// ============================================================================

/** TON BIP-44 coin type. */
export const TON_COIN_TYPE = 607;

/** Number of nanoTON in 1 TON. */
export const NANO_TON = 1_000_000_000n;

// ============================================================================
// Address Types
// ============================================================================

/**
 * TON address derivation result.
 */
export interface TonAddressInfo {
  /** Friendly TON address (default non-bounceable). */
  address: string;
  /** Raw workchain:hex address representation. */
  addressRaw: string;
  /** Public key in hex (ed25519). */
  publicKeyHex: string;
  /** BIP-44 derivation path used. */
  derivationPath: string;
  /** Workchain id (typically 0). */
  workchain: number;
  /** Whether address was formatted for testnet. */
  isTestOnly: boolean;
}

// ============================================================================
// Balance Types
// ============================================================================

/**
 * TON balance information.
 */
export interface TonBalance {
  /** Balance in nanoTON (string to preserve precision). */
  balanceNano: string;
  /** Balance in TON (decimal string). */
  balanceTon: string;
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Normalized TON transaction for display.
 */
export interface NormalizedTonTransaction {
  /** Transaction hash. */
  hash: string;
  /** Sender address. */
  from: string;
  /** Recipient address. */
  to: string;
  /** Value transferred in nanoTON. */
  valueNano: string;
  /** Value transferred in TON. */
  valueTon: string;
  /** Transaction fee in nanoTON (if available). */
  feeNano?: string;
  /** Transaction fee in TON (if available). */
  feeTon?: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Transaction status. */
  status: 'confirmed' | 'pending' | 'failed';
  /** Transaction direction relative to the queried address. */
  type: 'send' | 'receive' | 'other';
  /** Optional comment payload (if available). */
  comment?: string;
  /** Network identifier. */
  network: string;
}

/**
 * Fee estimation result for TON transfers.
 */
export interface TonFeeEstimate {
  /** Estimated fee in nanoTON. */
  feeNano: string;
  /** Estimated fee in TON. */
  feeTon: string;
}

// ============================================================================
// Unit Conversion Helpers
// ============================================================================

/**
 * Convert TON amount to nanoTON.
 *
 * @param ton - Amount in TON as string or number (e.g., "1.5" or 1.5)
 * @returns Amount in nanoTON as bigint (1 TON = 1,000,000,000 nanoTON)
 * @throws {Error} If the amount is not a valid number or has more than 9 decimal places
 *
 * @example
 * tonToNano("1.5") // Returns 1500000000n
 * tonToNano(2) // Returns 2000000000n
 */
export function tonToNano(ton: string | number): bigint {
  const raw = typeof ton === 'number' ? ton.toString() : ton.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid TON amount: ${ton}`);
  }

  const [wholeStr, fracStr = ''] = raw.split('.');
  if (fracStr.length > 9) {
    throw new Error(`TON amount has too many decimal places (max 9): ${ton}`);
  }

  const whole = BigInt(wholeStr);
  const frac = BigInt((fracStr + '0'.repeat(9)).slice(0, 9) || '0');
  return whole * NANO_TON + frac;
}

/**
 * Convert nanoTON to TON.
 *
 * @param nano - Amount in nanoTON as bigint, number, or string
 * @returns Amount in TON as decimal string (trailing zeros trimmed)
 *
 * @example
 * nanoToTon(1500000000n) // Returns "1.5"
 * nanoToTon("2000000000") // Returns "2"
 * nanoToTon(500000000) // Returns "0.5"
 */
export function nanoToTon(nano: bigint | number | string): string {
  const value = typeof nano === 'bigint' ? nano : BigInt(nano);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / NANO_TON;
  const fraction = abs % NANO_TON;

  if (fraction === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const fractionStr = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}.${fractionStr}`;
}
