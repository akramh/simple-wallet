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
  PublicKey,
  Keypair,
  type Blockhash,
} from '@solana/web3.js';
import { lamportsToSol } from './types.js';

/** Base fee per signature in lamports (fixed by Solana protocol) */
export const BASE_FEE_LAMPORTS = 5000;

/** Result of building a SOL transfer transaction */
export interface SolTransferParams {
  fromPubkey: PublicKey;
  toPubkey: PublicKey;
  lamports: number;
  recentBlockhash: Blockhash;
  lastValidBlockHeight: number;
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
  const { fromPubkey, toPubkey, lamports, recentBlockhash, lastValidBlockHeight } = params;

  if (lamports <= 0) {
    throw new Error('Transfer amount must be greater than 0');
  }

  const transaction = new Transaction({
    feePayer: fromPubkey,
    blockhash: recentBlockhash,
    lastValidBlockHeight,
  });

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
