/**
 * @fileoverview Solana transaction building and signing.
 *
 * Builds System Program transfer instructions for sending SOL.
 * Uses @solana/web3.js for transaction construction and serialization.
 *
 * Phase 3: Send SOL support.
 *
 * @responsibilities
 * - Build and sign SOL transfer transactions
 * - Validate SOL transfer balances and fee assumptions
 *
 * @security
 * - Does not persist or log private keys; callers provide keypairs
 *
 * @module solana/transaction
 */

import {
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  PublicKey,
  Keypair,
  type Blockhash,
} from '@solana/web3.js';
import { lamportsToSol } from './types.js';

/** Base fee per signature in lamports (fixed by Solana protocol) */
export const BASE_FEE_LAMPORTS = 5000;

/**
 * Default compute-unit limit for a simple System-Program SOL transfer that
 * also includes the two Compute Budget instructions. A SystemProgram.transfer
 * runs ~150 CU and each Compute Budget instruction runs ~150 CU — 1000 CU is
 * a generous ceiling that keeps the priority-fee cost bounded.
 *
 * Priority-fee cost = (microLamportsPerCU × computeUnitLimit) / 1_000_000
 */
export const DEFAULT_SOL_TRANSFER_CU_LIMIT = 1000;

/** Result of building a SOL transfer transaction */
export interface SolTransferParams {
  fromPubkey: PublicKey;
  toPubkey: PublicKey;
  lamports: number;
  recentBlockhash: Blockhash;
  lastValidBlockHeight: number;
  /**
   * Optional priority fee in micro-lamports per compute unit. When provided
   * (along with `computeUnitLimit`), the transaction prepends
   * ComputeBudgetProgram.setComputeUnitPrice + setComputeUnitLimit instructions
   * so Solana validators prioritize the tx under congestion. Leave undefined
   * to build a bare transfer at the base fee.
   */
  priorityFeeMicroLamports?: number;
  /** Compute-unit limit to request. Defaults to DEFAULT_SOL_TRANSFER_CU_LIMIT when priority fee is set. */
  computeUnitLimit?: number;
}

/** Signed transaction ready to send */
export interface SignedSolTransfer {
  transaction: Transaction;
  serialized: Buffer;
  signature: string;
}

/** Transaction send result */
export interface SolTransferResult {
  signature: string;
  feeLamports: number;
  feeSol: string;
}

/**
 * Validate a Solana address (base58 public key).
 *
 * @param address - Address string to validate
 * @returns True if valid Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  try {
    // PublicKey constructor validates base58 format and length
    const pubkey = new PublicKey(address);
    // Ensure it's on the ed25519 curve (not a program address)
    return PublicKey.isOnCurve(pubkey.toBytes());
  } catch {
    return false;
  }
}

/**
 * Build an unsigned SOL transfer transaction.
 *
 * @param params - Transfer parameters
 * @returns Unsigned transaction
 */
export function buildSolTransfer(params: SolTransferParams): Transaction {
  const {
    fromPubkey,
    toPubkey,
    lamports,
    recentBlockhash,
    lastValidBlockHeight,
    priorityFeeMicroLamports,
    computeUnitLimit,
  } = params;

  if (lamports <= 0) {
    throw new Error('Transfer amount must be greater than 0');
  }

  const transaction = new Transaction({
    feePayer: fromPubkey,
    blockhash: recentBlockhash,
    lastValidBlockHeight,
  });

  // Priority-fee instructions must come before the transfer. Both are only
  // added when the caller has opted in via `priorityFeeMicroLamports` — a bare
  // transfer stays cheap (base fee only) when no priority is requested.
  if (typeof priorityFeeMicroLamports === 'number' && priorityFeeMicroLamports > 0) {
    const cuLimit = computeUnitLimit ?? DEFAULT_SOL_TRANSFER_CU_LIMIT;
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports })
    );
  }

  transaction.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );

  return transaction;
}

/**
 * Sign a SOL transfer transaction with the sender's keypair.
 *
 * @param transaction - Unsigned transaction
 * @param keypair - Sender's keypair for signing
 * @returns Signed transaction with serialized bytes and signature
 */
