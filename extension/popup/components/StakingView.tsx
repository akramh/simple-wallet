/**
 * @fileoverview Staking portfolio and full position-detail experience for the
 * extension popup and sidepanel.
 *
 * The portfolio remains compact and scannable. Selecting a position opens an
 * on-demand detail takeover containing epoch timing, reward history, validator
 * metadata, account authorities, and best-effort historical pricing.
 *
 * @responsibilities
 * - Fetch staking positions, detail enrichments, and capability gates
 * - Summarize stake value and render lifecycle-aware position details
 * - Dispatch unstake and withdraw requests after an explicit in-app review
 *
 * @security
 * - No secrets or signing material are handled in UI state.
 * - Unstake and withdraw signing remains isolated in the service worker.
 * - Historical prices and epoch timing are labelled as estimates.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import {
  epochProgressPercent,
  estimateEpochBoundaryAt,
  stakingPositionAction,
  summarizeStakePositions,
} from '../utils/swapStake.js';
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

interface StakeRewardData {
  amountFormatted: string;
  epoch: number;
  effectiveSlot?: number;
  postBalanceFormatted?: string;
  commissionPercent?: number | null;
}

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
  currentEpochSlot?: number;
  slotsInEpoch?: number;
  usdValue?: number;
  lastRewardFormatted?: string;
  lastReward?: StakeRewardData;
  stakerAuthority?: string;
  withdrawerAuthority?: string;
}

interface StakePositionDetailsData extends StakePositionViewData {
  accountCreatedAt?: number;
  accountCreationSignature?: string;
  accountCreationSlot?: number;
  priceAtCreationUsd?: number;
  priceAtCreationSampledAt?: number;
  valueAtCreationUsd?: number;
  rewardHistory: StakeRewardData[];
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

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return 'Not indexed';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatTimeUntil(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return 'Timing unavailable';
  const remaining = Math.max(0, timestamp - now);
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours < 1) return '<1 hour';
  if (hours < 24) return `~${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  const extraHours = hours % 24;
  return `~${days}d${extraHours ? ` ${extraHours}h` : ''}`;
}

function compactAddress(value?: string): string {
  if (!value) return 'Unavailable';
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-7)}`;
}

function actionLabel(position: StakePositionViewData, capabilities: StakingCapabilitiesData | null): string {
  if (!capabilities) return 'Staking actions unavailable';
  const action = stakingPositionAction(position.state, capabilities);
  if (action === 'unstake') return 'Unstake position';
  if (action === 'withdraw') return 'Withdraw to wallet';
  if (position.state === 'deactivating') return 'Waiting for deactivation';
  if (position.state === 'activating' || position.state === 'active') return 'Unstaking unavailable';
  return 'No action available';
}

function DetailSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="stake-detail-section">
      <div className="stake-detail-section__heading">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function ActionReviewSheet({
  pendingAction,
  nativeSymbol,
  capabilities,
  acting,
  onClose,
  onConfirm,
}: {
  pendingAction: PendingAction | null;
  nativeSymbol: string;
  capabilities: StakingCapabilitiesData | null;
  acting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const position = pendingAction?.position;
  const isUnstake = pendingAction?.type === 'UNSTAKE';
  return (
    <FlowSheet
      open={!!pendingAction}
      onClose={() => { if (!acting) onClose(); }}
      title={isUnstake ? 'Review unstake' : 'Review withdrawal'}
      size="medium"
      footer={acting ? (
        <FlowButton loading>{isUnstake ? 'Unstaking…' : 'Withdrawing…'}</FlowButton>
      ) : (
        <div className="swap-stake-sheet-actions">
          <FlowButton variant="secondary" onClick={onClose}>Cancel</FlowButton>
          <FlowButton variant={isUnstake ? 'danger' : 'primary'} onClick={onConfirm}>
            {isUnstake ? 'Confirm unstake' : 'Confirm withdrawal'}
          </FlowButton>
        </div>
      )}
    >
      {position && (
        <div className="stake-review">
          <div className="stake-review__hero">
            <strong>{formatAmount(position.totalFormatted)} <span>{nativeSymbol}</span></strong>
            {position.usdValue !== undefined && <small>{formatUsd(position.usdValue)}</small>}
          </div>
          <FlowDetails>
            <FlowDetailRow label="Validator" value={validatorLabel(position.validator)} />
            <FlowDetailRow label="Stake account" value={compactAddress(position.positionId)} />
            <FlowDetailRow label="Current state" value={position.state} />
            {position.currentEpoch !== undefined && <FlowDetailRow label="Current epoch" value={position.currentEpoch} />}
          </FlowDetails>
          <FlowCallout tone={isUnstake ? 'warning' : 'info'}>
            {isUnstake
              ? capabilities?.deactivationNote || 'Unstaking begins deactivation. Funds are not immediately spendable.'
              : 'This returns the unlocked stake and rent reserve to your wallet.'}
          </FlowCallout>
        </div>
      )}
    </FlowSheet>
  );
}

function StakePositionDetail({
  position,
  details,
  loading,
  error,
  notice,
  capabilities,
  nativeSymbol,
  nativeIcon,
  explorerBase,
  pendingAction,
  acting,
  onBack,
  onRetry,
  onRequestAction,
  onCloseAction,
  onConfirmAction,
}: {
  position: StakePositionViewData;
  details: StakePositionDetailsData | null;
  loading: boolean;
  error: string | null;
  notice: { tone: 'success' | 'danger'; message: string } | null;
  capabilities: StakingCapabilitiesData | null;
  nativeSymbol: string;
  nativeIcon: string | null;
  explorerBase?: string;
  pendingAction: PendingAction | null;
  acting: boolean;
  onBack: () => void;
  onRetry: () => void;
  onRequestAction: (type: PendingAction['type']) => void;
  onCloseAction: () => void;
  onConfirmAction: () => void;
}) {
  const data: StakePositionDetailsData = details ?? { ...position, rewardHistory: [] };
  const progress = epochProgressPercent(data.currentEpochSlot, data.slotsInEpoch);
  const epochBoundary = estimateEpochBoundaryAt(data.currentEpochSlot, data.slotsInEpoch, Date.now());
  const action = capabilities ? stakingPositionAction(data.state, capabilities) : null;
  const currentPrice = data.usdValue === undefined || Number(data.totalFormatted) <= 0
    ? null
    : data.usdValue / Number(data.totalFormatted);
  const priceChange = currentPrice !== null && data.priceAtCreationUsd
    ? (currentPrice - data.priceAtCreationUsd) / data.priceAtCreationUsd * 100
    : null;
  const creationExplorer = explorerBase && data.accountCreationSignature
    ? `${explorerBase.replace(/\/$/, '')}/tx/${data.accountCreationSignature}`
    : null;

  return (
    <div className="swap-stake-screen">
      <FlowHeader title="Stake details" onBack={onBack} />
      <main className="swap-stake-scroll stake-detail">
        <section className="stake-detail-hero">
          <div className="stake-detail-hero__top">
            <AssetMark label={validatorLabel(data.validator)} src={nativeIcon} size="large" />
            <div><small>Delegated stake</small><strong>{formatAmount(data.amountFormatted)} <span>{nativeSymbol}</span></strong></div>
            <StatusPill state={data.state} />
          </div>
          <div className="stake-detail-hero__metrics">
            <div><small>Current value</small><strong>{data.usdValue === undefined ? 'Unavailable' : formatUsd(data.usdValue)}</strong></div>
            <div><small>Validator APY</small><strong className="is-success">{data.validator.apyPercent === null ? '—' : `${data.validator.apyPercent.toFixed(1)}%`}</strong></div>
            <div><small>Last reward</small><strong className="is-success">{data.lastRewardFormatted ? `+${formatAmount(data.lastRewardFormatted, 6)}` : '—'}</strong></div>
          </div>
        </section>

        {loading && <FlowCallout icon="loader" title="Loading position history">Fetching account activity, reward epochs, and historical pricing…</FlowCallout>}
        {error && (
          <div className="stake-detail-error">
            <FlowCallout tone="warning" title="Some details are unavailable">{error}</FlowCallout>
            <button className="stake-detail-inline-action" type="button" onClick={onRetry}>Retry details</button>
          </div>
        )}
        {notice && <FlowCallout tone={notice.tone}>{notice.message}</FlowCallout>}

        <DetailSection title="Timeline" subtitle={data.currentEpoch === undefined ? undefined : `Epoch ${data.currentEpoch}`}>
          <FlowDetails>
            <FlowDetailRow label="Activated" value={data.activationEpoch === null || data.activationEpoch === undefined ? 'Not delegated' : `Epoch ${data.activationEpoch}`} />
            <FlowDetailRow label="Stake account created" value={formatDateTime(data.accountCreatedAt)} />
            {data.accountCreationSlot !== undefined && <FlowDetailRow label="Creation slot" value={data.accountCreationSlot.toLocaleString()} />}
            {data.deactivationEpoch !== null && data.deactivationEpoch !== undefined && <FlowDetailRow label="Deactivation requested" value={`Epoch ${data.deactivationEpoch}`} />}
            <FlowDetailRow label="Next reward window" value={data.currentEpoch === undefined ? 'Unavailable' : `After epoch ${data.currentEpoch}`} hint="Rewards are normally applied after the epoch boundary; timing and amount are estimates." />
          </FlowDetails>
          {progress !== null && (
            <div className="stake-epoch-progress">
              <div><span>Current epoch progress</span><strong>{progress.toFixed(1)}%</strong></div>
              <div className="stake-epoch-progress__track"><span style={{ width: `${progress}%` }} /></div>
              <small>Estimated boundary in {formatTimeUntil(epochBoundary)}</small>
            </div>
          )}
        </DetailSection>

        <DetailSection title="Pricing" subtitle="Best-effort market data">
          <FlowDetails>
            <FlowDetailRow label="Current SOL price" value={currentPrice === null ? 'Unavailable' : `~${formatUsd(currentPrice)}`} />
            <FlowDetailRow label="SOL price at creation" value={data.priceAtCreationUsd === undefined ? 'Unavailable' : `~${formatUsd(data.priceAtCreationUsd)}`} hint="Nearest hourly Alchemy historical price sample; not the transaction execution price." />
            <FlowDetailRow label="Value when created" value={data.valueAtCreationUsd === undefined ? 'Unavailable' : `~${formatUsd(data.valueAtCreationUsd)}`} />
            {priceChange !== null && <FlowDetailRow label="SOL price change" value={`${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%`} accent={priceChange >= 0 ? 'success' : 'danger'} />}
            {data.priceAtCreationSampledAt !== undefined && <FlowDetailRow label="Historical sample" value={formatDateTime(data.priceAtCreationSampledAt)} />}
          </FlowDetails>
        </DetailSection>

        <DetailSection title="Rewards" subtitle={data.rewardHistory.length ? `${data.rewardHistory.length} recent payout${data.rewardHistory.length === 1 ? '' : 's'}` : undefined}>
          {data.rewardHistory.length ? (
            <div className="stake-reward-history">
              {data.rewardHistory.map((reward) => (
                <div className="stake-reward-row" key={`${reward.epoch}-${reward.effectiveSlot ?? 0}`}>
                  <div><strong>Epoch {reward.epoch}</strong><small>{reward.effectiveSlot === undefined ? 'Payout slot unavailable' : `Effective slot ${reward.effectiveSlot.toLocaleString()}`}</small></div>
                  <div><strong>+{formatAmount(reward.amountFormatted, 7)} {nativeSymbol}</strong><small>{reward.commissionPercent === null || reward.commissionPercent === undefined ? 'Commission unavailable' : `${reward.commissionPercent}% commission`}</small></div>
                </div>
              ))}
            </div>
          ) : (
            <FlowCallout title="No indexed reward history">Rewards may be unavailable while a stake is activating or when the RPC does not index older epochs.</FlowCallout>
          )}
        </DetailSection>

        <DetailSection title="Validator">
          <FlowDetails>
            <FlowDetailRow label="Name" value={validatorLabel(data.validator)} />
            <FlowDetailRow label="Vote address" value={<span className="stake-detail-mono" title={data.validator.id}>{compactAddress(data.validator.id)}</span>} />
            <FlowDetailRow label="APY estimate" value={data.validator.apyPercent === null ? 'Unavailable' : `${data.validator.apyPercent.toFixed(1)}%`} accent="success" />
            <FlowDetailRow label="Commission" value={data.validator.commissionPercent === null ? 'Unavailable' : `${data.validator.commissionPercent}%`} />
            <FlowDetailRow label="Voting status" value={data.validator.delinquent ? 'Delinquent' : 'Current'} accent={data.validator.delinquent ? 'danger' : 'success'} />
          </FlowDetails>
        </DetailSection>

        <DetailSection title="Position details" subtitle="On-chain account data">
          <FlowDetails>
            <FlowDetailRow label="Delegated" value={`${formatAmount(data.amountFormatted, 7)} ${nativeSymbol}`} />
            <FlowDetailRow label="Rent reserve" value={data.reserveFormatted ? `${formatAmount(data.reserveFormatted, 7)} ${nativeSymbol}` : 'Unavailable'} />
            <FlowDetailRow label="Account total" value={`${formatAmount(data.totalFormatted, 7)} ${nativeSymbol}`} />
            <FlowDetailRow label="Stake account" value={<span className="stake-detail-mono" title={data.positionId}>{compactAddress(data.positionId)}</span>} />
            <FlowDetailRow label="Staker authority" value={<span className="stake-detail-mono" title={data.stakerAuthority}>{compactAddress(data.stakerAuthority)}</span>} />
            <FlowDetailRow label="Withdraw authority" value={<span className="stake-detail-mono" title={data.withdrawerAuthority}>{compactAddress(data.withdrawerAuthority)}</span>} />
          </FlowDetails>
          {creationExplorer && <button className="stake-detail-explorer" type="button" onClick={() => window.open(creationExplorer, '_blank')}>View creation transaction <Icon name="arrow-up-right" size={13} decorative /></button>}
        </DetailSection>
      </main>

      <footer className="swap-stake-footer">
        <FlowButton
          variant={action === 'unstake' ? 'danger' : 'primary'}
          disabled={!action}
          onClick={() => action && onRequestAction(action === 'unstake' ? 'UNSTAKE' : 'WITHDRAW_STAKE')}
        >
          {actionLabel(data, capabilities)}
        </FlowButton>
      </footer>

      <ActionReviewSheet
        pendingAction={pendingAction}
        nativeSymbol={nativeSymbol}
        capabilities={capabilities}
        acting={acting}
        onClose={onCloseAction}
        onConfirm={onConfirmAction}
      />
    </div>
  );
}

/**
 * Render the staking portfolio, position detail takeover, and new-stake flow.
 *
 * @param props - Active network context, native balance/price, and back handler.
 * @returns Staking overview, position details, or the single-canvas stake flow.
 */
