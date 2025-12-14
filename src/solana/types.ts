/**
 * @fileoverview Solana-specific type definitions and unit helpers.
 *
 * Phase 1: read-only (address + balance).
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

export interface SolanaAddressInfo {
  address: string;
  publicKeyBase58: string;
  derivationPath: string;
}

export interface SolanaBalance {
  lamports: number;
}

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

export function solToLamports(sol: string | number): number {
  const solNum = typeof sol === 'string' ? parseFloat(sol) : sol;
  return Math.round(solNum * LAMPORTS_PER_SOL);
}

