/**
 * @fileoverview Solana provider - RPC operations for balance, send, and confirmation.
 *
 * Phase 1: read-only support (address + SOL balance).
 * Phase 3: send support (transactions + confirmation).
 *
 * @responsibilities
 * - Fetch native SOL and SPL token balances via RPC
 * - Build, send, and confirm Solana transactions with RPC failover
 *
 * @security
 * - Private keys are never logged or persisted here; signing uses provided keypairs only
 * - RPC calls are read-only except when broadcasting signed transactions
 *
 * @module solana/provider
 */

import { Connection, PublicKey, Keypair, Transaction, type SignatureStatus } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { lamportsToSol } from './types.js';
import { BASE_FEE_LAMPORTS } from './transaction.js';

export interface SolanaProviderConfig {
  networkKey: string;
  rpcUrls: string[];
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

/** Blockhash info for transaction building */
export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Fee estimate result */
export interface SolanaFeeEstimate {
  feeLamports: number;
  feeSol: string;
}

/** Transaction confirmation result */
export interface SolanaConfirmationResult {
  confirmed: boolean;
  slot?: number;
  err?: string | null;
}

/** Transaction send result */
export interface SolanaSendResult {
  signature: string;
}

function formatTokenAmountFixed(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString();
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  const fractionStr = fraction.toString().padStart(decimals, '0');
  const trimmedFraction = fractionStr.replace(/0+$/, '');
  if (!trimmedFraction) return whole.toString();
  return `${whole.toString()}.${trimmedFraction}`;
}

function parseTokenAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return 0n;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Invalid token amount');
  }

  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > decimals) {
    throw new Error(`Token amount supports up to ${decimals} decimals`);
  }

  const whole = wholeRaw.replace(/^0+/, '') || '0';
  const frac = fracRaw.padEnd(decimals, '0');
  const combined = `${whole}${frac}`.replace(/^0+/, '') || '0';
  return BigInt(combined);
}

export class SolanaProvider {
  private config: SolanaProviderConfig;
  private connections: Connection[];

  constructor(config: SolanaProviderConfig) {
    this.config = config;
    this.connections = config.rpcUrls.map(
      (url) => new Connection(url, { commitment: config.commitment ?? 'confirmed' })
    );
  }

  getNetworkKey(): string {
    return this.config.networkKey;
  }

