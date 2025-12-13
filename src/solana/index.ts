/**
 * @fileoverview Solana module barrel export.
 *
 * Phase 1: read-only support (address + balance).
 *
 * @module solana
 */

export type { SolanaAddressInfo, SolanaBalance } from './types.js';
export { LAMPORTS_PER_SOL, lamportsToSol, solToLamports } from './types.js';

export { getSolanaDerivationPath, deriveSolanaKeypair, deriveSolanaAddress } from './address.js';

export type { SolanaProviderConfig } from './provider.js';
export { SolanaProvider, getSolanaProvider } from './provider.js';

export type { NormalizedSolanaTransaction, SolanaExplorerConfig } from './explorer.js';
export { SolanaExplorer, getSolanaExplorer, clearSolanaExplorerCache } from './explorer.js';
