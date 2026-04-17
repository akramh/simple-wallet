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
}

export function BalanceCard({
  totalBalance,
  refreshing,
  pricesLoading,
  onRefresh,
  onSend,
  onReceive,
}: Props) {
  return (
    <div className="balance-row">
      <div className="balance-card">
        <div className="balance-header">
          <div className="balance-label">Total Balance</div>
          <button
            className="refresh-link"
            onClick={onRefresh}
            disabled={refreshing || pricesLoading}
          >
            {refreshing || pricesLoading ? 'Refreshing...' : 'Refresh'}
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
        </div>
      </div>
    </div>
  );
}

export default BalanceCard;
