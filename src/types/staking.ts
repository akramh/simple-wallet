/**
 * @fileoverview Chain-neutral staking types shared by all UI surfaces.
 *
 * These types are the staking vocabulary the CLI and extension consume. They
 * deliberately contain no chain-specific concepts: position and validator
 * identifiers are opaque strings (Solana puts a stake-account address and a
 * vote pubkey in them; an EVM implementation could put an LST position handle
 * or validator pubkey), and lifecycle states are a superset that maps onto
 * Solana's epoch machine today and Ethereum deposit/exit-queue semantics
 * later. Adding a new staking chain must not require changes to this file's
 * consumers — only a new dispatch branch in WalletAppService.
 *
 * @module types/staking
 */

import type { NetworkType } from './config.js';

/**
 * Lifecycle state of a staking position.
 *
 * - `pending`       — submitted but not yet visible as activating (reserved
 *                     for chains with deposit queues; unused on Solana).
 * - `activating`    — stake is warming up (Solana: delegated this epoch).
 * - `active`        — stake is earning rewards.
 * - `deactivating`  — unstake requested, cooldown in progress.
 * - `withdrawable`  — funds are claimable by the wallet.
 * - `inactive`      — position exists but is not delegated or earning
 *                     (e.g. an initialized-but-undelegated Solana account).
 */
export type StakePositionState =
  | 'pending'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'withdrawable'
  | 'inactive';

/**
 * Validator (or staking operator) summary for pickers and position display.
 */
export interface ValidatorSummary {
  /** Opaque validator identifier (Solana: vote-account pubkey). */
  id: string;
  /** Human-readable name when a metadata source knows it; null otherwise. */
  name: string | null;
  /** Advertised commission percentage (0-100) when known. */
  commissionPercent: number | null;
  /** Estimated APY percentage when a metadata source provides it. */
  apyPercent: number | null;
  /**
   * Total stake delegated to this validator as a whole-unit, thousands-
   * separated display string in the chain's native unit (e.g. "430,800");
   * null when unknown. Render verbatim with the native symbol appended —
   * the separators make it non-numeric-parseable, so no unit math.
   */
  activatedStakeFormatted: string | null;
  /** True when the validator is currently delinquent / not voting. */
  delinquent: boolean;
}

/** One inflation reward paid to a staking position. */
export interface StakeRewardView {
  /** Reward amount formatted in the chain's native unit. */
  amountFormatted: string;
  /** Epoch the reward belongs to. */
  epoch: number;
  /** Slot at which the reward became effective, when provided by the chain. */
  effectiveSlot?: number;
  /** Stake-account balance immediately after the reward, formatted in native units. */
  postBalanceFormatted?: string;
  /** Validator commission applied to the reward, when provided by the chain. */
  commissionPercent?: number | null;
}

/**
 * A single staking position as rendered by the UIs.
 *
 * Amounts are formatted strings in the chain's native unit (SOL today) —
 * consumers must not do unit math on them; `amountBaseUnits` carries the
 * integer base-unit amount as a string for anything programmatic.
 */
export interface StakePositionView {
  /** Network the position lives on (e.g. 'solana-mainnet'). */
  networkKey: string;
  /** Chain family, for icon/badge selection. */
  chain: NetworkType;
  /** Opaque position identifier (Solana: stake-account address). */
  positionId: string;
  /** Validator the position is delegated to; id may be '' when undelegated. */
  validator: ValidatorSummary;
  /** Delegated amount, formatted in native units (excludes reserve). */
  amountFormatted: string;
  /** Delegated amount in base units (lamports/wei) as a decimal string. */
  amountBaseUnits: string;
  /**
   * Non-delegated balance locked in the position (Solana: rent-exempt
   * reserve), formatted in native units. Returned to the wallet on withdraw.
   */
  reserveFormatted?: string;
  /** Total balance of the position (delegated + reserve), formatted. */
  totalFormatted: string;
  /** Lifecycle state — see {@link StakePositionState}. */
  state: StakePositionState;
  /**
   * Epoch (or equivalent chain period) the position was staked at; null when
   * the chain doesn't expose it or the position is undelegated.
   */
  activationEpoch?: number | null;
  /** Epoch the unstake was requested at; null when not deactivating. */
  deactivationEpoch?: number | null;
  /** The chain's current epoch at fetch time, for "staked N epochs ago" UX. */
  currentEpoch?: number;
  /** Current slot offset within the epoch, used for progress and timing estimates. */
  currentEpochSlot?: number;
  /** Total slots in the current epoch. */
  slotsInEpoch?: number;
  /** USD value of the total balance; undefined when prices are unavailable (testnets). */
  usdValue?: number;
  /** Most recent reward amount, formatted in native units, when cheaply available. */
  lastRewardFormatted?: string;
  /** Metadata for the most recent reward, when the RPC indexes it. */
  lastReward?: StakeRewardView;
  /** Staker authority controlling delegation changes, when exposed by the chain. */
  stakerAuthority?: string;
  /** Withdrawer authority controlling fund recovery, when exposed by the chain. */
  withdrawerAuthority?: string;
}

/** Detailed, on-demand staking position data used by the extension detail view. */
export interface StakePositionDetailsView extends StakePositionView {
  /** Earliest indexed activity for the stake account, used as its creation reference. */
  accountCreatedAt?: number;
  /** Transaction signature for the earliest indexed stake-account activity. */
  accountCreationSignature?: string;
  /** Slot containing the earliest indexed stake-account activity. */
  accountCreationSlot?: number;
  /** Approximate historical native-token price nearest account creation. */
  priceAtCreationUsd?: number;
  /** Timestamp of the historical price sample used for the approximation. */
  priceAtCreationSampledAt?: number;
  /** Approximate USD value of the delegated amount at account creation. */
  valueAtCreationUsd?: number;
  /** Recent inflation rewards, newest first. */
  rewardHistory: StakeRewardView[];
}

/** Result of a staking action (stake / unstake / withdraw). */
export interface StakeActionResult {
  /** Transaction identifier (Solana: signature). */
  txId: string;
  /** Position created or acted on, when known at submit time. */
  positionId?: string;
  /** Network fee paid, formatted in native units. */
  feeFormatted: string;
}

/**
 * What staking looks like on a given network — UIs render buttons and copy
 * from this instead of hardcoding chain semantics.
 */
export interface StakingCapabilities {
  canStake: boolean;
  canUnstake: boolean;
  canWithdraw: boolean;
  /** Minimum stake amount, formatted in native units, when the chain enforces one. */
  minStakeFormatted?: string;
  /** One-line expectation-setting copy shown on the confirm screen. */
  activationNote: string;
  /** One-line copy explaining the unstake cooldown. */
  deactivationNote: string;
}
