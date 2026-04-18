/**
 * @fileoverview Token list for the wallet main view.
 *
 * Renders either a loading skeleton (4 placeholder rows) or the actual
 * portfolio with optional "Add Custom Token" CTA and an empty state.
 *
 * This is intentionally dumb — all icon resolution, USD math, and row
 * selection is handled by the parent via callbacks. Keeps the tokens
 * surface presentational so the balance screen can be iterated without
 * rebuilding MainWallet.
 *
 * When running in the unified cross-chain view, each row can carry an
 * optional chain-badge icon overlay plus a secondary label (e.g. "ETH ·
 * Base") and a stable `rowKey` used as the React key across sort changes.
 */
import React from 'react';
import type { Token } from '../../../../src/types/token.js';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import { formatBalance } from '../../utils/tokenFormat';

export interface TokenRow {
  token: Token;
  balance: string;
  error?: string;
  /**
   * Stable identity for the row; if present, used as the React key instead of
   * `symbol-index` so rows preserve their DOM nodes across reorders (needed
   * for per-row focus + transitions in the unified view).
   */
  rowKey?: string;
  /** Optional small chain-badge icon layered on the bottom-right of the token icon. */
  chainBadgeIcon?: string | null;
  /** Tooltip for the chain badge. */
  chainBadgeLabel?: string;
  /** Optional secondary line (e.g. "ETH · Base"). Replaces the default token name when provided. */
  secondaryLabel?: string;
  /** Network key propagated to `onSelect` so unified-view taps route to the right chain. */
  networkKey?: string;
  /** True when the cached balance is older than the freshness threshold. */
  stale?: boolean;
  /** Pre-formatted USD value; when provided, takes precedence over `getUsdValue`. */
  usdFormatted?: string | null;
}

interface Props {
  items: TokenRow[];
  loading: boolean;
  /**
   * Resolve a token to its icon URL, or null to render the first-letter
   * fallback circle. Parent owns the icon map.
   */
  getIcon: (token: Token) => string | null;
  /** Format a token balance into a USD string or null when no price is known. */
  getUsdValue: (token: Token, balance: string) => string | null;
  /** Called when a row is clicked; parent routes to token-details. Receives the row's networkKey when present. */
  onSelect: (token: Token, iconSrc: string | null, networkKey?: string) => void;
  /** Show the "+ Add Custom Token" affordance (EVM networks only). */
  showAddToken: boolean;
  onAddToken: () => void;
  /** When true, replace balance + USD digits with `••••` placeholders. */
  privacyMode?: boolean;
}

function LoadingSkeleton() {
  return (
    <div className="token-list">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="token-item token-item--skeleton">
          <div className="token-info">
            <Skeleton width={34} height={34} borderRadius="50%" />
            <div className="token-details">
              <Skeleton width={40} height={14} style={{ marginBottom: 4 }} />
              <Skeleton width={80} height={12} />
            </div>
          </div>
          <div className="token-balance token-balance--skeleton">
            <Skeleton width={60} height={15} style={{ marginBottom: 4 }} />
            <Skeleton width={40} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokenList({
  items,
  loading,
  getIcon,
  getUsdValue,
  onSelect,
  showAddToken,
  onAddToken,
  privacyMode = false,
}: Props) {
  if (loading) return <LoadingSkeleton />;

  if (items.length === 0 && !showAddToken) {
    return (
      <EmptyState
        icon="wallet"
        title="No tokens here yet"
        subtitle="Tokens you receive on this network will appear here."
      />
    );
  }

  return (
    <div className="token-list">
      {items.map((item, index) => {
        const iconSrc = getIcon(item.token);
        const usdValue = item.usdFormatted !== undefined
          ? item.usdFormatted
          : getUsdValue(item.token, item.balance);
        const rowKey = item.rowKey ?? `${item.token.symbol}-${index}`;
        const secondary = item.secondaryLabel ?? item.token.name;
        const rowClass = [
          'token-item',
          'token-item-clickable',
          item.stale ? 'token-item--stale' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={rowKey}
            className={rowClass}
            onClick={() => onSelect(item.token, iconSrc, item.networkKey)}
          >
            <div className="token-info">
              <div className="token-icon-wrap">
                {iconSrc ? (
                  <img src={iconSrc} alt={item.token.symbol} className="token-icon-img" />
                ) : (
                  <div className="token-icon">
                    {item.token.symbol.substring(0, 1)}
                  </div>
                )}
                {item.chainBadgeIcon && (
                  <img
                    src={item.chainBadgeIcon}
                    alt={item.chainBadgeLabel || ''}
                    title={item.chainBadgeLabel}
                    className="token-chain-badge"
                  />
                )}
              </div>
              <div className="token-details">
                <h3>{item.token.symbol}</h3>
                <p>{secondary}</p>
              </div>
            </div>
            <div className="token-balance">
              <div className="token-amount">
                {item.error ? 'Error' : privacyMode ? '••••' : formatBalance(item.balance)}
              </div>
              {usdValue && !item.error && (
                <div className="token-usd-value">{privacyMode ? '••••' : usdValue}</div>
              )}
              {!usdValue && <div className="token-symbol">{item.token.symbol}</div>}
            </div>
          </div>
        );
      })}

      {showAddToken && (
        <button
          className="token-item token-item--add-cta"
          onClick={onAddToken}
          type="button"
        >
          <span>+ Add Custom Token</span>
        </button>
      )}
    </div>
  );
}

export default TokenList;
