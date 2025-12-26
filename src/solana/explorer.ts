/**
 * @fileoverview Solana explorer for transaction history.
 *
 * Uses Solana RPC (getSignaturesForAddress + getParsedTransaction) for
 * fetching transaction history.
 *
 * Phase 2: transaction history (native SOL movements).
 *
 * @responsibilities
 * - Fetch SOL and SPL token transaction history via Solana RPC
 * - Normalize Solana transactions for UI display
 *
 * @security
 * - Read-only RPC access; no signing or key material handled here
 *
 * @module solana/explorer
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { lamportsToSol } from './types.js';

export interface NormalizedSolanaTransaction {
  signature: string;
  from: string;
  to: string | null;
  /** Amount in lamports (best-effort, excludes fee when possible for sender) */
  valueLamports: number;
  /** Amount in SOL for UI display */
  valueSol: string;
  /** Token transfer amount for SPL tokens (formatted in display units) */
  valueToken?: string;
  feeLamports: number;
  feeSol: string;
  /** Solana slot number */
  slot?: number;
  timestamp: number;
  status: 'confirmed' | 'failed' | 'pending';
  type: 'send' | 'receive' | 'contract_interaction';
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
}

export interface SolanaExplorerConfig {
  networkKey: string;
  /** RPC URLs (required) */
  rpcUrls: string[];
  /** RPC commitment level */
  commitment?: 'processed' | 'confirmed' | 'finalized';
  /** Optional connection factory for testing */
  connectionFactory?: (url: string, commitment: 'processed' | 'confirmed' | 'finalized') => Pick<
    Connection,
    'getSignaturesForAddress' | 'getParsedTransaction'
  >;
}

function extractPubkeyBase58(key: any): string {
  if (!key) return '';
  if (typeof key === 'string') return key;
  if (typeof key?.toBase58 === 'function') return key.toBase58();
  if (typeof key?.pubkey?.toBase58 === 'function') return key.pubkey.toBase58();
  if (typeof key?.pubkey === 'string') return key.pubkey;
  return String(key);
}

