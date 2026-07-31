/**
 * @fileoverview Solana native staking: transaction builders and state derivation.
 *
 * Pure module — no network access. Builds Stake Program transactions
 * (create+delegate, deactivate, withdraw) and derives position lifecycle
 * state from parsed stake-account data. RPC lives in provider.ts; policy
 * (guards, keypair handling) lives in WalletAppService.
 *
 * Stake accounts are created with `createAccountWithSeed` (base = wallet
 * pubkey, seed = "stake:{i}") so a single wallet signature suffices and
 * addresses are deterministic. Discovery does NOT depend on seeds — the
 * provider scans the Stake Program by withdrawer authority — so positions
 * created by other wallets for this authority are also found.
 *
 * @responsibilities
 * - Build unsigned Stake Program transactions (create+delegate / deactivate / withdraw)
 * - Derive activation state from parsed account data + current epoch
 * - Parse `jsonParsed` stake accounts into chain-neutral positions
 *
 * @security
 * - Does not persist or log private keys; callers provide keypairs
 * - `getStakeActivation` RPC is deprecated network-wide — activation state
 *   MUST be derived here from epochs, never fetched. Do not reintroduce it.
 * - Both staker and withdrawer authorities are set to the wallet pubkey so
 *   no secondary key material ever needs storing
 *
 * @module solana/stake
 */

import {
  Authorized,
  Keypair,
  Lockup,
  PublicKey,
  StakeProgram,
  Transaction,
  ComputeBudgetProgram,
  type Blockhash,
} from '@solana/web3.js';
import { lamportsToSol } from './types.js';
import { signSolTransfer, type SignedSolTransfer } from './transaction.js';
import type { StakePositionState } from '../types/staking.js';

/**
 * Size in bytes of a Stake Program account. Used for rent-exemption queries.
 * Mirrors `StakeProgram.space` but pinned as a constant so tests and callers
 * don't depend on web3.js internals.
 */
export const STAKE_ACCOUNT_SPACE = 200;

/**
 * Seed prefix for wallet-derived stake accounts. Account i lives at
 * `PublicKey.createWithSeed(walletPubkey, `${STAKE_SEED_PREFIX}${i}`, StakeProgram.programId)`.
 */
export const STAKE_SEED_PREFIX = 'stake:';

/** Upper bound on the seed-index scan when looking for a free stake address. */
export const MAX_STAKE_SEED_INDEX = 64;

/**
 * The u64 sentinel Solana uses for "no deactivation epoch" in jsonParsed
 * delegation data (u64::MAX as a decimal string).
 */
export const EPOCH_U64_SENTINEL = '18446744073709551615';

/** A wallet-owned staking position, in Solana-native units. */
export interface StakePosition {
  /** Stake account address (base58). */
  stakeAccountAddress: string;
  /** Vote account the stake is delegated to; null when undelegated. */
  votePubkey: string | null;
  /** Delegated amount in lamports (0 when undelegated). */
  delegatedLamports: number;
  /** Rent-exempt reserve locked in the account, in lamports. */
  rentExemptReserveLamports: number;
  /** Full account balance (delegation + reserve + any excess), in lamports. */
  totalLamports: number;
  /** Derived lifecycle state (chain-neutral vocabulary). */
  state: StakePositionState;
  /** Epoch the delegation was created; null when undelegated. */
  activationEpoch: number | null;
  /** Epoch deactivation was requested; null when not deactivating. */
  deactivationEpoch: number | null;
  /** Withdrawer authority on the account (base58); '' if unparsable. */
  withdrawerAuthority: string;
  /** Staker authority on the account (base58); '' if unparsable. */
  stakerAuthority: string;
}

/** Parameters for building the create-and-delegate transaction. */
export interface CreateDelegateStakeParams {
  /** Wallet pubkey — fee payer, funding source, and both stake authorities. */
  walletPubkey: PublicKey;
  /** Pre-derived stake account address (see {@link deriveStakeAccountAddress}). */
  stakeAccountPubkey: PublicKey;
  /** Seed used to derive `stakeAccountPubkey` (e.g. "stake:0"). */
  seed: string;
  /** Total lamports to fund the account with (delegation + rent reserve). */
  lamports: number;
  /** Validator vote-account pubkey to delegate to. */
  votePubkey: PublicKey;
  recentBlockhash: Blockhash;
  lastValidBlockHeight: number;
  /** Optional priority fee (see SolTransferParams for semantics). */
  priorityFeeMicroLamports?: number;
  /** Compute-unit limit when a priority fee is set. */
  computeUnitLimit?: number;
}

