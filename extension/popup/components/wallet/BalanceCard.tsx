/**
 * @fileoverview Balance hero card with quick Send / Receive actions.
 *
 * Pure presentational — owns no state. Parent passes display strings and
 * handlers. Kept separate from MainWallet so the balance surface can be
 * styled and iterated on without rebuilding the whole wallet screen.
 */
import React from 'react';
import sendIcon from '../../../assets/icons/send.svg';
import receiveIcon from '../../../assets/icons/receive.svg';

interface Props {
  /** Formatted total balance, already USD-prefixed (e.g. "$1,234.56"). */
  totalBalance: string;
  /** When true, show the refresh button in its spinning/disabled state. */
  refreshing: boolean;
  /** Disables the refresh button while prices are still loading. */
  pricesLoading: boolean;
  onRefresh: () => void;
  onSend: () => void;
  onReceive: () => void;
  /**
   * When set, a Stake action tile is rendered. Parents pass this only when
   * the active network supports staking (capability-gated, not chain-gated).
   */
  onStake?: () => void;
}

export function BalanceCard({
  totalBalance,
  refreshing,
  pricesLoading,
  onRefresh,
  onSend,
  onReceive,
  onStake,
}: Props) {
  const busy = refreshing || pricesLoading;
  return (
    <div className="balance-row">
      <div className="balance-card">
        <div className="balance-header">
          <div className="balance-label">Total balance</div>
          <button
            className="refresh-link"
            onClick={onRefresh}
            disabled={busy}
          >
            <span className="refresh-link__inner">
              {busy && <RefreshSpinner />}
              {busy ? 'Refreshing…' : 'Refresh'}
            </span>
          </button>
        </div>
        <div className="balance-amount-display">{totalBalance}</div>
        <div className="action-row">
          <button className="action-tile" onClick={onReceive}>
            <img src={receiveIcon} alt="" className="action-icon" />
            <span>Receive</span>
          </button>
          <button className="action-tile" onClick={onSend}>
            <img src={sendIcon} alt="" className="action-icon" />
            <span>Send</span>
          </button>
          {onStake && (
            <button className="action-tile" onClick={onStake}>
              <span className="action-icon" aria-hidden style={{ fontSize: 18, lineHeight: '24px' }}>◎</span>
              <span>Stake</span>
            </button>
          )}
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

export default BalanceCard;
