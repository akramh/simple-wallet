/**
 * @fileoverview Top-of-list banner for portfolio errors + offline state.
 *
 * Renders one of:
 *   - offline notice (dismisses automatically when back online)
 *   - generic error with Retry affordance
 *
 * Non-blocking — cached rows continue rendering below.
 */
import React from 'react';

interface Props {
  offline: boolean;
  error: string | null;
  onRetry: () => void;
}

export function PortfolioErrorBanner({ offline, error, onRetry }: Props) {
  if (!offline && !error) return null;
  const title = offline ? 'Offline' : 'Couldn’t refresh portfolio';
  const body = offline
    ? 'Showing cached values. Changes will sync when you’re back online.'
    : error ?? 'The service worker returned an unexpected response.';
  return (
    <div className="portfolio-banner" role="status" aria-live="polite">
      <div className="portfolio-banner__body">
        <div className="portfolio-banner__title">{title}</div>
        <div className="portfolio-banner__message">{body}</div>
      </div>
      {!offline && (
        <button type="button" className="portfolio-banner__action" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export default PortfolioErrorBanner;
