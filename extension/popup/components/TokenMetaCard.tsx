/**
 * @fileoverview Token metadata card for Token Details view.
 *
 * Displays contract details, decimals, network name, and explorer links using
 * the existing extension theme.
 *
 * @responsibilities
 * - Render token metadata rows
 * - Provide copy and explorer interactions
 *
 * @security
 * - Uses clipboard write for contract address copy
 */

import React from 'react';
import type { Token } from '../../../src/types/token.js';

interface TokenMetaCardProps {
  token: Token;
  networkName: string;
  explorerBaseUrl?: string | null;
  onCopy: (text: string) => void;
}

/**
 * Token metadata card.
 *
 * @param props - Component props
 * @returns Token metadata card component
 */
export default function TokenMetaCard({
  token,
  networkName,
  explorerBaseUrl,
  onCopy
}: TokenMetaCardProps) {
  const hasContract = Boolean(token.address && token.address !== 'native');
  const contractLabel = hasContract ? token.address : 'Native token';
  const explorerUrl =
    hasContract && explorerBaseUrl
      ? `${explorerBaseUrl.replace(/\/$/, '')}/token/${token.address}`
      : null;

  return (
    <div className="token-details-card">
      <div className="token-details-row">
        <span className="token-details-label">Contract</span>
        <div className="token-details-value">
          <span className="token-details-mono">{contractLabel}</span>
          {hasContract && (
            <button
              type="button"
              className="token-details-link"
              onClick={() => onCopy(token.address)}
            >
              Copy
            </button>
          )}
        </div>
      </div>
      <div className="token-details-row">
        <span className="token-details-label">Decimals</span>
        <span className="token-details-value">{token.decimals}</span>
      </div>
      <div className="token-details-row">
        <span className="token-details-label">Network</span>
        <span className="token-details-value">{networkName}</span>
      </div>
      {explorerUrl && (
        <div className="token-details-row">
          <span className="token-details-label">Explorer</span>
          <a
            className="token-details-link"
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on Explorer
          </a>
        </div>
      )}
    </div>
  );
}
