/**
 * @fileoverview Approval modal for dApp requests (connect, transaction, signature).
 *
 * This is the single surface where the user grants a website access to their
 * wallet, authorizes a transaction, or signs a message. Every detail shown
 * here informs a trust decision — we prioritize clarity over density:
 *
 *   - Origin block with favicon, hostname, and "connection" context
 *   - Warning callouts sized by request severity (connect < sig < tx)
 *   - Structured rows for transaction details (To / Value / Gas / Network)
 *     instead of raw fields
 *   - Signature raw-data is hidden behind a disclosure, with a clear note
 *     that decoded typed-data rendering is not yet available
 *
 * @security The modal never displays the user's private keys or seed. Addresses,
 *   amounts, and gas estimates are read-only echoes of the request payload.
 */
import React, { useMemo, useState } from 'react';
import { Icon } from './ui';
import {
  chainAccentVar,
  chainFromNetworkKey,
  formatAddress,
  type ChainKind,
} from '../utils/address';

export type ApprovalRequest =
  | { id: string; type: 'connect'; origin: string; createdAt: number }
  | {
      id: string;
      type: 'transaction';
      origin: string;
      createdAt: number;
      tx: {
        to?: string;
        from?: string;
        value?: string;
        data?: string;
        gas?: string;
        gasPrice?: string;
        maxFeePerGas?: string;
      };
    }
  | {
      id: string;
      type: 'signature';
      origin: string;
      createdAt: number;
      method: string;
      params: unknown[];
    };

interface Props {
  request: ApprovalRequest;
  /** Current wallet info for context (name + address). */
  wallet?: { name?: string | null; address?: string | null; network?: string | null };
  /** Networks dictionary (from getState) used to resolve the human network label. */
  networks?: Record<string, { name?: string; nativeSymbol?: string }>;
  onResolve: (id: string, approved: boolean) => void;
}

/**
 * Best-effort hostname extraction from an origin string.
 * Falls back to the raw string when the origin doesn't parse as a URL.
 */
function hostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/**
 * First-letter avatar for the dApp origin. We deliberately don't fetch a
 * favicon — doing so would either require loosening the extension CSP or
 * leaking the dApp domain to a third-party favicon service every time a
 * user is prompted, which is a privacy regression.
 */
function originInitial(host: string): string {
  const cleaned = host.replace(/^www\./, '');
  return (cleaned[0] ?? '?').toUpperCase();
}

/** Convert a hex wei value (possibly "0x..") to an ETH string. */
function weiHexToEthString(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const n = typeof value === 'string' && value.startsWith('0x') ? BigInt(value) : BigInt(value);
    const str = n.toString();
    // 18 decimals
    const pad = str.padStart(19, '0');
    const whole = pad.slice(0, -18).replace(/^0+/, '') || '0';
    const frac = pad.slice(-18).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
  } catch {
    return null;
  }
}

