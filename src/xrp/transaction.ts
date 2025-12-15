/**
 * @fileoverview XRP transaction building and signing.
 *
 * Builds Payment transactions for sending XRP.
 * Uses xrpl.js library for transaction construction and signing.
 *
 * Phase 3: Send XRP support.
 *
 * @module xrp/transaction
 */

import { Wallet, xrpToDrops as xrplXrpToDrops } from 'xrpl';
import {
  dropsToXrp,
  parseXrpToDropsExact,
  calculateReserve,
  isValidDestinationTag,
  BASE_FEE_DROPS,
  XRP_RESERVE_BASE,
  XRP_RESERVE_INCREMENT,
} from './types.js';
import { isValidXRPAddress } from './address.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for building an XRP Payment transaction.
 */
export interface XRPPaymentParams {
  /** Sender's XRP address */
  fromAddress: string;
  /** Recipient's XRP address */
  toAddress: string;
  /** Amount in drops */
  amountDrops: number;
  /** Transaction fee in drops */
  feeDrops: number;
  /** Account sequence number */
  sequence: number;
  /** Destination tag (optional, for exchange deposits) */
  destinationTag?: number;
  /** Last ledger sequence for transaction expiration */
  lastLedgerSequence: number;
}

/**
 * Unsigned XRP Payment transaction.
 */
export interface UnsignedXRPPayment {
  TransactionType: 'Payment';
  Account: string;
  Destination: string;
  Amount: string;
  Fee: string;
  Sequence: number;
  DestinationTag?: number;
  LastLedgerSequence: number;
}

/**
 * Signed XRP transaction ready to submit.
 */
export interface SignedXRPTransaction {
  /** Transaction blob (hex-encoded) */
  txBlob: string;
  /** Transaction hash */
  hash: string;
  /** Original transaction JSON */
  tx: UnsignedXRPPayment;
}

/**
 * Result of submitting an XRP transaction.
 */
export interface XRPTransactionResult {
  /** Transaction hash */
  hash: string;
  /** Fee paid in drops */
  feeDrops: number;
  /** Fee paid in XRP */
  feeXrp: string;
  /** Result code from ledger */
  resultCode?: string;
  /** Whether the transaction was accepted */
  accepted: boolean;
}

// ============================================================================
// Transaction Building
// ============================================================================

/**
 * Build an unsigned XRP Payment transaction.
 *
 * @param params - Payment parameters
 * @returns Unsigned transaction object
 * @throws Error if addresses are invalid or amount is invalid
 */
