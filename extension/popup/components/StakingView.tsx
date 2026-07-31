/**
 * @fileoverview Staking overview for the extension popup/sidepanel.
 *
 * Lists the wallet's staking positions on the active network (validator,
 * amount, lifecycle state, USD value, APY) and dispatches unstake / withdraw
 * actions. Opens StakeFlowView for new stakes. Consumes only the
 * chain-neutral staking message protocol — no Solana-specific concepts.
 *
 * @responsibilities
 * - Fetch and render staking positions via GET_STAKE_POSITIONS
 * - Gate Unstake (active/activating) and Withdraw (withdrawable) per state
 * - Dispatch UNSTAKE / WITHDRAW_STAKE and surface results
 *
 * @security
 * - No secrets handled in UI; signing happens in the service worker via the
 *   session password
 */

import React, { useState, useEffect, useCallback } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import { EmptyState, ScreenHeader } from './ui';
import StakeFlowView from './StakeFlowView';

/** Mirror of src/types/staking.ts StakePositionView (structural). */
export interface StakePositionViewData {
  networkKey: string;
  chain: string;
  positionId: string;
  validator: {
    id: string;
    name: string | null;
    commissionPercent: number | null;
    apyPercent: number | null;
    activatedStakeFormatted: string | null;
    delinquent: boolean;
  };
  amountFormatted: string;
  amountBaseUnits: string;
  reserveFormatted?: string;
  totalFormatted: string;
  state: 'pending' | 'activating' | 'active' | 'deactivating' | 'withdrawable' | 'inactive';
  usdValue?: number;
  lastRewardFormatted?: string;
}

export interface StakingCapabilitiesData {
  canStake: boolean;
  canUnstake: boolean;
  canWithdraw: boolean;
  minStakeFormatted?: string;
  activationNote: string;
  deactivationNote: string;
}

interface Props {
  network: string;
  networks: Record<string, any>;
  onBack: () => void;
}

const STATE_COLORS: Record<string, string> = {
  active: '#22c55e',
  activating: '#eab308',
  deactivating: '#eab308',
  withdrawable: '#38bdf8',
  pending: '#eab308',
  inactive: '#9ca3af',
};

/** Compact validator label: name when known, else truncated id. */
export function validatorLabel(v: { name: string | null; id: string }): string {
  if (v.name) return v.name;
  if (!v.id) return 'Undelegated';
  return `${v.id.slice(0, 4)}…${v.id.slice(-4)}`;
}

