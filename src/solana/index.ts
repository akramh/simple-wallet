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
export { 
  getSolanaDerivationPath, 
  deriveSolanaKeypair, 
  deriveSolanaAddress,
  deriveSolanaAddressFromSecretKey
} from './address.js';

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
  DEFAULT_SOL_TRANSFER_CU_LIMIT,
  isValidSolanaAddress,
  buildSolTransfer,
  signSolTransfer,
  buildAndSignSolTransfer,
  estimateTransferFee,
  validateSufficientBalance,
  pickPriorityFeePercentile,
  priorityFeeLamports,
} from './transaction.js';

// Fee-estimate params: optional tx context that upgrades estimateFee() from
// the flat 5000-lamport base fee to a getFeeForMessage + priority-fee-sample
// result. `SolanaFeeEstimate` itself is already re-exported above.
export type { SolanaFeeEstimateParams } from './provider.js';