export function signSolTransfer(transaction: Transaction, keypair: Keypair): SignedSolTransfer {
  // Sign the transaction
  transaction.sign(keypair);

  // Get the signature (first signature in the list)
  const signature = transaction.signature;
  if (!signature) {
    throw new Error('Failed to sign transaction');
  }

  // Serialize for sending
  const serialized = transaction.serialize();

  return {
    transaction,
    serialized,
    signature: Buffer.from(signature).toString('base64'),
  };
}

/**
 * Build and sign a SOL transfer transaction in one step.
 *
 * @param params - Transfer parameters
 * @param keypair - Sender's keypair for signing
 * @returns Signed transaction ready to send
 */
export function buildAndSignSolTransfer(
  params: SolTransferParams,
  keypair: Keypair
): SignedSolTransfer {
  const transaction = buildSolTransfer(params);
  return signSolTransfer(transaction, keypair);
}

/**
 * Estimate the fee for a SOL transfer.
 * For simple transfers, this is the base fee (5000 lamports per signature).
 *
 * @param _numSignatures - Number of signatures (default 1 for simple transfers)
 * @returns Estimated fee in lamports
 */
export function estimateTransferFee(_numSignatures: number = 1): number {
  // Simple SOL transfers have 1 signature
  // Base fee is 5000 lamports per signature
  return BASE_FEE_LAMPORTS * _numSignatures;
}

/**
 * Convert a priority-fee rate (micro-lamports per compute unit) and the
 * requested compute-unit limit into the additional lamports the fee payer
 * will be charged on top of the base fee. Rounded up: the protocol charges
 * `ceil(microLamports × units / 1_000_000)` lamports, so displaying a smaller
 * value would under-report the actual cost.
 *
 * @param microLamportsPerCU - Priority-fee rate (see ComputeBudgetProgram.setComputeUnitPrice)
 * @param computeUnitLimit - Compute-unit ceiling requested in the tx
 * @returns Priority-fee cost in lamports
 */
export function priorityFeeLamports(microLamportsPerCU: number, computeUnitLimit: number): number {
  if (microLamportsPerCU <= 0 || computeUnitLimit <= 0) return 0;
  // Use BigInt for the intermediate so large percentiles × large CU limits
  // don't overflow JS Number precision before the divide.
  const product = BigInt(Math.floor(microLamportsPerCU)) * BigInt(Math.floor(computeUnitLimit));
  const oneMillion = 1_000_000n;
  // ceil division
  const ceilLamports = (product + oneMillion - 1n) / oneMillion;
  return Number(ceilLamports);
}

/**
 * Pick a percentile from an array of observed prioritization fees.
 * The Solana RPC returns recent fees per-slot; taking a percentile smooths
 * over single-slot outliers while still reflecting current congestion.
 *
 * @param fees - RPC-returned prioritization fees (lamports-per-CU values; despite the field name being `prioritizationFee`, Solana docs specify the unit as micro-lamports per compute unit)
 * @param percentile - Percentile in [0, 100]; defaults to 75 (moderately aggressive)
 * @returns Suggested micro-lamports per CU; 0 if the array is empty
 */
export function pickPriorityFeePercentile(fees: number[], percentile: number = 75): number {
  if (!fees.length) return 0;
  const clamped = Math.min(100, Math.max(0, percentile));
  const sorted = [...fees].sort((a, b) => a - b);
  // Nearest-rank method: rank = ceil(p/100 × n), 1-indexed.
  const rank = Math.max(1, Math.ceil((clamped / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/**
 * Validate that sender has sufficient balance for transfer + fee.
 *
 * @param balanceLamports - Sender's current balance in lamports
 * @param amountLamports - Amount to transfer in lamports
 * @param feeLamports - Transaction fee in lamports
 * @throws Error if insufficient balance
 */
export function validateSufficientBalance(
  balanceLamports: number,
  amountLamports: number,
  feeLamports: number
): void {
  const totalRequired = amountLamports + feeLamports;

  if (balanceLamports < totalRequired) {
    const balanceSol = lamportsToSol(balanceLamports);
    const requiredSol = lamportsToSol(totalRequired);
    const amountSol = lamportsToSol(amountLamports);
    const feeSol = lamportsToSol(feeLamports);

    throw new Error(
      `Insufficient SOL balance. You have ${balanceSol} SOL but need ${requiredSol} SOL ` +
      `(${amountSol} SOL + ${feeSol} SOL fee)`
    );
  }
}
