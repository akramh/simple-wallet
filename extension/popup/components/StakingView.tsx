/**
 * @fileoverview Single-canvas staking portfolio for the extension popup and
 * sidepanel.
 *
 * Positions stay compact and scannable while lifecycle details and destructive
 * actions move into an in-app confirmation sheet shared with the stake flow.
 *
 * @responsibilities
 * - Fetch staking positions and capability gates for the active network
 * - Summarize staked value, rewards, and weighted validator yield
 * - Dispatch unstake and withdraw requests after an explicit in-app review
 *
 * @security
 * - No secrets or signing material are handled in UI state.
 * - Unstake and withdraw signing remains isolated in the service worker.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import { stakingPositionAction } from '../utils/swapStake.js';
import StakeFlowView from './StakeFlowView';
import {
  AssetMark,
  FlowButton,
  FlowCallout,
  FlowDetailRow,
  FlowDetails,
  FlowHeader,
  FlowSheet,
  StatusPill,
} from './SwapStakeUI';
import { Icon } from './ui';
import solIcon from '../../assets/img/solana-logo.svg';

/** Chain-neutral staking position shape returned by the service worker. */
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
  activationEpoch?: number | null;
  deactivationEpoch?: number | null;
  currentEpoch?: number;
  usdValue?: number;
  lastRewardFormatted?: string;
}

/** Staking operations exposed by the active network implementation. */
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
  availableBalance?: string;
  nativePriceUsd?: number | null;
  onBack: () => void;
}

type PendingAction = {
  type: 'UNSTAKE' | 'WITHDRAW_STAKE';
  position: StakePositionViewData;
};

/**
 * Return a compact validator label while preserving the original identifier.
 *
 * @param validator - Validator identity returned by the staking provider.
 * @returns Validator name, an undelegated label, or a truncated identifier.
 */
