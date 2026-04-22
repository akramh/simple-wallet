/**
 * @fileoverview Types for the unified cross-chain portfolio view.
 *
 * A unified portfolio snapshot is an aggregation of per-network token balances
 * with their USD values, flattened into a single sortable list. The extension
 * popup consumes a snapshot via `GET_UNIFIED_PORTFOLIO` to render the
 * all-networks token list.
 *
 * @responsibilities
 * - Define the shape of the unified snapshot and its rows
 * - Define the sort discriminator shared by UI and aggregator
 * - Define the per-network input to the aggregator
 */

import type { Token } from './token.js';

/**
 * Sort mode for unified token rows.
 *
 * - `fiat`: USD value descending; rows without a price fall to the bottom.
 * - `alpha`: Token name ascending (A → Z), tie-broken by network label.
 * - `chain`: Network label ascending, then USD descending within a network.
 */
export type TokenSort = 'fiat' | 'alpha' | 'chain';

/**
 * One row in the unified token list.
 *
 * Timestamps are Unix milliseconds; `balance` is a decimal string in display
 * units (not base units), matching the SDK's per-chain portfolio output.
 */
export interface UnifiedTokenRow {
  /** Stable React key — `${networkKey}:${tokenKey}` where tokenKey is "native" or lowercase contract address. */
  rowKey: string;
  /** Network key this row belongs to (e.g. "mainnet", "base", "solana-mainnet"). */
  networkKey: string;
  /** Human-readable network label (e.g. "Ethereum", "Base"). */
  networkLabel: string;
  /** Optional icon asset name or URI for the chain badge overlay. */
  chainBadgeIcon?: string;
  /** The token definition. */
  token: Token;
  /** Balance as a decimal string in display units (e.g. "1.234"). */
  balance: string;
  /** Balance parsed as a number for sort and USD math. NaN values become 0. */
  balanceNumber: number;
  /** USD value (balance * price), or null if no price is available. */
  usdValue: number | null;
  /** Formatted USD value (e.g. "$1,234.56") or null when price unavailable. */
  usdFormatted: string | null;
  /** When the cached balance was last updated (Unix ms). */
  lastUpdated: number;
  /** True when `now - lastUpdated > balanceCacheTtlMs`. */
  stale: boolean;
  /** Optional error captured during balance fetch for this token. */
  error?: string;
}

/**
 * A full snapshot rendered by `buildUnifiedPortfolio()`.
 */
export interface UnifiedPortfolioSnapshot {
  /** Rows in the chosen sort order, after zero-balance filtering. */
  rows: UnifiedTokenRow[];
  /** Sum of all `row.usdValue` that are non-null. */
  totalUsd: number;
  /** Formatted `totalUsd`. */
  totalUsdFormatted: string;
  /** Per-network staleness in ms — max `now - lastUpdated` across that network's rendered rows. */
  networkStaleness: Record<string, number>;
  /** When this snapshot was built (Unix ms). */
  updatedAt: number;
  /** True when the wallet was locked at snapshot time — rows will be empty. */
  locked?: boolean;
}

/**
 * Per-network input to the aggregator. The service worker fetches balances and
 * prices once per chain, then hands the aggregator a flat list of these.
 */
export interface NetworkPortfolioInput {
  /** Network key. */
  networkKey: string;
  /** Display label for the chain. */
  networkLabel: string;
  /** Optional chain badge icon asset name or URI. */
  chainBadgeIcon?: string;
  /** Per-token cached balance + price entries for this network. */
  balances: NetworkPortfolioEntry[];
}

/**
 * One token's cached balance + resolved price for a single network.
 */
export interface NetworkPortfolioEntry {
  token: Token;
  /** Balance in display units. */
  balance: string;
  /** When the balance was last fetched (Unix ms). */
  lastUpdated: number;
  /** Per-token USD price (price per 1 unit), or null if unavailable. */
  priceUsd: number | null;
  /** Optional error captured during balance fetch. */
  error?: string;
}

/**
 * Options controlling aggregation, sort, and network filtering.
 *
 * These are the knobs that define a snapshot's identity: any change that
 * affects what the snapshot contains or how it's sorted must live here (not
 * in hidden global state) so that UI dep-array machinery can invalidate the
 * snapshot automatically when the user flips a toggle. The popup stringifies
 * this object into a cache key — see `useUnifiedPortfolio.optionsKey`.
 */
export interface BuildUnifiedPortfolioOptions {
  /** When false (default), rows with a zero balance are hidden — except native tokens. */
  showZeroBalances?: boolean;
  /** Sort mode; defaults to `'fiat'`. */
  sort?: TokenSort;
  /** Staleness threshold in ms; defaults to 5 minutes. */
  balanceCacheTtlMs?: number;
  /** Override current time for deterministic tests. */
  now?: number;
  /**
   * Include testnet networks in the snapshot. When omitted, the snapshot
   * builder falls back to the persisted user preference
   * (`walletService.config.showTestnets`) — so background refreshes pick up
   * the saved default while the popup, which reads the preference on mount,
   * stays authoritative about the *currently visible* filter.
   *
   * Testnet rows always render with `usdValue: null` regardless of this flag
   * (see the price-resolver guard in the service worker) so `totalUsd` never
   * double-counts mainnet + testnet balances for tokens sharing a symbol.
   */
  showTestnets?: boolean;
}
