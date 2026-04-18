/**
 * @fileoverview Shimmer skeleton rows for the unified portfolio before the
 * first snapshot arrives (cache-miss path after a fresh install or unlock).
 *
 * Subsequent refreshes render in place from cached data without flashing a
 * full skeleton — the hook keeps the previous snapshot mounted while the
 * refresh request is in flight.
 */
import React from 'react';
import Skeleton from '../ui/Skeleton';

interface Props {
  count?: number;
}

export function TokenRowSkeleton({ count = 6 }: Props) {
  return (
    <div className="token-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="token-item token-item--skeleton">
          <div className="token-info">
            <Skeleton width={36} height={36} borderRadius="50%" />
            <div className="token-details">
              <Skeleton width={56} height={14} style={{ marginBottom: 6 }} />
              <Skeleton width={96} height={12} />
            </div>
          </div>
          <div className="token-balance token-balance--skeleton">
            <Skeleton width={72} height={15} style={{ marginBottom: 6 }} />
            <Skeleton width={48} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default TokenRowSkeleton;
