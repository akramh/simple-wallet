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
 */
import React from 'react';
import type { Token } from '../../../../src/types/token.js';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import { formatBalance } from '../../utils/tokenFormat';

interface TokenRow {
  token: Token;
  balance: string;
  error?: string;
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
  /** Called when a row is clicked; parent routes to token-details. */
  onSelect: (token: Token, iconSrc: string | null) => void;
  /** Show the "+ Add Custom Token" affordance (EVM networks only). */
  showAddToken: boolean;
  onAddToken: () => void;
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
        const usdValue = getUsdValue(item.token, item.balance);
        return (
          <div
            key={`${item.token.symbol}-${index}`}
            className="token-item token-item-clickable"
            onClick={() => onSelect(item.token, iconSrc)}
          >
            <div className="token-info">
              {iconSrc ? (
                <img src={iconSrc} alt={item.token.symbol} className="token-icon-img" />
              ) : (
                <div className="token-icon">
                  {item.token.symbol.substring(0, 1)}
                </div>
              )}
              <div className="token-details">
                <h3>{item.token.symbol}</h3>
                <p>{item.token.name}</p>
              </div>
            </div>
            <div className="token-balance">
              <div className="token-amount">
                {item.error ? 'Error' : formatBalance(item.balance)}
              </div>
              {usdValue && !item.error && (
                <div className="token-usd-value">{usdValue}</div>
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
