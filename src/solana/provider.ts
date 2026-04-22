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

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  type SignatureStatus,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { lamportsToSol } from './types.js';
import {
  BASE_FEE_LAMPORTS,
  DEFAULT_SOL_TRANSFER_CU_LIMIT,
  pickPriorityFeePercentile,
  priorityFeeLamports as computePriorityFeeLamports,
} from './transaction.js';

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
  /** Total fee (base fee + priority-fee cost) in lamports */
  feeLamports: number;
  /** Total fee formatted in SOL */
  feeSol: string;
  /**
   * Protocol base fee in lamports (signatures × BASE_FEE_LAMPORTS on legacy,
   * or whatever `getFeeForMessage` returns for a compiled message). Always
   * present — equals `feeLamports` when no priority fee is sampled.
   */
  baseFeeLamports: number;
  /** Additional fee from the priority-fee bid, in lamports. 0 when not applied. */
  priorityFeeLamports: number;
  /** Sampled priority-fee rate (micro-lamports per CU). 0 when unavailable. */
  priorityFeeMicroLamports: number;
  /** Compute-unit limit this estimate assumes. 0 when priority fee is 0. */
  computeUnitLimit: number;
}

/**
 * Optional hints to make a Solana fee estimate more accurate. When provided,
 * `estimateFee` will compile a SystemProgram.transfer message and call
 * `getFeeForMessage` for the authoritative base fee, and sample
 * `getRecentPrioritizationFees` (locked on the fee payer) to pick a priority
 * fee. Without these the function falls back to the fixed BASE_FEE_LAMPORTS
 * constant — same behavior as before.
 */
export interface SolanaFeeEstimateParams {
  fromAddress: string;
  toAddress: string;
  lamports: number;
  /** Percentile of recent prioritization fees to pick (default 75). */
  priorityFeePercentile?: number;
  /** Compute-unit limit to assume (default DEFAULT_SOL_TRANSFER_CU_LIMIT). */
  computeUnitLimit?: number;
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
   * Estimate the fee for a SOL transfer.
   *
   * When called without params — same shape as before — returns the protocol
   * base fee (5000 lamports × 1 signature). This keeps callers that don't yet
   * know their recipient/amount (e.g. an initial render) working.
   *
   * When called with `SolanaFeeEstimateParams`, builds a dry-run
   * SystemProgram.transfer message and calls two standard Solana RPC methods
   * (available through any compliant RPC provider, including Alchemy):
   *
   *   - `getFeeForMessage(compiledMessage)` — authoritative base fee for the
   *     actual message we'll sign. Accounts for signature count and any
   *     protocol changes.
   *   - `getRecentPrioritizationFees({ lockedWritableAccounts: [fromPubkey] })`
   *     — sample of per-CU priority fees recently paid to land writes on the
   *     fee-payer account. We pick the 75th percentile by default.
   *
   * Both RPC paths are best-effort: any failure falls back to the fixed base
   * fee. The returned `priorityFeeMicroLamports` / `computeUnitLimit` are what
   * the caller should plumb into `buildSolTransfer` so the *actual* sent tx
   * matches the *estimated* fee.
   *
   * @param params - Optional transfer context for an accurate on-chain estimate
   * @returns Fee estimate broken out by base + priority components
   */
  async estimateFee(params?: SolanaFeeEstimateParams): Promise<SolanaFeeEstimate> {
    const fallback = (reason?: string): SolanaFeeEstimate => {
      if (reason) {
        // Visibility without leaking anything sensitive. Helps diagnose why a
        // Solana estimate is showing the flat 5000 lamports in the UI.
        console.warn(`[SolanaProvider.estimateFee] fallback to base fee: ${reason}`);
      }
      return {
        feeLamports: BASE_FEE_LAMPORTS,
        feeSol: lamportsToSol(BASE_FEE_LAMPORTS),
        baseFeeLamports: BASE_FEE_LAMPORTS,
        priorityFeeLamports: 0,
        priorityFeeMicroLamports: 0,
        computeUnitLimit: 0,
      };
    };

    // No context ⇒ return the constant. Existing CLI/UI paths that call
    // `estimateFee()` with no args keep their current semantics.
    if (!params) return fallback();

    const { fromAddress, toAddress, lamports } = params;
    const percentile = params.priorityFeePercentile ?? 75;
    const cuLimit = params.computeUnitLimit ?? DEFAULT_SOL_TRANSFER_CU_LIMIT;

    let fromPubkey: PublicKey;
    let toPubkey: PublicKey;
    try {
      fromPubkey = new PublicKey(fromAddress);
      toPubkey = new PublicKey(toAddress);
    } catch {
      return fallback('invalid address');
    }
    if (!Number.isFinite(lamports) || lamports <= 0) {
      return fallback('invalid lamports');
    }

    // Iterate the endpoint list so RPC failover applies to fee estimation too.
    let lastError: Error | undefined;
    for (const connection of this.connections) {
      try {
        // --- priority fee sample ---
        // Lock on the fee payer so the result reflects fees paid to land
        // writes on this specific account recently, not global noise.
        let priorityFeeMicroLamports = 0;
        try {
          const recent = await connection.getRecentPrioritizationFees({
            lockedWritableAccounts: [fromPubkey],
          });
          priorityFeeMicroLamports = pickPriorityFeePercentile(
            recent.map((r) => r.prioritizationFee),
            percentile
          );
        } catch {
          // Priority-fee sampling is optional. Proceed with 0 (i.e. no
          // priority) and still try `getFeeForMessage` for the base fee.
          priorityFeeMicroLamports = 0;
        }

        // --- authoritative base fee via getFeeForMessage ---
        // Build the exact shape of instructions we'd sign: compute budget
        // instructions (only if priority fee is non-zero) + SystemProgram
        // transfer. A recent blockhash is required so the message can be
        // compiled; expiring mid-estimate would cause a null response, in
        // which case we fall back to the constant.
        const blockhash = await connection.getLatestBlockhash(
          this.config.commitment ?? 'confirmed'
        );
        const tx = new Transaction({
          feePayer: fromPubkey,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        });
        if (priorityFeeMicroLamports > 0) {
          tx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: priorityFeeMicroLamports,
            })
          );
        }
        tx.add(
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports,
          })
        );
        const message = tx.compileMessage();
        const feeResponse = await connection.getFeeForMessage(
          message,
          this.config.commitment ?? 'confirmed'
        );

        // getFeeForMessage returns null when the blockhash has expired or the
        // message is malformed. Either way, fall back rather than guess.
        const baseFeeLamports = feeResponse?.value ?? null;
        if (typeof baseFeeLamports !== 'number') {
          return fallback('getFeeForMessage returned null');
        }

        const priorityCost =
          priorityFeeMicroLamports > 0
            ? computePriorityFeeLamports(priorityFeeMicroLamports, cuLimit)
            : 0;
        const totalLamports = baseFeeLamports + priorityCost;

        return {
          feeLamports: totalLamports,
          feeSol: lamportsToSol(totalLamports),
          baseFeeLamports,
          priorityFeeLamports: priorityCost,
          priorityFeeMicroLamports,
          computeUnitLimit: priorityFeeMicroLamports > 0 ? cuLimit : 0,
        };
      } catch (err) {
        lastError = err as Error;
        // Try the next RPC endpoint.
      }
    }

    return fallback(lastError?.message || 'all Solana RPC endpoints failed for fee estimation');
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