export function validatorLabel(validator: { name: string | null; id: string }): string {
  if (validator.name) return validator.name;
  if (!validator.id) return 'Undelegated';
  return `${validator.id.slice(0, 4)}…${validator.id.slice(-4)}`;
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAmount(amount: string, maxDecimals = 4): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return amount;
  if (numeric === 0) return '0';
  const cutoff = 1 / 10 ** maxDecimals;
  if (Math.abs(numeric) < cutoff) return `<${cutoff.toFixed(maxDecimals)}`;
  return numeric.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

function positionHint(position: StakePositionViewData): string | null {
  if (position.state === 'activating') return 'Activates at the next epoch boundary';
  if (position.state === 'deactivating') return 'Withdraw unlocks after deactivation';
  if (position.state === 'withdrawable') return 'Ready to return to your wallet';
  if (position.validator.delinquent) return 'Validator is currently delinquent';
  return null;
}

/**
 * Render the redesigned staking portfolio and action sheets.
 *
 * @param props - Active network context, native balance/price, and back handler.
 * @returns Staking overview or the single-canvas new-stake flow.
 */
function StakingView({ network, networks, availableBalance, nativePriceUsd, onBack }: Props) {
  const [positions, setPositions] = useState<StakePositionViewData[]>([]);
  const [capabilities, setCapabilities] = useState<StakingCapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const [showStakeFlow, setShowStakeFlow] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const nativeSymbol = networks[network]?.nativeSymbol || 'SOL';
  const nativeIcon = nativeSymbol === 'SOL' ? solIcon : null;

  const loadPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positionsResponse, capabilitiesResponse] = await Promise.all([
        sendMessageWithRetry<{ positions?: StakePositionViewData[]; error?: string }>({
          type: 'GET_STAKE_POSITIONS',
          payload: { networkKey: network },
        }),
        sendMessageWithRetry<{ capabilities?: StakingCapabilitiesData; error?: string }>({
          type: 'GET_STAKING_CAPABILITIES',
          payload: { networkKey: network },
        }),
      ]);
      if (positionsResponse?.error) throw new Error(positionsResponse.error);
      setPositions(positionsResponse?.positions ?? []);
      setCapabilities(capabilitiesResponse?.capabilities ?? null);
    } catch (loadError: any) {
      setPositions([]);
      setError(loadError?.message || 'Failed to load staking positions');
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const summary = useMemo(() => {
    const total = positions.reduce((sum, position) => sum + (Number(position.totalFormatted) || 0), 0);
    const rewards = positions.reduce((sum, position) => sum + (Number(position.lastRewardFormatted) || 0), 0);
    const weightedYield = positions.reduce((sum, position) => {
      const amount = Number(position.totalFormatted) || 0;
      return sum + amount * (position.validator.apyPercent ?? 0);
    }, 0);
    const fallbackUsd = nativePriceUsd === null || nativePriceUsd === undefined ? null : total * nativePriceUsd;
    const reportedUsd = positions.reduce((sum, position) => sum + (position.usdValue ?? 0), 0);
    const hasReportedUsd = positions.some((position) => position.usdValue !== undefined);
    return {
      total,
      rewards,
      apy: total > 0 ? weightedYield / total : 0,
      usd: hasReportedUsd ? reportedUsd : fallbackUsd,
    };
  }, [nativePriceUsd, positions]);

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { type, position } = pendingAction;
    setActingOn(position.positionId);
    setNotice(null);
    try {
      const response = await sendMessageWithRetry<{ result?: { txId: string }; error?: string }>({
        type,
        payload: { positionId: position.positionId, networkKey: network },
      });
      if (response?.error) throw new Error(response.error);
      setPendingAction(null);
      setNotice({
        tone: 'success',
        message: type === 'UNSTAKE'
          ? 'Unstake submitted. This position will unlock after deactivation.'
          : 'Withdrawal submitted. Funds will return after confirmation.',
      });
      await loadPositions();
    } catch (actionError: any) {
      setPendingAction(null);
      setNotice({
        tone: 'danger',
        message: `${type === 'UNSTAKE' ? 'Unstake' : 'Withdrawal'} failed: ${actionError?.message || 'unknown error'}`,
      });
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
        availableBalance={availableBalance}
        nativePriceUsd={nativePriceUsd}
        onClose={(didStake) => {
          setShowStakeFlow(false);
          if (didStake) loadPositions();
        }}
      />
    );
  }

  const actionPosition = pendingAction?.position;
  const isUnstake = pendingAction?.type === 'UNSTAKE';

  return (
    <div className="swap-stake-screen">
      <FlowHeader title="Staking" onBack={onBack} />
      <main className="swap-stake-scroll staking-redesign">
        <section className="staking-redesign-summary">
          <div className="staking-redesign-summary__label">
            <span>Total staked</span>
            <StatusPill state="active" label={`${positions.length} position${positions.length === 1 ? '' : 's'}`} />
          </div>
          <div className="staking-redesign-summary__amount">
            <AssetMark label={nativeSymbol} src={nativeIcon} size="large" />
            <div>
              <strong>{formatAmount(String(summary.total))} <span>{nativeSymbol}</span></strong>
              <small>{summary.usd === null ? 'USD value unavailable' : formatUsd(summary.usd)}</small>
            </div>
          </div>
          <div className="staking-redesign-summary__stats">
            <div><small>Avg. APY</small><strong>{summary.apy ? `${summary.apy.toFixed(1)}%` : '—'}</strong></div>
            <div><small>Latest rewards</small><strong>{summary.rewards ? `+${formatAmount(String(summary.rewards), 6)} ${nativeSymbol}` : '—'}</strong></div>
          </div>
        </section>

        {capabilities && (!capabilities.canUnstake || !capabilities.canWithdraw) && (
          <FlowCallout tone="warning" title="Network lifecycle limits">
            {!capabilities.canUnstake
              ? 'Unstaking is currently unavailable. Existing positions remain visible.'
              : 'Withdrawal is currently unavailable until the network enables it.'}
          </FlowCallout>
        )}

        {!loading && !capabilities && (
          <FlowCallout tone="warning" title="Staking actions unavailable">
            Couldn’t verify this network’s staking capabilities. Your existing positions remain visible.
          </FlowCallout>
        )}

        {notice && <FlowCallout tone={notice.tone}>{notice.message}</FlowCallout>}

        <div className="staking-redesign-section-heading">
          <span>Your positions</span>
          <button type="button" onClick={loadPositions} disabled={loading} aria-label="Refresh staking positions">
            <Icon name="refresh" size={14} className={loading ? 'swap-stake-spinner' : ''} decorative />
          </button>
        </div>

        {loading ? (
          <div className="staking-redesign-state"><Icon name="loader" size={20} className="swap-stake-spinner" decorative />Loading positions…</div>
        ) : error ? (
          <div className="staking-redesign-state is-error">
            <Icon name="alert-triangle" size={20} decorative />
            <strong>Couldn’t load positions</strong>
            <span>{error}</span>
            <FlowButton variant="secondary" onClick={loadPositions}>Try again</FlowButton>
          </div>
        ) : positions.length === 0 ? (
          <div className="staking-redesign-state">
            <span className="staking-redesign-state__mark"><Icon name="wallet" size={23} decorative /></span>
            <strong>No staking positions yet</strong>
            <span>Stake {nativeSymbol} with a validator to start earning rewards.</span>
          </div>
        ) : (
          <div className="staking-redesign-list">
            {positions.map((position) => {
              const action = capabilities ? stakingPositionAction(position.state, capabilities) : null;
              const hint = positionHint(position);
              return (
                <article className="staking-redesign-position" key={position.positionId}>
                  <div className="staking-redesign-position__top">
                    <AssetMark label={validatorLabel(position.validator)} />
                    <div className="staking-redesign-position__identity">
                      <strong>{validatorLabel(position.validator)}</strong>
                      <small>{position.validator.commissionPercent === null ? 'Validator' : `${position.validator.commissionPercent}% commission`}</small>
                    </div>
                    <StatusPill state={position.state} />
                  </div>
                  <div className="staking-redesign-position__value">
                    <div>
                      <strong>{formatAmount(position.totalFormatted)} {nativeSymbol}</strong>
                      <small>{position.usdValue === undefined ? 'Staked balance' : formatUsd(position.usdValue)}</small>
                    </div>
                    <div>
                      <strong className="is-success">{position.validator.apyPercent === null ? '—' : `${position.validator.apyPercent.toFixed(1)}%`}</strong>
                      <small>APY</small>
                    </div>
                  </div>
                  {hint && <div className={`staking-redesign-position__hint ${position.validator.delinquent ? 'is-danger' : ''}`}>{hint}</div>}
                  <div className="staking-redesign-position__footer">
                    <span>{position.positionId.slice(0, 6)}…{position.positionId.slice(-5)}</span>
                    {action === 'unstake' && (
                      <button type="button" disabled={actingOn === position.positionId} onClick={() => setPendingAction({ type: 'UNSTAKE', position })}>Unstake</button>
                    )}
                    {action === 'withdraw' && (
                      <button type="button" disabled={actingOn === position.positionId} onClick={() => setPendingAction({ type: 'WITHDRAW_STAKE', position })}>Withdraw</button>
                    )}
                    {!action && (position.state === 'active' || position.state === 'activating') && capabilities?.canUnstake === false && (
                      <span className="is-disabled">Unstaking unavailable</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="swap-stake-footer">
        <FlowButton disabled={capabilities?.canStake !== true} onClick={() => setShowStakeFlow(true)}>
          <Icon name="plus" size={16} decorative /> {capabilities ? `Stake ${nativeSymbol}` : 'Staking unavailable'}
        </FlowButton>
      </footer>

      <FlowSheet
        open={!!pendingAction}
        onClose={() => { if (!actingOn) setPendingAction(null); }}
        title={isUnstake ? 'Review unstake' : 'Review withdrawal'}
        size="medium"
        footer={actingOn ? (
          <FlowButton loading>{isUnstake ? 'Unstaking…' : 'Withdrawing…'}</FlowButton>
        ) : (
          <div className="swap-stake-sheet-actions">
            <FlowButton variant="secondary" onClick={() => setPendingAction(null)}>Cancel</FlowButton>
            <FlowButton variant={isUnstake ? 'danger' : 'primary'} onClick={confirmAction}>
              {isUnstake ? 'Confirm unstake' : 'Confirm withdrawal'}
            </FlowButton>
          </div>
        )}
      >
        {actionPosition && (
          <div className="stake-review">
            <div className="stake-review__hero">
              <strong>{formatAmount(actionPosition.totalFormatted)} <span>{nativeSymbol}</span></strong>
              {actionPosition.usdValue !== undefined && <small>{formatUsd(actionPosition.usdValue)}</small>}
            </div>
            <FlowDetails>
              <FlowDetailRow label="Validator" value={validatorLabel(actionPosition.validator)} />
              <FlowDetailRow label="Stake account" value={`${actionPosition.positionId.slice(0, 7)}…${actionPosition.positionId.slice(-7)}`} />
              <FlowDetailRow label="Current state" value={actionPosition.state} />
              {actionPosition.currentEpoch !== undefined && <FlowDetailRow label="Current epoch" value={actionPosition.currentEpoch} />}
            </FlowDetails>
            <FlowCallout tone={isUnstake ? 'warning' : 'info'}>
              {isUnstake
                ? capabilities?.deactivationNote || 'Unstaking begins deactivation. Funds are not immediately spendable.'
                : 'This returns the unlocked stake and rent reserve to your wallet.'}
            </FlowCallout>
          </div>
        )}
      </FlowSheet>
    </div>
  );
}

export default StakingView;