export function buildPaymentTransaction(params: XRPPaymentParams): UnsignedXRPPayment {
  const {
    fromAddress,
    toAddress,
    amountDrops,
    feeDrops,
    sequence,
    destinationTag,
    lastLedgerSequence,
  } = params;

  // Validate addresses
  if (!isValidXRPAddress(fromAddress)) {
    throw new Error(`Invalid sender address: ${fromAddress}`);
  }
  if (!isValidXRPAddress(toAddress)) {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }

  // Validate amount
  if (amountDrops <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  // Validate fee
  if (feeDrops < BASE_FEE_DROPS) {
    throw new Error(`Fee must be at least ${BASE_FEE_DROPS} drops`);
  }

  // Validate destination tag if provided
  if (destinationTag !== undefined && !isValidDestinationTag(destinationTag)) {
    throw new Error(`Invalid destination tag: ${destinationTag}`);
  }

  // Build transaction
  const tx: UnsignedXRPPayment = {
    TransactionType: 'Payment',
    Account: fromAddress,
    Destination: toAddress,
    Amount: amountDrops.toString(),
    Fee: feeDrops.toString(),
    Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence,
  };

  // Add destination tag if provided
  if (destinationTag !== undefined) {
    tx.DestinationTag = destinationTag;
  }

  return tx;
}

/**
 * Sign an XRP transaction with the sender's wallet.
 *
 * @param tx - Unsigned transaction
 * @param wallet - xrpl Wallet instance for signing
 * @returns Signed transaction with blob and hash
 */
export function signPaymentTransaction(
  tx: UnsignedXRPPayment,
  wallet: Wallet
): SignedXRPTransaction {
  // Sign the transaction
  const signed = wallet.sign(tx as any);

  return {
    txBlob: signed.tx_blob,
    hash: signed.hash,
    tx,
  };
}

/**
 * Build and sign an XRP Payment transaction in one step.
 *
 * @param params - Payment parameters
 * @param wallet - xrpl Wallet instance for signing
 * @returns Signed transaction ready to submit
 */
export function buildAndSignPayment(
  params: XRPPaymentParams,
  wallet: Wallet
): SignedXRPTransaction {
  const tx = buildPaymentTransaction(params);
  return signPaymentTransaction(tx, wallet);
}

// ============================================================================
// Validation and Estimation
// ============================================================================

/**
 * Validate that sender has sufficient balance for transfer.
 * Takes into account reserve requirements and transaction fee.
 *
 * @param balanceDrops - Sender's current balance in drops
 * @param amountDrops - Amount to send in drops
 * @param feeDrops - Transaction fee in drops
 * @param ownerCount - Number of owned objects (for reserve calculation)
 * @throws Error if insufficient balance
 */
export function validateSufficientBalance(
  balanceDrops: number,
  amountDrops: number,
  feeDrops: number,
  ownerCount: number = 0,
  reserveBaseDrops: number = XRP_RESERVE_BASE,
  reserveIncrementDrops: number = XRP_RESERVE_INCREMENT
): void {
  const reserveDrops = calculateReserve(ownerCount, reserveBaseDrops, reserveIncrementDrops);
  const totalRequired = amountDrops + feeDrops + reserveDrops;

  if (balanceDrops < totalRequired) {
    const balanceXrp = dropsToXrp(balanceDrops);
    const requiredXrp = dropsToXrp(totalRequired);
    const amountXrp = dropsToXrp(amountDrops);
    const feeXrp = dropsToXrp(feeDrops);
    const reserveXrp = dropsToXrp(reserveDrops);

    throw new Error(
      `Insufficient XRP balance. You have ${balanceXrp} XRP but need ${requiredXrp} XRP ` +
      `(${amountXrp} XRP amount + ${feeXrp} XRP fee + ${reserveXrp} XRP reserve)`
    );
  }
}

/**
 * Calculate the maximum sendable amount (accounting for reserve and fee).
 *
 * @param balanceDrops - Current balance in drops
 * @param feeDrops - Transaction fee in drops
 * @param ownerCount - Number of owned objects
 * @returns Maximum sendable amount in drops (0 if cannot send)
 */
export function calculateMaxSendable(
  balanceDrops: number,
  feeDrops: number,
  ownerCount: number = 0,
  reserveBaseDrops: number = XRP_RESERVE_BASE,
  reserveIncrementDrops: number = XRP_RESERVE_INCREMENT
): number {
  const reserveDrops = calculateReserve(ownerCount, reserveBaseDrops, reserveIncrementDrops);
  const maxSendable = balanceDrops - feeDrops - reserveDrops;
  return Math.max(0, maxSendable);
}

/**
 * Estimate the total cost of an XRP transfer (amount + fee).
 *
 * @param amountXrp - Amount in XRP as string
 * @param feeDrops - Fee in drops
 * @returns Total cost breakdown
 */
export function estimateTransferCost(
  amountXrp: string,
  feeDrops: number
): {
  amountDrops: number;
  feeDrops: number;
  totalDrops: number;
  amountXrpStr: string;
  feeXrpStr: string;
  totalXrpStr: string;
} {
  const amountDrops = parseXrpToDropsExact(amountXrp);
  const totalDrops = amountDrops + feeDrops;

  return {
    amountDrops,
    feeDrops,
    totalDrops,
    amountXrpStr: dropsToXrp(amountDrops),
    feeXrpStr: dropsToXrp(feeDrops),
    totalXrpStr: dropsToXrp(totalDrops),
  };
}

/**
 * Parse an XRP amount string to drops with validation.
 *
 * @param amountStr - Amount in XRP (e.g., "10" or "10.5")
 * @returns Amount in drops
 * @throws Error if amount is invalid
 */
export function parseAmountToDrops(amountStr: string): number {
  const trimmed = amountStr.trim();

  if (!trimmed) {
    throw new Error('Amount is required');
  }

  try {
    const drops = parseXrpToDropsExact(trimmed);
    if (drops <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    return drops;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid XRP amount')) {
      throw error;
    }
    throw new Error(`Invalid amount: ${amountStr}`);
  }
}

/**
 * Check if a recipient account is activated (has minimum reserve).
 * If not activated, the amount sent must be at least the base reserve.
 *
 * @param amountDrops - Amount being sent
 * @param isRecipientActivated - Whether recipient account exists
 * @throws Error if trying to send less than reserve to new account
 */
export function validateRecipientActivation(
  amountDrops: number,
  isRecipientActivated: boolean,
  reserveBaseDrops: number = XRP_RESERVE_BASE
): void {
  if (!isRecipientActivated && amountDrops < reserveBaseDrops) {
    const minXrp = dropsToXrp(reserveBaseDrops);
    const amountXrp = dropsToXrp(amountDrops);
    throw new Error(
      `Cannot send ${amountXrp} XRP to a new account. ` +
      `The minimum amount to activate a new XRP account is ${minXrp} XRP.`
    );
  }
}
