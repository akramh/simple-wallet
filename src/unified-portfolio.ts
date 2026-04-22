/**
 * @fileoverview Pure aggregator for the unified cross-chain portfolio view.
 *
 * Takes per-network cached balances and resolved prices (one input per chain)
 * and produces a sorted, filtered list of rows plus an aggregate USD total.
 * The aggregator has no Chrome / fetch / storage dependencies — all I/O happens
 * in the service worker; this module just reshapes and sorts data so it can
 * be unit-tested deterministically.
 *
 * @responsibilities
 * - Merge per-network balance + price inputs into a single `UnifiedTokenRow[]`
 * - Apply the zero-balance filter (keeps native tokens even at 0)
 * - Sort by fiat / alphabetical / chain
 * - Compute per-network staleness and aggregate USD total
 *
 * @security
 * - Pure, side-effect-free reshape; no secrets, no network calls
 */

import type { Token } from './types/token.js';
import type {
  BuildUnifiedPortfolioOptions,
  NetworkPortfolioEntry,
  NetworkPortfolioInput,
  TokenSort,
  UnifiedPortfolioSnapshot,
  UnifiedTokenRow,
} from './types/unified-portfolio.js';

// ============================================================================
// Constants
// ============================================================================

/** Default staleness threshold in ms. */
const DEFAULT_BALANCE_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// Public API
// ============================================================================

/**
 * Build a unified cross-chain portfolio snapshot from per-network inputs.
 *
 * Invariants:
 * - Rows preserve insertion order within a network before the sort pass, so
 *   ties tie-break to the caller's original per-network ordering.
 * - Native tokens are never hidden by the zero-balance filter.
 * - `totalUsd` sums only rows with a non-null `usdValue`; null values are
 *   treated as 0 for totalling (not as "unknown").
 * - `networkStaleness[key]` is the max staleness across rows rendered from
 *   that network; a network with no rendered rows is omitted from the map.
 *
 * @param inputs - One entry per network; each carries its own token list.
 * @param options - Sort + filter knobs (see {@link BuildUnifiedPortfolioOptions}).
 * @returns A {@link UnifiedPortfolioSnapshot} ready for the UI layer.
 */
export function buildUnifiedPortfolio(
  inputs: NetworkPortfolioInput[],
  options: BuildUnifiedPortfolioOptions = {}
): UnifiedPortfolioSnapshot {
  const showZero = options.showZeroBalances ?? false;
  const sort: TokenSort = options.sort ?? 'fiat';
  const ttlMs = options.balanceCacheTtlMs ?? DEFAULT_BALANCE_CACHE_TTL_MS;
  const now = options.now ?? Date.now();

  const rows: UnifiedTokenRow[] = [];
  const networkStaleness: Record<string, number> = {};

  for (const net of inputs) {
    for (const entry of net.balances) {
      const row = buildRow(net, entry, now, ttlMs);
      if (shouldHide(row, showZero)) continue;

      rows.push(row);
      const prev = networkStaleness[net.networkKey];
      const staleness = now - entry.lastUpdated;
      networkStaleness[net.networkKey] = prev === undefined
        ? staleness
        : Math.max(prev, staleness);
    }
  }

  sortRows(rows, sort);

  const totalUsd = rows.reduce((sum, r) => sum + (r.usdValue ?? 0), 0);

  return {
    rows,
    totalUsd,
    totalUsdFormatted: formatUsd(totalUsd),
    networkStaleness,
    updatedAt: now,
  };
}

/**
 * Format a USD value for UI display.
 *
 * - `null` → `"—"`
 * - 0 → `"$0.00"`
 * - Values < 0.01 → `"<$0.01"`
 * - Values ≥ 0.01 → locale-grouped with 2 fraction digits
 *
 * Kept here (not imported from `ui-helpers.ts`) because that module's formatter
 * wraps output in chalk color codes for CLI output, which leak through the
 * extension's React layer as raw ANSI sequences.
 */
