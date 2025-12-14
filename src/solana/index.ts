/**
 * @fileoverview Solana module barrel export.
 *
 * Phase 1: read-only support (address + balance).
 * Phase 2: transaction history.
 * Phase 3: send SOL support.
 *
 * @module solana
 */

// Types
export type { SolanaAddressInfo, SolanaBalance } from './types.js';
export { LAMPORTS_PER_SOL, lamportsToSol, solToLamports } from './types.js';

// Address/keypair derivation
export { getSolanaDerivationPath, deriveSolanaKeypair, deriveSolanaAddress } from './address.js';

// Provider (RPC operations)
export type {
  SolanaProviderConfig,
  BlockhashInfo,
  SolanaFeeEstimate,
  SolanaConfirmationResult,
  SolanaSendResult,
} from './provider.js';
export { SolanaProvider, getSolanaProvider } from './provider.js';

// Explorer (transaction history)
export type { NormalizedSolanaTransaction, SolanaExplorerConfig } from './explorer.js';
export { SolanaExplorer, getSolanaExplorer, clearSolanaExplorerCache } from './explorer.js';

// Transaction building and signing (Phase 3)
export type { SolTransferParams, SignedSolTransfer, SolTransferResult } from './transaction.js';
export {
  BASE_FEE_LAMPORTS,
  isValidSolanaAddress,
  buildSolTransfer,
  signSolTransfer,
  buildAndSignSolTransfer,
  estimateTransferFee,
  validateSufficientBalance,
} from './transaction.js';