function formatUsd(value?: number): string | null {
  if (typeof value !== 'number') return null;
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Trim trailing zeros from a fixed-decimal amount for display. */
function trimAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Round a native-unit amount for display. Core amounts arrive as 9-decimal
 * fixed strings; showing them raw is what made the cards feel cramped.
 * Values smaller than the cutoff render as "<0.0001"-style so dust never
 * shows as a bare 0.
 */
function formatAmountDisplay(amount: string, maxDecimals: number = 4): string {
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return trimAmount(amount);
  if (n === 0) return '0';
  const cutoff = 1 / 10 ** maxDecimals;
  if (Math.abs(n) < cutoff) return `<${cutoff.toFixed(maxDecimals)}`;
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

/** One label/value line inside a position card. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ opacity: 0.6, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12, textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

/** Rounded state badge (colored dot + label). */
function StatePill({ state }: { state: string }) {
  const color = STATE_COLORS[state] || '#9ca3af';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {state}
    </span>
  );
}

/**
 * A single staking position card: validator + state up top, the staked
 * amount as the hero line, then labeled detail rows (epochs, reserve, APY,
 * reward, account) and state-gated actions.
 */
function PositionCard({
  position: p,
  nativeSymbol,
  busy,
  onUnstake,
  onWithdraw,
}: {
  position: StakePositionViewData;
  nativeSymbol: string;
  busy: boolean;
  onUnstake: () => void;
  onWithdraw: () => void;
}) {
  const usd = formatUsd(p.usdValue);
  const canUnstake = p.state === 'active' || p.state === 'activating';
  const canWithdraw = p.state === 'withdrawable';
  const hasEpochs = typeof p.activationEpoch === 'number';
  const epochsAgo =
    hasEpochs && typeof p.currentEpoch === 'number'
      ? p.currentEpoch - (p.activationEpoch as number)
      : null;

  return (
    <div
      style={{
        border: '1px solid rgba(128,128,128,0.25)',
        borderRadius: 12,
        padding: 14,
      }}
    >
      {/* Header: validator identity + lifecycle state */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {validatorLabel(p.validator)}
        </span>
        <StatePill state={p.state} />
      </div>

      {/* Hero amount */}
      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>
          {formatAmountDisplay(p.totalFormatted)} {nativeSymbol}
        </div>
        {usd && <div style={{ opacity: 0.6, fontSize: 12, marginTop: 2 }}>{usd}</div>}
      </div>

      {/* Details */}
      <div style={{ borderTop: '1px solid rgba(128,128,128,0.18)', paddingTop: 8 }}>
        {hasEpochs && (
          <DetailRow
            label="Staked at epoch"
            value={
              <>
                {p.activationEpoch}
                {epochsAgo !== null && epochsAgo >= 0 && (
                  <span style={{ opacity: 0.6 }}>
                    {' '}({epochsAgo === 0 ? 'this epoch' : `${epochsAgo} epoch${epochsAgo === 1 ? '' : 's'} ago`})
                  </span>
                )}
              </>
            }
          />
        )}
        {typeof p.deactivationEpoch === 'number' && (
          <DetailRow label="Unstaked at epoch" value={p.deactivationEpoch} />
        )}
        {typeof p.currentEpoch === 'number' && (
          <DetailRow label="Current epoch" value={p.currentEpoch} />
        )}
        {p.reserveFormatted && (
          <DetailRow label="Rent reserve" value={`${formatAmountDisplay(p.reserveFormatted, 6)} ${nativeSymbol}`} />
        )}
        {p.validator.apyPercent !== null && (
          <DetailRow label="APY" value={`${p.validator.apyPercent.toFixed(1)}%`} />
        )}
        {p.validator.commissionPercent !== null && (
          <DetailRow label="Commission" value={`${p.validator.commissionPercent}%`} />
        )}
        {p.lastRewardFormatted && (
          <DetailRow label="Last reward" value={`+${formatAmountDisplay(p.lastRewardFormatted, 6)} ${nativeSymbol}`} />
        )}
        <DetailRow label="Stake account" value={`${p.positionId.slice(0, 6)}…${p.positionId.slice(-6)}`} />
      </div>

      {/* State-gated actions / hints */}
      {(canUnstake || canWithdraw) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {canUnstake && (
            <button className="btn btn-secondary" style={{ flex: 1 }} disabled={busy} onClick={onUnstake}>
              {busy ? 'Unstaking…' : 'Unstake'}
            </button>
          )}
          {canWithdraw && (
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={onWithdraw}>
              {busy ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      )}
      {p.state === 'activating' && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
          Activates at the next epoch boundary
        </div>
      )}
      {p.state === 'deactivating' && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
          Withdraw unlocks after the next epoch boundary
        </div>
      )}
    </div>
  );
}

/**
 * Staking overview screen.
 *
 * @param props - Component props
 * @returns Staking view component
 */
function StakingView({ network, networks, onBack }: Props) {
  const [positions, setPositions] = useState<StakePositionViewData[]>([]);
  const [capabilities, setCapabilities] = useState<StakingCapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStakeFlow, setShowStakeFlow] = useState(false);
  /** positionId of an action in flight; disables that row's button. */
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nativeSymbol = networks[network]?.nativeSymbol || 'SOL';

  const loadPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positionsResp, capsResp] = await Promise.all([
        sendMessageWithRetry<{ positions?: StakePositionViewData[]; error?: string }>({
          type: 'GET_STAKE_POSITIONS',
          payload: { networkKey: network },
        }),
        sendMessageWithRetry<{ capabilities?: StakingCapabilitiesData; error?: string }>({
          type: 'GET_STAKING_CAPABILITIES',
          payload: { networkKey: network },
        }),
      ]);
      if (positionsResp?.error) throw new Error(positionsResp.error);
      setPositions(positionsResp?.positions || []);
      if (capsResp?.capabilities) setCapabilities(capsResp.capabilities);
    } catch (err: any) {
      setError(err?.message || 'Failed to load staking positions');
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const runAction = async (type: 'UNSTAKE' | 'WITHDRAW_STAKE', position: StakePositionViewData) => {
    const confirmText = type === 'UNSTAKE'
      ? `Unstake ${formatAmountDisplay(position.totalFormatted)} ${nativeSymbol} from ${validatorLabel(position.validator)}?` +
        (capabilities ? `\n\n${capabilities.deactivationNote}` : '')
      : `Withdraw ${formatAmountDisplay(position.totalFormatted)} ${nativeSymbol} back to your wallet?`;
    if (!window.confirm(confirmText)) return;

    setActingOn(position.positionId);
    setNotice(null);
    try {
      const resp = await sendMessageWithRetry<{ result?: { txId: string }; error?: string }>({
        type,
        payload: { positionId: position.positionId, networkKey: network },
      });
      if (resp?.error) throw new Error(resp.error);
      setNotice(
        type === 'UNSTAKE'
          ? 'Unstake submitted. The position deactivates at the next epoch boundary.'
          : 'Withdraw submitted. Funds return to your balance once confirmed.'
      );
      await loadPositions();
    } catch (err: any) {
      setNotice(`${type === 'UNSTAKE' ? 'Unstake' : 'Withdraw'} failed: ${err?.message || 'unknown error'}`);
    } finally {
      setActingOn(null);
    }
  };

  if (showStakeFlow) {
    return (
      <StakeFlowView
        network={network}
        networks={networks}
        capabilities={capabilities}
        onClose={(didStake) => {
          setShowStakeFlow(false);
          if (didStake) loadPositions();
        }}
      />
    );
  }

  return (
    <div className="takeover">
      <ScreenHeader title="Staking" onBack={onBack} />

      <div style={{ padding: '0 16px 16px' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => setShowStakeFlow(true)}
        >
          Stake {nativeSymbol}
        </button>

        {notice && (
          <div className="activity-fallback-chip" style={{ marginBottom: 8 }}>
            <span>{notice}</span>
          </div>
        )}

        {loading ? (
          <div className="loading">Loading staking positions...</div>
        ) : error ? (
          <EmptyState
            icon="warning"
            title="Couldn't load positions"
            subtitle={error}
          />
        ) : positions.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No staking positions yet"
            subtitle={`Stake ${nativeSymbol} with a validator to start earning rewards.`}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {positions.map((p) => (
              <PositionCard
                key={p.positionId}
                position={p}
                nativeSymbol={nativeSymbol}
                busy={actingOn === p.positionId}
                onUnstake={() => runAction('UNSTAKE', p)}
                onWithdraw={() => runAction('WITHDRAW_STAKE', p)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default StakingView;