export function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '$0.00';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Canonical per-network token key used in `rowKey`.
 *
 * `"native"` for native tokens; lowercased contract address for everything
 * else. EVM addresses are lowercased because checksummed and non-checksummed
 * variants should collapse to one row. Solana / TON / XRP token addresses
 * are also lowercased — their own address formats are case-sensitive, but
 * collisions between distinct base58 mints under case folding are negligible
 * for cache identity (and the aggregator is a reshape layer, not a signer).
 */
export function getTokenKey(token: Token): string {
  if (token.type === 'native') return 'native';
  return (token.address || 'native').toLowerCase();
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildRow(
  net: NetworkPortfolioInput,
  entry: NetworkPortfolioEntry,
  now: number,
  ttlMs: number
): UnifiedTokenRow {
  const balanceNumber = toNumber(entry.balance);
  const usdValue = entry.priceUsd !== null && entry.priceUsd !== undefined
    ? balanceNumber * entry.priceUsd
    : null;
  const tokenKey = getTokenKey(entry.token);
  const staleness = now - entry.lastUpdated;

  return {
    rowKey: `${net.networkKey}:${tokenKey}`,
    networkKey: net.networkKey,
    networkLabel: net.networkLabel,
    chainBadgeIcon: net.chainBadgeIcon,
    token: entry.token,
    balance: entry.balance,
    balanceNumber,
    usdValue,
    usdFormatted: usdValue !== null ? formatUsd(usdValue) : null,
    lastUpdated: entry.lastUpdated,
    stale: staleness > ttlMs,
    isTestnet: net.isTestnet ?? false,
    error: entry.error,
  };
}

function shouldHide(row: UnifiedTokenRow, showZero: boolean): boolean {
  if (showZero) return false;
  // Rows carrying an error message are kept regardless of balance — they
  // are diagnostic information the user needs to see (RPC down, explorer
  // unreachable, etc.) rather than "empty" rows.
  if (row.error) return false;
  // Hide any zero-balance row. Natives aren't special-cased any more — a
  // wallet that hasn't touched Avalanche shouldn't render a 0 AVAX row by
  // default, even though AVAX is native to that chain. Users who want
  // empty natives for tap-to-receive can flip the "Show zero balances"
  // toggle in the unified controls.
  return row.balanceNumber === 0;
}

function toNumber(balance: string): number {
  const n = parseFloat(balance);
  return Number.isFinite(n) ? n : 0;
}

function sortRows(rows: UnifiedTokenRow[], sort: TokenSort): void {
  switch (sort) {
    case 'alpha':
      rows.sort(compareAlpha);
      return;
    case 'chain':
      rows.sort(compareChain);
      return;
    case 'fiat':
    default:
      rows.sort(compareFiat);
  }
}

/**
 * Fiat sort:
 *   1. Non-null USD rows first, by USD descending.
 *   2. Null-USD rows second, by raw balance descending.
 *   3. Final tie-break by networkKey then symbol for determinism.
 */
function compareFiat(a: UnifiedTokenRow, b: UnifiedTokenRow): number {
  const aHasUsd = a.usdValue !== null;
  const bHasUsd = b.usdValue !== null;
  if (aHasUsd !== bHasUsd) return aHasUsd ? -1 : 1;
  if (aHasUsd && bHasUsd) {
    const diff = (b.usdValue as number) - (a.usdValue as number);
    if (diff !== 0) return diff;
  } else {
    const diff = b.balanceNumber - a.balanceNumber;
    if (diff !== 0) return diff;
  }
  return tieBreak(a, b);
}

function compareAlpha(a: UnifiedTokenRow, b: UnifiedTokenRow): number {
  const byName = a.token.name.localeCompare(b.token.name);
  if (byName !== 0) return byName;
  return tieBreak(a, b);
}

function compareChain(a: UnifiedTokenRow, b: UnifiedTokenRow): number {
  const byNet = a.networkLabel.localeCompare(b.networkLabel);
  if (byNet !== 0) return byNet;
  return compareFiat(a, b);
}

function tieBreak(a: UnifiedTokenRow, b: UnifiedTokenRow): number {
  const byNet = a.networkKey.localeCompare(b.networkKey);
  if (byNet !== 0) return byNet;
  return a.token.symbol.localeCompare(b.token.symbol);
}
