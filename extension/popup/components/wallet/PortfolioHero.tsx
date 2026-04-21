/**
 * @fileoverview Hero card for the unified portfolio view.
 *
 * Renders the aggregate USD total across every enabled chain, a subtle
 * "Updated Xs ago" indicator, and the primary Send/Receive action tiles.
 * Tapping the hero total toggles privacy mode. Kept presentational — the
 * parent wires in data from `useUnifiedPortfolio` and `useUserPreferences`.
 */
import React from 'react';
import sendIcon from '../../../assets/icons/send.svg';
import receiveIcon from '../../../assets/icons/receive.svg';

interface Props {
  /** Pre-formatted total (e.g. "$12,345.67"). Falls back to "$0.00" when null. */
  totalFormatted: string | null;
  /** `updatedAt` from the snapshot (Unix ms). Null before first load. */
  updatedAt: number | null;
  /** When true, shows "Refreshing…" instead of the timestamp. */
  refreshing: boolean;
  /** When true, hides all balance digits behind a placeholder. */
  privacyMode: boolean;
  /** Called when the user taps the `⟳` button. */
  onRefresh: () => void;
  /** Called when the user taps the hero total — toggles privacy mode. */
  onTogglePrivacy: () => void;
  onSend: () => void;
  onReceive: () => void;
}

function formatRelativeTime(updatedAt: number | null): string {
  if (updatedAt === null) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function PortfolioHero({
  totalFormatted,
  updatedAt,
  refreshing,
  privacyMode,
  onRefresh,
  onTogglePrivacy,
  onSend,
  onReceive,
}: Props) {
  const displayTotal = privacyMode ? '••••••' : (totalFormatted ?? '$0.00');
  const timestampLabel = refreshing
    ? 'Refreshing…'
    : `Updated ${formatRelativeTime(updatedAt)}`;
  return (
    <div className="balance-row">
      <div className="balance-card portfolio-hero">
        <div className="balance-header">
          <div className="balance-label">Total balance</div>
          <button
            className="refresh-link"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh portfolio"
          >
            <span className="refresh-link__inner">
              {refreshing && <RefreshSpinner />}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </span>
          </button>
        </div>
        <button
          type="button"
          className="balance-amount-display portfolio-hero__total"
          onClick={onTogglePrivacy}
          aria-live="polite"
          aria-label={privacyMode ? 'Show balance' : 'Hide balance'}
          title={privacyMode ? 'Show balance' : 'Hide balance'}
        >
          {displayTotal}
        </button>
        <div className="portfolio-hero__meta">{timestampLabel}</div>
        <div className="action-row">
          <button className="action-tile" onClick={onReceive}>
            <img src={receiveIcon} alt="" className="action-icon" />
            <span>Receive</span>
          </button>
          <button className="action-tile" onClick={onSend}>
            <img src={sendIcon} alt="" className="action-icon" />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RefreshSpinner() {
  return (
    <svg
      className="refresh-link__spinner"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2v3h-3" />
    </svg>
  );
}

export default PortfolioHero;
