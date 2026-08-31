/**
 * @fileoverview Shared visual primitives for the extension swap and staking
 * canvases.
 *
 * @responsibilities
 * - Keep amount entry, asset pills, detail rows, callouts, CTAs, and sheets
 *   consistent across swap, stake, and staking-position screens
 * - Provide accessible keyboard and dialog semantics for every interaction
 *
 * @security
 * - Presentation only; no secrets, storage, signing, or RPC access.
 */

import React, { type ReactNode, useEffect, useState } from 'react';
import { Icon, type IconName } from './ui';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type CalloutTone = 'info' | 'warning' | 'danger' | 'success';

/**
 * Compact header shared by swap and staking takeovers.
 *
 * @param props - Header title, back handler, and optional trailing control.
 * @returns Accessible flow header.
 */
export function FlowHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <header className="swap-stake-header">
      <button className="swap-stake-icon-button" type="button" onClick={onBack} aria-label="Go back">
        <Icon name="arrow-left" size={19} decorative />
      </button>
      <h1>{title}</h1>
      <div className="swap-stake-header__right">{right}</div>
    </header>
  );
}

/**
 * Primary action button for swap and staking flows.
 *
 * @param props - Native button props plus visual variant and busy state.
 * @returns Styled button with a consistent loading treatment.
 */
export function FlowButton({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  ...buttonProps
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      className={`swap-stake-button swap-stake-button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
    >
      {loading && <Icon name="loader" size={15} className="swap-stake-spinner" decorative />}
      {children}
    </button>
  );
}

/**
 * Bottom sheet used for pickers, reviews, settings, and confirmations.
 *
 * @param props - Sheet visibility, title, body, footer, and close handler.
 * @returns Dialog and scrim anchored to the flow shell.
 */
export function FlowSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'large',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large';
}) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="swap-stake-sheet-scrim is-open"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <section
        className={`swap-stake-sheet swap-stake-sheet--${size} is-open`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="swap-stake-sheet__handle" />
        <div className="swap-stake-sheet__heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="swap-stake-icon-button" onClick={onClose} aria-label="Close dialog" autoFocus>
            <Icon name="x" size={17} decorative />
          </button>
        </div>
        <div className="swap-stake-sheet__body">{children}</div>
        {footer && <div className="swap-stake-sheet__footer">{footer}</div>}
      </section>
    </>
  );
}

/**
 * Semantic callout for capability, warning, error, and success messages.
 *
 * @param props - Tone, optional title, icon, and message body.
 * @returns Styled callout.
 */
export function FlowCallout({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
  icon?: IconName;
}) {
  const defaultIcon: IconName = tone === 'danger' || tone === 'warning'
    ? 'alert-triangle'
    : tone === 'success'
      ? 'check'
      : 'info';
  return (
    <div className={`swap-stake-callout swap-stake-callout--${tone}`}>
      <Icon name={icon ?? defaultIcon} size={15} decorative />
      <div>
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </div>
    </div>
  );
}

/**
 * Surface containing aligned label/value rows.
 *
 * @param props - Detail rows to display.
 * @returns Rounded details surface.
 */
export function FlowDetails({ children }: { children: ReactNode }) {
  return <div className="swap-stake-details">{children}</div>;
}

/**
 * One aligned label/value row inside a details surface.
 *
 * @param props - Row label, value, optional hint, and semantic accent.
 * @returns Detail row.
 */
export function FlowDetailRow({
  label,
  value,
  hint,
  accent,
  strike = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: 'success' | 'warning' | 'danger' | 'muted';
  strike?: boolean;
}) {
  return (
    <div className="swap-stake-detail-row">
      <span title={hint}>{label}{hint && <Icon name="info" size={12} decorative />}</span>
      <strong className={`${accent ? `is-${accent}` : ''} ${strike ? 'is-struck' : ''}`.trim()}>{value}</strong>
    </div>
  );
}

/**
 * Circular asset or validator mark with a deterministic text fallback.
 *
 * @param props - Display label and optional image URL.
 * @returns Asset mark.
 */
export function AssetMark({ label, src, size = 'medium' }: { label: string; src?: string | null; size?: 'small' | 'medium' | 'large' }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return src && !imageFailed ? (
    <img
      className={`swap-stake-asset-mark swap-stake-asset-mark--${size}`}
      src={src}
      alt=""
      onError={() => setImageFailed(true)}
    />
  ) : (
    <span className={`swap-stake-asset-mark swap-stake-asset-mark--${size}`} aria-hidden="true">
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * Token selector pill used inside amount cards.
 *
 * @param props - Token symbol, optional image, network badge, and click handler.
 * @returns Asset selection pill.
 */
export function AssetPill({
  symbol,
  src,
  networkLabel,
  onClick,
}: {
  symbol: string;
  src?: string | null;
  networkLabel?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="swap-stake-asset-pill" onClick={onClick} disabled={!onClick}>
      <span className="swap-stake-asset-pill__mark">
        <AssetMark label={symbol} src={src} size="small" />
        {networkLabel && <span className="swap-stake-asset-pill__network">{networkLabel.charAt(0)}</span>}
      </span>
      <strong>{symbol}</strong>
      {onClick && <Icon name="chevron-down" size={13} decorative />}
    </button>
  );
}

/**
 * Shared human-unit amount card used by both swap and stake.
 *
 * @param props - Label, asset pill, amount value, balance, shortcuts, and validation copy.
 * @returns Amount entry or read-only quote card.
 */
export function AmountCard({
  label,
  asset,
  value,
  onChange,
  readOnly = false,
  balance,
  balanceLabel = 'Balance',
  onMax,
  onPercent,
  secondary,
  error,
}: {
  label: string;
  asset: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  balance?: string;
  balanceLabel?: string;
  onMax?: () => void;
  onPercent?: (percent: number) => void;
  secondary?: string;
  error?: string | null;
}) {
  return (
    <section className={`swap-stake-amount-card ${error ? 'has-error' : ''}`}>
      <div className="swap-stake-amount-card__label">
        <span>{label}</span>
        {balance !== undefined && (
          onMax ? (
            <button type="button" onClick={onMax}>{balanceLabel} <strong>{balance}</strong></button>
          ) : <span>{balanceLabel} {balance}</span>
        )}
      </div>
      <div className="swap-stake-amount-card__main">
        {asset}
        {readOnly ? (
          <output>{value || '0'}</output>
        ) : (
          <input
            value={value}
            onChange={(event) => {
              if (/^\d*\.?\d*$/.test(event.target.value)) onChange?.(event.target.value);
            }}
            inputMode="decimal"
            placeholder="0"
            aria-label={label}
          />
        )}
      </div>
      <div className="swap-stake-amount-card__meta">
        <div className="swap-stake-quick-amounts">
          {onPercent && [25, 50, 100].map((percent) => (
            <button type="button" key={percent} onClick={() => onPercent(percent)}>
              {percent === 100 ? 'MAX' : `${percent}%`}
            </button>
          ))}
        </div>
        <span className={error ? 'is-error' : ''}>{error || secondary}</span>
      </div>
    </section>
  );
}

/**
 * Compact lifecycle badge for a staking position.
 *
 * @param props - Position state and user-facing label.
 * @returns State badge.
 */
export function StatusPill({ state, label }: { state: string; label?: string }) {
  return <span className={`swap-stake-status swap-stake-status--${state}`}>{label ?? state}</span>;
}
