/**
 * @fileoverview Empty-state for the unified portfolio.
 *
 * Rendered when the wallet is unlocked and the cache has zero non-native
 * tokens with balance (typical for brand-new mnemonic wallets). Promotes the
 * Receive flow since there's nothing to send yet.
 */
import React from 'react';
import EmptyState from '../ui/EmptyState';

interface Props {
  onReceive: () => void;
  /** When true, hides the Receive CTA — e.g. when a single-chain private-key wallet lacks a native address. */
  receiveDisabled?: boolean;
}

export function EmptyPortfolio({ onReceive, receiveDisabled }: Props) {
  return (
    <div className="empty-portfolio">
      <EmptyState
        icon="wallet"
        title="No tokens yet"
        subtitle="Tokens you receive across any supported chain will appear here."
      />
      {!receiveDisabled && (
        <div className="empty-portfolio__actions">
          <button type="button" className="btn btn-primary" onClick={onReceive}>
            Receive
          </button>
        </div>
      )}
    </div>
  );
}

export default EmptyPortfolio;