  async getBalanceLamports(address: string): Promise<number> {
    const publicKey = new PublicKey(address);
    let lastError: Error | undefined;

    for (let i = 0; i < this.connections.length; i++) {
      const connection = this.connections[i];
      try {
        const balance = await connection.getBalance(publicKey, this.config.commitment ?? 'confirmed');
        return balance;
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(`All Solana RPC endpoints failed for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`);
  }

  async getBalanceFormatted(address: string): Promise<string> {
    const lamports = await this.getBalanceLamports(address);
    return lamportsToSol(lamports);
  }

  async getSplTokenBalanceBaseUnits(
    ownerAddress: string,
    mintAddress: string,
    decimalsOverride?: number
  ): Promise<{ amount: bigint; decimals: number }> {
    const owner = new PublicKey(ownerAddress);
    const mint = new PublicKey(mintAddress);
    let lastError: Error | undefined;

    for (const connection of this.connections) {
      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
        if (!accounts.value.length) {
          return { amount: 0n, decimals: decimalsOverride ?? 0 };
        }

        let total = 0n;
        let decimals = decimalsOverride ?? 0;

        for (const acc of accounts.value) {
          const tokenAmount = acc.account?.data?.parsed?.info?.tokenAmount;
          if (!tokenAmount?.amount) continue;
          total += BigInt(tokenAmount.amount);
          if (typeof tokenAmount.decimals === 'number') {
            decimals = tokenAmount.decimals;
          }
        }

        return { amount: total, decimals };
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(
      `All Solana RPC endpoints failed for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  async getSplTokenBalanceFormatted(
    ownerAddress: string,
    mintAddress: string,
    decimalsOverride?: number
  ): Promise<string> {
    const { amount, decimals } = await this.getSplTokenBalanceBaseUnits(ownerAddress, mintAddress, decimalsOverride);
    return formatTokenAmountFixed(amount, decimals);
  }

  async sendSplTokenTransfer(
    fromKeypair: Keypair,
    toAddress: string,
    mintAddress: string,
    amount: string,
    decimals: number
  ): Promise<{ signature: string; feeLamports: number; feeSol: string }> {
    const fromPubkey = fromKeypair.publicKey;
    const toPubkey = new PublicKey(toAddress);
    const mintPubkey = new PublicKey(mintAddress);

    const tokenAmount = parseTokenAmount(amount, decimals);
    if (tokenAmount <= 0n) {
      throw new Error('Token amount must be greater than 0');
    }

    const feeEstimate = await this.estimateFee();
    const solBalanceLamports = await this.getBalanceLamports(fromPubkey.toBase58());
    if (solBalanceLamports < feeEstimate.feeLamports) {
      throw new Error(
        `Insufficient SOL for fees. Need ${lamportsToSol(feeEstimate.feeLamports)} SOL.`
      );
    }

    const { amount: available } = await this.getSplTokenBalanceBaseUnits(
      fromPubkey.toBase58(),
      mintAddress,
      decimals
    );
    if (available < tokenAmount) {
      throw new Error('Insufficient token balance');
    }

    const [fromTokenAccount, toTokenAccount] = await Promise.all([
      getAssociatedTokenAddress(mintPubkey, fromPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      getAssociatedTokenAddress(mintPubkey, toPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    ]);

    let lastError: Error | undefined;

    for (const connection of this.connections) {
      try {
        const fromAccountInfo = await connection.getAccountInfo(fromTokenAccount);
        if (!fromAccountInfo) {
          throw new Error('Sender does not have an associated token account for this mint');
        }

        const toAccountInfo = await connection.getAccountInfo(toTokenAccount);
        const instructions = [];

        if (!toAccountInfo) {
          instructions.push(
            createAssociatedTokenAccountInstruction(
              fromPubkey,
              toTokenAccount,
              toPubkey,
              mintPubkey,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }

        instructions.push(
          createTransferCheckedInstruction(
            fromTokenAccount,
            mintPubkey,
            toTokenAccount,
            fromPubkey,
            tokenAmount,
            decimals,
            [],
            TOKEN_PROGRAM_ID
          )
        );

        const blockhashInfo = await this.getRecentBlockhash();
        const transaction = new Transaction({
          feePayer: fromPubkey,
          blockhash: blockhashInfo.blockhash,
          lastValidBlockHeight: blockhashInfo.lastValidBlockHeight
        });

        instructions.forEach((ix) => transaction.add(ix));
        transaction.sign(fromKeypair);

        const serialized = transaction.serialize();
        const result = await this.sendTransaction(serialized);

        return {
          signature: result.signature,
          feeLamports: feeEstimate.feeLamports,
          feeSol: feeEstimate.feeSol
        };
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(
      `Failed to send SPL token transfer on ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  /**
   * Get a recent blockhash for transaction building.
   * Blockhashes expire after ~150-600 blocks (~1-2 minutes).
   *
   * @returns Blockhash and last valid block height
   */
  async getRecentBlockhash(): Promise<BlockhashInfo> {
    let lastError: Error | undefined;

    for (const connection of this.connections) {
      try {
        const result = await connection.getLatestBlockhash(this.config.commitment ?? 'confirmed');
        return {
          blockhash: result.blockhash,
          lastValidBlockHeight: result.lastValidBlockHeight,
        };
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(
      `Failed to get recent blockhash for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  /**
   * Estimate the fee for a SOL transfer transaction.
   * For simple transfers, this is the base fee (5000 lamports per signature).
   *
   * @param _transaction - Optional transaction to estimate (unused for simple transfers)
   * @returns Fee estimate in lamports and SOL
   */
  async estimateFee(_transaction?: Transaction): Promise<SolanaFeeEstimate> {
    // For simple SOL transfers, the fee is fixed at 5000 lamports per signature
    // In the future, we could use getFeeForMessage for more accurate estimates
    const feeLamports = BASE_FEE_LAMPORTS;
    return {
      feeLamports,
      feeSol: lamportsToSol(feeLamports),
    };
  }

  /**
   * Send a signed transaction to the network.
   *
   * @param serializedTransaction - Serialized signed transaction (Buffer or Uint8Array)
   * @returns Transaction signature
   */
  async sendTransaction(serializedTransaction: Buffer | Uint8Array): Promise<SolanaSendResult> {
    let lastError: Error | undefined;

    for (const connection of this.connections) {
      try {
        const signature = await connection.sendRawTransaction(serializedTransaction, {
          skipPreflight: false,
          preflightCommitment: this.config.commitment ?? 'confirmed',
        });
        return { signature };
      } catch (err) {
        lastError = err as Error;
        // If it's a specific transaction error (not RPC), don't try other endpoints
        const errMsg = (err as Error).message || '';
        if (errMsg.includes('insufficient funds') ||
            errMsg.includes('Blockhash not found') ||
            errMsg.includes('already been processed')) {
          throw err;
        }
      }
    }

    throw new Error(
      `Failed to send transaction on ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  /**
   * Check the confirmation status of a transaction.
   *
   * @param signature - Transaction signature to check
   * @returns Confirmation status
   */
  async getSignatureStatus(signature: string): Promise<SolanaConfirmationResult> {
    let lastError: Error | undefined;

    for (const connection of this.connections) {
      try {
        const result = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });

        if (!result.value) {
          // Transaction not found yet
          return { confirmed: false };
        }

        const status: SignatureStatus = result.value;
        const commitment = this.config.commitment ?? 'confirmed';

        // Check if transaction has reached desired commitment level
        const isConfirmed =
          (commitment === 'processed' && status.confirmationStatus !== null) ||
          (commitment === 'confirmed' && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) ||
          (commitment === 'finalized' && status.confirmationStatus === 'finalized');

        return {
          confirmed: isConfirmed,
          slot: status.slot,
          err: status.err ? JSON.stringify(status.err) : null,
        };
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(
      `Failed to get signature status for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  /**
   * Wait for a transaction to be confirmed.
   * Polls at regular intervals until confirmed or timeout.
   *
   * @param signature - Transaction signature to confirm
   * @param timeoutMs - Maximum time to wait (default: 60 seconds)
   * @param pollIntervalMs - Polling interval (default: 2 seconds)
   * @returns Confirmation result
   */
  async confirmTransaction(
    signature: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<SolanaConfirmationResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getSignatureStatus(signature);

      if (status.err) {
        // Transaction failed
        return status;
      }

      if (status.confirmed) {
        return status;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      confirmed: false,
      err: 'Confirmation timeout',
    };
  }
}

const providerCache = new Map<string, SolanaProvider>();

/**
 * Get or create a cached SolanaProvider for a network.
 *
 * @param networkKey - Network identifier (e.g., 'solana-mainnet', 'solana-devnet')
 * @param rpcUrls - Array of RPC endpoint URLs
 * @param commitment - Optional commitment level
 * @returns Cached SolanaProvider instance
 */
export function getSolanaProvider(
  networkKey: string,
  rpcUrls: string[],
  commitment?: 'processed' | 'confirmed' | 'finalized'
): SolanaProvider {
  let provider = providerCache.get(networkKey);
  if (!provider) {
    provider = new SolanaProvider({ networkKey, rpcUrls, commitment });
    providerCache.set(networkKey, provider);
  }
  return provider;
}