/** Parameters for deactivate / withdraw builders. */
export interface StakeAuthorityTxParams {
  /** Wallet pubkey — fee payer and stake/withdraw authority. */
  walletPubkey: PublicKey;
  /** Stake account being acted on. */
  stakeAccountPubkey: PublicKey;
  recentBlockhash: Blockhash;
  lastValidBlockHeight: number;
  priorityFeeMicroLamports?: number;
  computeUnitLimit?: number;
}

/**
 * Generous compute-unit ceiling for stake transactions when a priority fee is
 * requested. Stake Program instructions run well under this; the limit only
 * bounds the priority-fee cost (rate × limit), never the base fee.
 */
export const DEFAULT_STAKE_CU_LIMIT = 20_000;

/**
 * Derive the deterministic stake-account address for a wallet and seed.
 *
 * @param base - Wallet public key (the createWithSeed base)
 * @param seed - Seed string, normally `${STAKE_SEED_PREFIX}${index}`
 * @returns The derived stake-account address
 * @async
 */
export async function deriveStakeAccountAddress(base: PublicKey, seed: string): Promise<PublicKey> {
  return PublicKey.createWithSeed(base, seed, StakeProgram.programId);
}

function applyPriorityFee(
  transaction: Transaction,
  priorityFeeMicroLamports?: number,
  computeUnitLimit?: number
): void {
  if (typeof priorityFeeMicroLamports === 'number' && priorityFeeMicroLamports > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnitLimit ?? DEFAULT_STAKE_CU_LIMIT,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports })
    );
  }
}

/**
 * Build an unsigned transaction that creates a seed-derived stake account
 * funded with `lamports` and delegates it to `votePubkey` in one atomic tx.
 *
 * Both the staker and withdrawer authorities are set to `walletPubkey`
 * (see module @security notes). Lockup is left at its default (none).
 *
 * @param params - See {@link CreateDelegateStakeParams}
 * @returns Unsigned transaction (single required signature: the wallet)
 * @throws Error when `lamports` is not a positive amount
 */
export function buildCreateAndDelegateStakeTx(params: CreateDelegateStakeParams): Transaction {
  const {
    walletPubkey,
    stakeAccountPubkey,
    seed,
    lamports,
    votePubkey,
    recentBlockhash,
    lastValidBlockHeight,
    priorityFeeMicroLamports,
    computeUnitLimit,
  } = params;

  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Stake amount must be greater than 0');
  }

  const transaction = new Transaction({
    feePayer: walletPubkey,
    blockhash: recentBlockhash,
    lastValidBlockHeight,
  });

  applyPriorityFee(transaction, priorityFeeMicroLamports, computeUnitLimit);

  // createAccountWithSeed + initialize; both authorities = wallet.
  transaction.add(
    ...StakeProgram.createAccountWithSeed({
      fromPubkey: walletPubkey,
      stakePubkey: stakeAccountPubkey,
      basePubkey: walletPubkey,
      seed,
      authorized: new Authorized(walletPubkey, walletPubkey),
      lockup: new Lockup(0, 0, PublicKey.default),
      lamports,
    }).instructions
  );

  transaction.add(
    ...StakeProgram.delegate({
      stakePubkey: stakeAccountPubkey,
      authorizedPubkey: walletPubkey,
      votePubkey,
    }).instructions
  );

  return transaction;
}

/**
 * Build an unsigned transaction deactivating a stake account (begin unstake).
 * The cooldown completes at the next epoch boundary; funds become
 * withdrawable after that.
 *
 * @param params - See {@link StakeAuthorityTxParams}
 * @returns Unsigned transaction
 */
export function buildDeactivateStakeTx(params: StakeAuthorityTxParams): Transaction {
  const transaction = new Transaction({
    feePayer: params.walletPubkey,
    blockhash: params.recentBlockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  });
  applyPriorityFee(transaction, params.priorityFeeMicroLamports, params.computeUnitLimit);
  transaction.add(
    ...StakeProgram.deactivate({
      stakePubkey: params.stakeAccountPubkey,
      authorizedPubkey: params.walletPubkey,
    }).instructions
  );
  return transaction;
}

/**
 * Build an unsigned transaction withdrawing `lamports` from a stake account
 * to the wallet. v1 callers always withdraw the full balance, which closes
 * the account and returns the rent-exempt reserve.
 *
 * @param params - See {@link StakeAuthorityTxParams}
 * @param lamports - Amount to withdraw (full balance in v1)
 * @returns Unsigned transaction
 * @throws Error when `lamports` is not a positive amount
 */