/** Shorten a long number to 6 significant fractional digits at most. */
function prettyAmount(amountStr: string | null): string {
  if (!amountStr) return '0';
  const n = Number(amountStr);
  if (!Number.isFinite(n)) return amountStr;
  if (n === 0) return '0';
  if (n < 0.000001) return '<0.000001';
  if (n < 1) return n.toPrecision(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function gasFeeEstimate(tx: {
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
}): string | null {
  const gas = tx.gas ? BigInt(tx.gas) : null;
  const price = tx.maxFeePerGas
    ? BigInt(tx.maxFeePerGas)
    : tx.gasPrice
    ? BigInt(tx.gasPrice)
    : null;
  if (!gas || !price) return null;
  try {
    const wei = gas * price;
    return weiHexToEthString(`0x${wei.toString(16)}`);
  } catch {
    return null;
  }
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="approval-row">
      <div className="approval-row__label">{label}</div>
      <div className={`approval-row__value${mono ? ' is-mono' : ''}`}>{value}</div>
    </div>
  );
}

export function ApprovalModal({ request, wallet, networks, onResolve }: Props) {
  const [rawOpen, setRawOpen] = useState(false);

  const host = hostname(request.origin);
  const walletChain: ChainKind = useMemo(
    () => chainFromNetworkKey(wallet?.network ?? null),
    [wallet?.network],
  );
  const chainAccent = chainAccentVar(walletChain);
  const networkMeta = wallet?.network ? networks?.[wallet.network] : undefined;
  const networkLabel = networkMeta?.name ?? wallet?.network ?? 'Unknown network';
  const nativeSymbol = networkMeta?.nativeSymbol ?? 'ETH';

  const title =
    request.type === 'connect'
      ? 'Connect wallet'
      : request.type === 'transaction'
      ? 'Confirm transaction'
      : 'Signature request';

  const approveLabel =
    request.type === 'connect'
      ? 'Connect'
      : request.type === 'transaction'
      ? 'Confirm'
      : 'Sign';

  const renderBody = () => {
    switch (request.type) {
      case 'connect':
        return (
          <>
            <div className="approval-callout approval-callout--info">
              <Icon name="info" size={16} decorative />
              <div>
                Connecting allows <strong>{host}</strong> to see your wallet
                address and suggest transactions. It cannot move funds without
                your approval.
              </div>
            </div>

            <div className="approval-details">
              {wallet?.name && <DetailRow label="Wallet" value={wallet.name} />}
              {wallet?.address && (
                <DetailRow
                  label="Account"
                  value={formatAddress(wallet.address, { chain: walletChain })}
                  mono
                />
              )}
              <DetailRow
                label="Network"
                value={
                  <span className="chain-chip" style={{ ['--chip-accent' as any]: chainAccent }}>
                    <span className="chain-chip__dot" />
                    {networkLabel}
                  </span>
                }
              />
            </div>
          </>
        );

      case 'transaction': {
        const valueEth = weiHexToEthString(request.tx?.value);
        const fee = gasFeeEstimate(request.tx ?? {});

        return (
          <>
            <div className="approval-callout approval-callout--warning">
              <Icon name="alert-triangle" size={16} decorative />
              <div>
                Review carefully. This transaction will spend funds from your
                wallet and cannot be reversed.
              </div>
            </div>

            <div className="approval-details">
              {request.tx?.to && (
                <DetailRow
                  label="To"
                  value={formatAddress(request.tx.to, { chain: walletChain })}
                  mono
                />
              )}
              <DetailRow
                label="Amount"
                value={
                  <span className="approval-amount">
                    {prettyAmount(valueEth)} {nativeSymbol}
                  </span>
                }
              />
              {fee && (
                <DetailRow
                  label="Estimated fee"
                  value={`${prettyAmount(fee)} ${nativeSymbol}`}
                />
              )}
              <DetailRow
                label="Network"
                value={
                  <span className="chain-chip" style={{ ['--chip-accent' as any]: chainAccent }}>
                    <span className="chain-chip__dot" />
                    {networkLabel}
                  </span>
                }
              />
            </div>

            {request.tx?.data && request.tx.data !== '0x' && (
              <details className="approval-raw">
                <summary>
                  <Icon name="chevron-right" size={12} decorative />
                  Contract data
                </summary>
                <div className="approval-raw__body">{request.tx.data}</div>
              </details>
            )}
          </>
        );
      }

      case 'signature': {
        const readable = (() => {
          if (request.params.length === 0) return null;
          // For personal_sign, params[0] is the message (hex), params[1] is address.
          // For eth_sign, params[0] is address, params[1] is message (hex).
          // We don't attempt full EIP-712 decoding here — that's its own feature.
          const likelyMessageHex = request.params.find(
            (p) => typeof p === 'string' && /^0x[0-9a-fA-F]+$/.test(p),
          );
          if (typeof likelyMessageHex === 'string') {
            try {
              const bytes = likelyMessageHex.slice(2).match(/.{1,2}/g) ?? [];
              const decoded = bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join('');
              // Ignore if it decodes to mostly non-printable bytes.
              if (/^[\x20-\x7E\n\r\t ]+$/.test(decoded)) return decoded;
            } catch {
              return null;
            }
          }
          return null;
        })();

        return (
          <>
            <div className="approval-callout approval-callout--warning">
              <Icon name="alert-triangle" size={16} decorative />
              <div>
                You're being asked to sign a message.{' '}
                <strong>Only sign messages from sites you trust.</strong>
              </div>
            </div>

            <div className="approval-details">
              <DetailRow label="Method" value={<code>{request.method}</code>} />
              {wallet?.name && <DetailRow label="Wallet" value={wallet.name} />}
            </div>

            {readable ? (
              <div className="approval-message">
                <div className="approval-message__label">Message</div>
                <pre className="approval-message__body">{readable}</pre>
              </div>
            ) : (
              <div className="approval-callout approval-callout--info" style={{ marginTop: 12 }}>
                <Icon name="info" size={16} decorative />
                <div>
                  This message isn't in a format we can decode. Review the raw
                  data below before signing.
                </div>
              </div>
            )}

            <details className="approval-raw" open={!readable}>
              <summary>
                <Icon name="chevron-right" size={12} decorative />
                Raw data
              </summary>
              <div className="approval-raw__body">
                {JSON.stringify(request.params, null, 2)}
              </div>
            </details>
          </>
        );
      }
    }
  };

  return (
    <div
      className="approval-backdrop animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="approval-modal animate-scale-in">
        <div className="approval-header">
          <div className="approval-origin">
            <div
              className="approval-origin__icon"
              style={{ ['--chip-accent' as any]: chainAccent }}
              aria-hidden
            >
              {originInitial(host)}
            </div>
            <div className="approval-origin__text">
              <div className="approval-origin__host">{host}</div>
              <div className="approval-origin__title">{title}</div>
            </div>
          </div>
        </div>

        <div className="approval-body">{renderBody()}</div>

        <div className="approval-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onResolve(request.id, false)}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onResolve(request.id, true)}
          >
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApprovalModal;
