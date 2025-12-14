/**
 * @fileoverview Solana provider - RPC operations for balance, send, and confirmation.
 *
 * Phase 1: read-only support (address + SOL balance).
 * Phase 3: send support (transactions + confirmation).
 *
 * @module solana/provider
 */

import { Connection, PublicKey, type Transaction, type SignatureStatus } from '@solana/web3.js';
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