export function buildWithdrawStakeTx(params: StakeAuthorityTxParams, lamports: number): Transaction {
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Withdraw amount must be greater than 0');
  }
  const transaction = new Transaction({
    feePayer: params.walletPubkey,
    blockhash: params.recentBlockhash,
    lastValidBlockHeight: params.lastValidBlockHeight,
  });
  applyPriorityFee(transaction, params.priorityFeeMicroLamports, params.computeUnitLimit);
  transaction.add(
    ...StakeProgram.withdraw({
      stakePubkey: params.stakeAccountPubkey,
      authorizedPubkey: params.walletPubkey,
      toPubkey: params.walletPubkey,
      lamports,
    }).instructions
  );
  return transaction;
}

/**
 * Sign a stake transaction with the wallet keypair. Same shape as
 * signSolTransfer — all stake txs need exactly the wallet signature.
 *
 * @param transaction - Unsigned stake transaction
 * @param keypair - Wallet keypair
 * @returns Signed transaction with serialized bytes and base64 signature
 */
export function signStakeTx(transaction: Transaction, keypair: Keypair): SignedSolTransfer {
  return signSolTransfer(transaction, keypair);
}

/**
 * Derive the lifecycle state of a stake position from its epochs.
 *
 * Rules (stake transitions happen at epoch *boundaries*):
 * - never delegated                       → 'inactive'
 * - deactivation requested this epoch or
 *   later (clock skew)                    → 'deactivating'
 * - deactivation completed (past epoch)   → 'withdrawable'
 * - activation epoch is current or later  → 'activating'
 * - otherwise                             → 'active'
 *
 * @param parsed - Epochs from the parsed delegation (null = not set)
 * @param currentEpoch - Current epoch from getEpochInfo
 * @returns Derived state
 */
export function deriveStakeState(
  parsed: { activationEpoch: number | null; deactivationEpoch: number | null },
  currentEpoch: number
): StakePositionState {
  const { activationEpoch, deactivationEpoch } = parsed;

  if (activationEpoch === null) {
    return 'inactive';
  }

  if (deactivationEpoch !== null) {
    return deactivationEpoch >= currentEpoch ? 'deactivating' : 'withdrawable';
  }

  return activationEpoch >= currentEpoch ? 'activating' : 'active';
}

/**
 * Parse one epoch field from jsonParsed delegation data. Values arrive as
 * decimal strings; u64::MAX means "not set".
 */
function parseEpoch(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  if (str === EPOCH_U64_SENTINEL) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse a `jsonParsed` Stake Program account (as returned by
 * getParsedProgramAccounts) into a {@link StakePosition}.
 *
 * Handles both `type: 'delegated'` and `type: 'initialized'` accounts; the
 * latter have no delegation and derive to state 'inactive'. Returns null for
 * accounts that don't match the expected parsed shape (defensive — RPC
 * responses are external input).
 *
 * @param entry - One element of the getParsedProgramAccounts result
 * @param currentEpoch - Current epoch from getEpochInfo
 * @returns Parsed position, or null when the account shape is unrecognized
 */
export function parseStakeAccount(entry: unknown, currentEpoch: number): StakePosition | null {
  const e = entry as {
    pubkey?: { toBase58?: () => string } | string;
    account?: {
      lamports?: number;
      data?: { program?: string; parsed?: { type?: string; info?: any } };
    };
  };

  const pubkey =
    typeof e?.pubkey === 'string' ? e.pubkey : e?.pubkey?.toBase58?.();
  const parsedData = e?.account?.data?.parsed;
  if (!pubkey || e?.account?.data?.program !== 'stake' || !parsedData?.info) {
    return null;
  }

  const info = parsedData.info;
  const meta = info.meta ?? {};
  const rentExemptReserveLamports = Number(meta.rentExemptReserve ?? 0) || 0;
  const totalLamports = Number(e.account?.lamports ?? 0) || 0;

  const delegation = info.stake?.delegation;
  const activationEpoch = delegation ? parseEpoch(delegation.activationEpoch) : null;
  const deactivationEpoch = delegation ? parseEpoch(delegation.deactivationEpoch) : null;
  const delegatedLamports = delegation ? Number(delegation.stake ?? 0) || 0 : 0;

  return {
    stakeAccountAddress: pubkey,
    votePubkey: delegation?.voter ?? null,
    delegatedLamports,
    rentExemptReserveLamports,
    totalLamports,
    state: deriveStakeState({ activationEpoch, deactivationEpoch }, currentEpoch),
    activationEpoch,
    deactivationEpoch,
    withdrawerAuthority: meta.authorized?.withdrawer ?? '',
    stakerAuthority: meta.authorized?.staker ?? '',
  };
}

/**
 * Format a lamport amount as SOL for display. Thin alias so stake consumers
 * don't import from two modules.
 */
export const stakeLamportsToSol = lamportsToSol;
