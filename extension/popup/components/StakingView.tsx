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
      ? `Unstake ${trimAmount(position.totalFormatted)} ${nativeSymbol} from ${validatorLabel(position.validator)}?` +
        (capabilities ? `\n\n${capabilities.deactivationNote}` : '')
      : `Withdraw ${trimAmount(position.totalFormatted)} ${nativeSymbol} back to your wallet?`;
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
          <div className="transaction-list">
            {positions.map((p) => {
              const usd = formatUsd(p.usdValue);
              const canUnstake = p.state === 'active' || p.state === 'activating';
              const canWithdraw = p.state === 'withdrawable';
              return (
                <div key={p.positionId} className="transaction-item" style={{ cursor: 'default' }}>
                  <div
                    className="tx-status-bar"
                    style={{ background: STATE_COLORS[p.state] || '#9ca3af' }}
                    title={p.state}
                  />
                  <div className="tx-content">
                    <div className="tx-row-primary">
                      <span className="tx-type">{validatorLabel(p.validator)}</span>
                      <span className="tx-amount-value">
                        {trimAmount(p.totalFormatted)} {nativeSymbol}
                      </span>
                    </div>
                    <div className="tx-row-secondary">
                      <span className="tx-address">
                        <span style={{ color: STATE_COLORS[p.state] || '#9ca3af' }}>{p.state}</span>
                        {p.validator.apyPercent !== null && ` · ${p.validator.apyPercent.toFixed(1)}% APY`}
                        {p.lastRewardFormatted && ` · +${trimAmount(p.lastRewardFormatted)} last epoch`}
                      </span>
                      <span className="tx-time">{usd ?? ''}</span>
                    </div>
                    {(canUnstake || canWithdraw) && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        {canUnstake && (
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1 }}
                            disabled={actingOn === p.positionId}
                            onClick={() => runAction('UNSTAKE', p)}
                          >
                            {actingOn === p.positionId ? 'Unstaking…' : 'Unstake'}
                          </button>
                        )}
                        {canWithdraw && (
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1 }}
                            disabled={actingOn === p.positionId}
                            onClick={() => runAction('WITHDRAW_STAKE', p)}
                          >
                            {actingOn === p.positionId ? 'Withdrawing…' : 'Withdraw'}
                          </button>
                        )}
                      </div>
                    )}
                    {p.state === 'deactivating' && (
                      <div className="tx-row-secondary" style={{ marginTop: 4 }}>
                        <span className="tx-address">Withdraw unlocks after the next epoch boundary</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default StakingView;
