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

// Native staking (Stake Program) — builders, state derivation, provider types
export type {
  StakePosition,
  CreateDelegateStakeParams,
  StakeAuthorityTxParams,
} from './stake.js';
export {
  STAKE_ACCOUNT_SPACE,
  STAKE_SEED_PREFIX,
  MAX_STAKE_SEED_INDEX,
  EPOCH_U64_SENTINEL,
  DEFAULT_STAKE_CU_LIMIT,
  deriveStakeAccountAddress,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
  buildWithdrawStakeTx,
  signStakeTx,
  deriveStakeState,
  parseStakeAccount,
} from './stake.js';
export type { SolanaEpochInfo, VoteAccountSummary } from './provider.js';
export { STAKE_WITHDRAWER_OFFSET } from './provider.js';

// Stakewiz validator metadata (the one non-Alchemy external API for staking)
export type { StakewizValidatorEntry } from './stakewiz.js';
export { fetchStakewizValidators, STAKEWIZ_API_BASE } from './stakewiz.js';