function findSolTransferCounterparty(parsedTx: any, address: string, direction: 'send' | 'receive'): string | null {
  const message = parsedTx?.transaction?.message;
  const instructions = message?.instructions;
  if (!Array.isArray(instructions)) return null;

  for (const ix of instructions) {
    const program = ix?.program || ix?.programId;
    const parsed = ix?.parsed;
    const type = parsed?.type;
    const info = parsed?.info;
    if (!parsed || !info) continue;
    if (program !== 'system' && program !== 'SystemProgram') continue;
    if (type !== 'transfer') continue;

    const source = typeof info.source === 'string' ? info.source : null;
    const destination = typeof info.destination === 'string' ? info.destination : null;
    if (!source || !destination) continue;

    if (direction === 'send' && source === address) return destination;
    if (direction === 'receive' && destination === address) return source;
  }

  return null;
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

function findSplTransferCounterparty(
  parsedTx: any,
  tokenAccount: string,
  direction: 'send' | 'receive'
): string | null {
  const message = parsedTx?.transaction?.message;
  const instructions = Array.isArray(message?.instructions) ? message.instructions : [];

  for (const ix of instructions) {
    const program = ix?.program || ix?.programId;
    const parsed = ix?.parsed;
    const info = parsed?.info;
    if (!parsed || !info) continue;
    if (program !== 'spl-token' && program !== TOKEN_PROGRAM_ID.toBase58()) continue;
    if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue;

    const source = typeof info.source === 'string' ? info.source : null;
    const destination = typeof info.destination === 'string' ? info.destination : null;
    if (!source || !destination) continue;

    if (direction === 'send' && source === tokenAccount) return destination;
    if (direction === 'receive' && destination === tokenAccount) return source;
  }

  return null;
}

export class SolanaExplorer {
  private config: SolanaExplorerConfig;
  private connections: Array<Pick<Connection, 'getSignaturesForAddress' | 'getParsedTransaction'>>;

  constructor(config: SolanaExplorerConfig) {
    this.config = config;
    
    const commitment = config.commitment ?? 'confirmed';
    const factory = config.connectionFactory ?? 
      ((url: string, commit: 'processed' | 'confirmed' | 'finalized') =>
        new Connection(url, { commitment: commit }));
    
    this.connections = config.rpcUrls.map((url) => factory(url, commitment));
  }

  getNetworkKey(): string {
    return this.config.networkKey;
  }

  async getTransactionHistory(address: string, limit: number = 25): Promise<NormalizedSolanaTransaction[]> {
    const publicKey = new PublicKey(address);
    const commitment = this.config.commitment ?? 'confirmed';
    let lastError: Error | undefined;
    let successfulEmptyResponse = false;

    for (const connection of this.connections) {
      try {
        const sigs = await connection.getSignaturesForAddress(publicKey, { limit }, commitment as any);

        // Empty result from a successful RPC call is valid (address has no transactions)
        if (sigs.length === 0) {
          successfulEmptyResponse = true;
          continue;
        }
        
        const results: NormalizedSolanaTransaction[] = [];

        for (const sig of sigs) {
          const signature = sig.signature;
          const slot = sig.slot;
          const timestamp = (sig.blockTime ? sig.blockTime * 1000 : Date.now());
          const sigStatus: 'confirmed' | 'failed' | 'pending' = sig.err ? 'failed' : 'confirmed';

          let parsedTx: any = null;
          try {
            parsedTx = await connection.getParsedTransaction(signature, {
              maxSupportedTransactionVersion: 0,
              commitment,
            } as any);
          } catch {
            parsedTx = null;
          }

          if (!parsedTx) {
            results.push({
              signature,
              from: address,
              to: null,
              valueLamports: 0,
              valueSol: '0',
              feeLamports: 0,
              feeSol: '0',
              slot,
              timestamp,
              status: sigStatus === 'confirmed' ? 'pending' : sigStatus,
              type: 'contract_interaction',
            });
            continue;
          }

          const message = parsedTx.transaction?.message;
          const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
          const accountBase58 = accountKeys.map(extractPubkeyBase58);
          const accountIndex = accountBase58.indexOf(address);

          const meta = parsedTx.meta;
          const feeLamports = Number(meta?.fee ?? 0);
          const preBalances: number[] = Array.isArray(meta?.preBalances) ? meta.preBalances : [];
          const postBalances: number[] = Array.isArray(meta?.postBalances) ? meta.postBalances : [];

          let deltaLamports = 0;
          if (accountIndex >= 0 && preBalances[accountIndex] !== undefined && postBalances[accountIndex] !== undefined) {
            deltaLamports = Number(postBalances[accountIndex]) - Number(preBalances[accountIndex]);
          }

          const feePayer = accountBase58[0] || '';
          let valueLamports = Math.abs(deltaLamports);

          if (deltaLamports < 0 && feePayer === address && valueLamports >= feeLamports) {
            valueLamports = Math.max(0, valueLamports - feeLamports);
          }

          let type: 'send' | 'receive' | 'contract_interaction' = 'contract_interaction';
          if (valueLamports > 0 && deltaLamports < 0) type = 'send';
          if (valueLamports > 0 && deltaLamports > 0) type = 'receive';

          const counterparty =
            type === 'send'
              ? findSolTransferCounterparty(parsedTx, address, 'send')
              : type === 'receive'
                ? findSolTransferCounterparty(parsedTx, address, 'receive')
                : null;

          const from = type === 'receive' ? (counterparty || address) : address;
          const to = type === 'send' ? (counterparty || null) : type === 'receive' ? address : null;

          results.push({
            signature,
            from,
            to,
            valueLamports,
            valueSol: lamportsToSol(valueLamports),
            feeLamports,
            feeSol: lamportsToSol(feeLamports),
            slot,
            timestamp,
            status: meta?.err ? 'failed' : sigStatus,
            type,
          });
        }

        return results;
      } catch (err) {
        lastError = err as Error;
      }
    }

    // If at least one endpoint returned a successful empty response, treat as valid empty history
    if (successfulEmptyResponse) {
      return [];
    }

    // All endpoints failed with errors
    throw new Error(
      `All Solana RPC endpoints failed for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }

  async getTokenTransactionHistory(
    ownerAddress: string,
    mintAddress: string,
    tokenSymbol: string,
    tokenDecimals: number,
    limit: number = 25
  ): Promise<NormalizedSolanaTransaction[]> {
    const ownerPubkey = new PublicKey(ownerAddress);
    const mintPubkey = new PublicKey(mintAddress);
    const commitment = this.config.commitment ?? 'confirmed';
    let lastError: Error | undefined;
    let successfulEmptyResponse = false;

    const tokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      ownerPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tokenAccountBase58 = tokenAccount.toBase58();

    for (const connection of this.connections) {
      try {
        const sigs = await connection.getSignaturesForAddress(tokenAccount, { limit }, commitment as any);

        if (sigs.length === 0) {
          successfulEmptyResponse = true;
          continue;
        }

        const results: NormalizedSolanaTransaction[] = [];

        for (const sig of sigs) {
          const signature = sig.signature;
          const slot = sig.slot;
          const timestamp = (sig.blockTime ? sig.blockTime * 1000 : Date.now());
          const sigStatus: 'confirmed' | 'failed' | 'pending' = sig.err ? 'failed' : 'confirmed';

          let parsedTx: any = null;
          try {
            parsedTx = await connection.getParsedTransaction(signature, {
              maxSupportedTransactionVersion: 0,
              commitment
            } as any);
          } catch {
            parsedTx = null;
          }

          if (!parsedTx) {
            results.push({
              signature,
              from: ownerAddress,
              to: null,
              valueLamports: 0,
              valueSol: '0',
              valueToken: '0',
              feeLamports: 0,
              feeSol: '0',
              slot,
              timestamp,
              status: sigStatus === 'confirmed' ? 'pending' : sigStatus,
              type: 'contract_interaction',
              tokenSymbol,
              tokenAddress: mintAddress,
              tokenDecimals
            });
            continue;
          }

          const message = parsedTx.transaction?.message;
          const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
          const accountBase58 = accountKeys.map(extractPubkeyBase58);
          const tokenAccountIndex = accountBase58.indexOf(tokenAccountBase58);

          const meta = parsedTx.meta;
          const feeLamports = Number(meta?.fee ?? 0);
          const preTokenBalances = Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : [];
          const postTokenBalances = Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : [];

          const preEntry = preTokenBalances.find(
            (entry: any) => entry.accountIndex === tokenAccountIndex && entry.mint === mintAddress
          );
          const postEntry = postTokenBalances.find(
            (entry: any) => entry.accountIndex === tokenAccountIndex && entry.mint === mintAddress
          );

          const preAmount = BigInt(preEntry?.uiTokenAmount?.amount ?? '0');
          const postAmount = BigInt(postEntry?.uiTokenAmount?.amount ?? '0');
          const decimals = postEntry?.uiTokenAmount?.decimals ?? preEntry?.uiTokenAmount?.decimals ?? tokenDecimals;

          const delta = postAmount - preAmount;
          const absDelta = delta < 0n ? -delta : delta;

          let type: 'send' | 'receive' | 'contract_interaction' = 'contract_interaction';
          if (absDelta > 0n && delta < 0n) type = 'send';
          if (absDelta > 0n && delta > 0n) type = 'receive';

          const counterparty =
            type === 'send'
              ? findSplTransferCounterparty(parsedTx, tokenAccountBase58, 'send')
              : type === 'receive'
                ? findSplTransferCounterparty(parsedTx, tokenAccountBase58, 'receive')
                : null;

          const from = type === 'receive' ? (counterparty || ownerAddress) : ownerAddress;
          const to = type === 'send' ? (counterparty || null) : ownerAddress;

          const valueToken = formatTokenAmountFixed(absDelta, decimals);

          results.push({
            signature,
            from,
            to,
            valueLamports: 0,
            valueSol: valueToken,
            valueToken,
            feeLamports,
            feeSol: lamportsToSol(feeLamports),
            slot,
            timestamp,
            status: meta?.err ? 'failed' : sigStatus,
            type,
            tokenSymbol,
            tokenAddress: mintAddress,
            tokenDecimals: decimals
          });
        }

        return results;
      } catch (err) {
        lastError = err as Error;
      }
    }

    if (successfulEmptyResponse) {
      return [];
    }

    throw new Error(
      `All Solana RPC endpoints failed for ${this.config.networkKey}: ${lastError?.message || 'unknown error'}`
    );
  }
}

const explorerCache = new Map<string, SolanaExplorer>();

/**
 * Get or create a cached SolanaExplorer for a network.
 */
export function getSolanaExplorer(
  networkKey: string,
  rpcUrls: string[]
): SolanaExplorer {
  const cacheKey = networkKey;
  let explorer = explorerCache.get(cacheKey);
  if (!explorer) {
    explorer = new SolanaExplorer({ networkKey, rpcUrls });
    explorerCache.set(cacheKey, explorer);
  }
  return explorer;
}

/**
 * Clear the explorer cache (useful for testing)
 */
export function clearSolanaExplorerCache(): void {
  explorerCache.clear();
}