function StakingView({ network, networks, availableBalance, nativePriceUsd, onBack }: Props) {
  const [positions, setPositions] = useState<StakePositionViewData[]>([]);
  const [capabilities, setCapabilities] = useState<StakingCapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const [detailNotice, setDetailNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);
  const [showStakeFlow, setShowStakeFlow] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [positionDetails, setPositionDetails] = useState<StakePositionDetailsData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
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

  const loadPositionDetails = useCallback(async (positionId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setPositionDetails(null);
    try {
      const response = await sendMessageWithRetry<{ position?: StakePositionDetailsData; error?: string }>({
        type: 'GET_STAKE_POSITION_DETAILS',
        payload: { networkKey: network, positionId },
      });
      if (response?.error) throw new Error(response.error);
      if (!response?.position) throw new Error('Position details were not returned');
      setPositionDetails(response.position);
    } catch (loadError: any) {
      setDetailError(loadError?.message || 'Could not load full position history');
    } finally {
      setDetailLoading(false);
    }
  }, [network]);

  const openPosition = (positionId: string) => {
    setSelectedPositionId(positionId);
    setDetailNotice(null);
    loadPositionDetails(positionId);
  };

  const summary = useMemo(() => {
    return summarizeStakePositions(positions, nativePriceUsd);
  }, [nativePriceUsd, positions]);

  const confirmAction = async () => {
    if (!pendingAction) return;
    const { type, position } = pendingAction;
    setActingOn(position.positionId);
    setNotice(null);
    setDetailNotice(null);
    try {
      const response = await sendMessageWithRetry<{ result?: { txId: string }; error?: string }>({
        type,
        payload: { positionId: position.positionId, networkKey: network },
      });
      if (response?.error) throw new Error(response.error);
      setPendingAction(null);
      setSelectedPositionId(null);
      setPositionDetails(null);
      setNotice({
        tone: 'success',
        message: type === 'UNSTAKE'
          ? 'Unstake submitted. This position will unlock after deactivation.'
          : 'Withdrawal submitted. Funds will return after confirmation.',
      });
      await loadPositions();
    } catch (actionError: any) {
      setPendingAction(null);
      setDetailNotice({
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

  const selectedPosition = selectedPositionId
    ? positions.find((position) => position.positionId === selectedPositionId) ?? positionDetails
    : null;

  if (selectedPosition) {
    return (
      <StakePositionDetail
        position={selectedPosition}
        details={positionDetails}
        loading={detailLoading}
        error={detailError}
        notice={detailNotice}
        capabilities={capabilities}
        nativeSymbol={nativeSymbol}
        nativeIcon={nativeIcon}
        explorerBase={networks[network]?.blockExplorer}
        pendingAction={pendingAction}
        acting={actingOn === selectedPosition.positionId}
        onBack={() => {
          setSelectedPositionId(null);
          setPositionDetails(null);
          setDetailError(null);
          setDetailNotice(null);
          setPendingAction(null);
        }}
        onRetry={() => loadPositionDetails(selectedPosition.positionId)}
        onRequestAction={(type) => setPendingAction({ type, position: selectedPosition })}
        onCloseAction={() => setPendingAction(null)}
        onConfirmAction={confirmAction}
      />
    );
  }

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
          {summary.deactivatingTotal > 0 && (
            <div className="staking-redesign-summary__lifecycle is-deactivating">
              <span><i />Unstaking{summary.deactivatingCount > 1 ? ` (${summary.deactivatingCount})` : ''}</span>
              <strong>{formatAmount(String(summary.deactivatingTotal))} {nativeSymbol}</strong>
            </div>
          )}
          {summary.withdrawableTotal > 0 && (
            <div className="staking-redesign-summary__lifecycle is-withdrawable">
              <span><i />Ready to withdraw{summary.withdrawableCount > 1 ? ` (${summary.withdrawableCount})` : ''}</span>
              <strong>{formatAmount(String(summary.withdrawableTotal))} {nativeSymbol}</strong>
            </div>
          )}
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
              return (
                <button className="staking-redesign-position" type="button" key={position.positionId} onClick={() => openPosition(position.positionId)} aria-label={`View ${validatorLabel(position.validator)} stake details`}>
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
                      <strong>{formatAmount(position.amountFormatted)} {nativeSymbol}</strong>
                      <small>{position.usdValue === undefined ? 'Staked balance' : formatUsd(position.usdValue)}</small>
                    </div>
                    <div>
                      <strong className="is-success">{position.validator.apyPercent === null ? '—' : `${position.validator.apyPercent.toFixed(1)}%`}</strong>
                      <small>APY</small>
                    </div>
                  </div>
                  <div className="staking-redesign-position__footer">
                    <span>{position.positionId.slice(0, 6)}…{position.positionId.slice(-5)}</span>
                    <span className="staking-redesign-position__view">View details <Icon name="chevron-right" size={12} decorative /></span>
                  </div>
                </button>
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
    </div>
  );
}

export default StakingView;
