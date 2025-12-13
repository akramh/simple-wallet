/**
 * @fileoverview Solana provider (read-only) - balance queries via RPC.
 *
 * Phase 1: read-only support (address + SOL balance).
 *
 * @module solana/provider
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { lamportsToSol } from './types.js';

export interface SolanaProviderConfig {
  networkKey: string;
  rpcUrls: string[];
  commitment?: 'processed' | 'confirmed' | 'finalized';
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

