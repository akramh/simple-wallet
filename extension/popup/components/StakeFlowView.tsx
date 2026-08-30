/**
 * @fileoverview Single-canvas new-stake experience for the extension popup
 * and sidepanel.
 *
 * Amount and validator stay on one canvas. Validator discovery, manual vote
 * address entry, and transaction review use bottom sheets shared with swap.
 *
 * @responsibilities
 * - Fetch and filter validators without blocking manual address entry
 * - Validate the network minimum and optional available balance inline
 * - Estimate fees, review activation timing, and submit STAKE messages
 *
 * @security
 * - No signing material is handled here; the service worker signs with the
 *   in-memory session password.
 * - Solana vote addresses remain case-sensitive and are never normalized.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import {
  AmountCard,
  AssetMark,
  AssetPill,
  FlowButton,
  FlowCallout,
  FlowDetailRow,
  FlowDetails,
  FlowHeader,
  FlowSheet,
} from './SwapStakeUI';
import { Icon } from './ui';
import { isValidSolanaVoteAddress, validateStakeAmount } from '../utils/swapStake.js';
import { validatorLabel, type StakingCapabilitiesData } from './StakingView';
import solIcon from '../../assets/img/solana-logo.svg';

interface ValidatorData {
  id: string;
  name: string | null;
  commissionPercent: number | null;
  apyPercent: number | null;
  activatedStakeFormatted: string | null;
  delinquent: boolean;
}

interface Props {
  network: string;
  networks: Record<string, any>;
  capabilities: StakingCapabilitiesData | null;
  /** Available native balance in human units, when already loaded by the wallet view. */
  availableBalance?: string;
  /** Native asset price in USD, when already loaded by the wallet view. */
  nativePriceUsd?: number | null;
  /** Called on exit; didStake=true once a stake transaction was submitted. */
  onClose: (didStake: boolean) => void;
}

function formatAmount(value: number, maxDecimals = 4): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

function truncateId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 7)}…${value.slice(-7)}`;
}

/**
 * Render the single-canvas stake flow.
 *
 * @param props - Active network, capability data, optional balance/price, and exit callback.
 * @returns Stake canvas with validator and review sheets.
 */
function StakeFlowView({ network, networks, capabilities, availableBalance, nativePriceUsd, onClose }: Props) {
  const [validators, setValidators] = useState<ValidatorData[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [manualVote, setManualVote] = useState('');
  const [selected, setSelected] = useState<ValidatorData | null>(null);
  const [amount, setAmount] = useState('');
  const [sheet, setSheet] = useState<'validator' | 'review' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ txId: string; positionId?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);

  const nativeSymbol = networks[network]?.nativeSymbol || 'SOL';
  const minStake = capabilities?.minStakeFormatted ?? '0';
  const amountError = amount ? validateStakeAmount(amount, minStake, availableBalance, nativeSymbol) : null;
  const numericAmount = Number(amount) || 0;
  const yearlyReward = selected?.apyPercent === null || selected?.apyPercent === undefined
    ? null
    : numericAmount * selected.apyPercent / 100;
  const usdValue = nativePriceUsd === null || nativePriceUsd === undefined
    ? undefined
    : `$${(numericAmount * nativePriceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    let cancelled = false;
    sendMessageWithRetry<{ validators?: ValidatorData[] }>({
      type: 'GET_STAKE_VALIDATORS',
      payload: { networkKey: network },
    }).then((response) => {
      if (cancelled) return;
      const next = response?.validators ?? [];
      setValidators(next);
      setSelected((current) => current ?? next[0] ?? null);
    }).catch(() => {
      if (!cancelled) setValidators([]);
    }).finally(() => {
      if (!cancelled) setValidatorsLoading(false);
    });
    return () => { cancelled = true; };
  }, [network]);

  useEffect(() => {
    let cancelled = false;
    sendMessageWithRetry<{ fee?: string }>({
      type: 'ESTIMATE_STAKE_FEE',
      payload: { networkKey: network },
    }).then((response) => {
      if (!cancelled && response?.fee) setFeeEstimate(response.fee);
    }).catch(() => { /* Best effort: the review remains usable without an estimate. */ });
    return () => { cancelled = true; };
  }, [network]);

  const filteredValidators = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return validators;
    return validators.filter((validator) =>
      (validator.name || '').toLowerCase().includes(query) || validator.id.toLowerCase().includes(query)
    );
  }, [search, validators]);

  const chooseManualValidator = () => {
    const id = manualVote.trim();
    if (!isValidSolanaVoteAddress(id)) return;
    setSelected({
      id,
      name: null,
      commissionPercent: null,
      apyPercent: null,
      activatedStakeFormatted: null,
      delinquent: false,
    });
    setSheet(null);
  };

  const pickPercent = (percent: number) => {
    const balance = Number(availableBalance);
    if (!Number.isFinite(balance)) return;
    const spendable = Math.max(0, balance - 0.01);
    setAmount(String(+(spendable * percent / 100).toFixed(4)));
  };

  const submitStake = async () => {
    if (!selected || amountError || !amount) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await sendMessageWithRetry<{ result?: { txId: string; positionId?: string }; error?: string }>({
        type: 'STAKE',
        payload: { validatorId: selected.id, amount: amount.trim(), networkKey: network },
      });
      if (response?.error) throw new Error(response.error);
      if (!response?.result?.txId) throw new Error('No transaction id returned');
      setResult(response.result);
      setSheet(null);
    } catch (error: any) {
      setSubmitError(error?.message || 'Staking failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const explorerBase = networks[network]?.blockExplorer || 'https://solscan.io';
    const explorerUrl = `${explorerBase.replace(/\/$/, '')}/tx/${result.txId}${network === 'solana-devnet' ? '?cluster=devnet' : ''}`;
    return (
      <div className="swap-stake-screen">
        <FlowHeader title={`Stake ${nativeSymbol}`} onBack={() => onClose(true)} />
        <main className="swap-stake-result">
          <div className="swap-stake-result__icon is-success"><Icon name="check" size={27} decorative /></div>
          <h2>Stake submitted</h2>
          <p>{capabilities?.activationNote || 'Your stake activates after the network confirms the transaction.'}</p>
          <FlowDetails>
            <FlowDetailRow label="Amount" value={`${amount.trim()} ${nativeSymbol}`} />
            <FlowDetailRow label="Validator" value={selected ? validatorLabel(selected) : '—'} />
            <FlowDetailRow label="Transaction" value={truncateId(result.txId)} />
            {result.positionId && <FlowDetailRow label="Stake account" value={truncateId(result.positionId)} />}
          </FlowDetails>
        </main>
        <footer className="swap-stake-footer swap-stake-footer--split">
          <FlowButton variant="secondary" onClick={() => window.open(explorerUrl, '_blank')}>Explorer</FlowButton>
          <FlowButton onClick={() => onClose(true)}>Done</FlowButton>
        </footer>
      </div>
    );
  }

  const canReview = !!selected && !!amount && !amountError && capabilities?.canStake === true;

  return (
    <div className="swap-stake-screen">
      <FlowHeader title={`Stake ${nativeSymbol}`} onBack={() => onClose(false)} />
      <main className="swap-stake-scroll">
        {capabilities && !capabilities.canStake && (
          <FlowCallout title="Staking unavailable">Staking is not available on this network.</FlowCallout>
        )}

        <AmountCard
          label="Amount to stake"
          value={amount}
          onChange={setAmount}
          asset={<AssetPill symbol={nativeSymbol} src={nativeSymbol === 'SOL' ? solIcon : null} />}
          balance={availableBalance === undefined ? undefined : formatAmount(Number(availableBalance))}
          balanceLabel="Available"
          onMax={availableBalance === undefined ? undefined : () => pickPercent(100)}
          onPercent={availableBalance === undefined ? undefined : pickPercent}
          secondary={usdValue}
          error={amountError}
        />

        <button className="stake-validator-card" type="button" onClick={() => { setSearch(''); setManualVote(''); setSheet('validator'); }}>
          <AssetMark label={selected ? validatorLabel(selected) : 'V'} size="large" />
          <span>
            <small>Validator</small>
            <strong>{selected ? validatorLabel(selected) : validatorsLoading ? 'Loading validators…' : 'Choose a validator'}</strong>
          </span>
          <span className="stake-validator-card__apy">
            <strong>{selected?.apyPercent !== null && selected?.apyPercent !== undefined ? `${selected.apyPercent.toFixed(1)}%` : 'n/a'}</strong>
            <small>APY</small>
          </span>
          <Icon name="chevron-right" size={16} decorative />
        </button>

        {selected?.delinquent && (
          <FlowCallout tone="danger" title="Validator is delinquent">
            This validator is not currently voting and may earn no rewards until it recovers.
          </FlowCallout>
        )}

        {canReview && (
          <FlowDetails>
            <FlowDetailRow label="Est. rewards / year" value={yearlyReward === null ? '—' : `+${formatAmount(yearlyReward)} ${nativeSymbol}`} accent={yearlyReward === null ? 'muted' : 'success'} />
            <FlowDetailRow label="Validator fee" value={selected?.commissionPercent === null || selected?.commissionPercent === undefined ? '—' : `${selected.commissionPercent}%`} />
            <FlowDetailRow label="Network fee" value={feeEstimate ? `${feeEstimate} ${nativeSymbol}` : 'Estimating…'} />
            <FlowDetailRow label="Rewards begin" value="Next epoch" hint={capabilities?.activationNote} />
            <FlowDetailRow label="Unstaking period" value="~2–3 days" hint={capabilities?.deactivationNote} />
          </FlowDetails>
        )}
      </main>

      <footer className="swap-stake-footer">
        <FlowButton disabled={!canReview} onClick={() => setSheet('review')}>
          {amountError || (amount ? selected ? 'Review stake' : 'Choose a validator' : 'Enter an amount')}
        </FlowButton>
      </footer>

      <FlowSheet
        open={sheet === 'validator'}
        onClose={() => setSheet(null)}
        title="Choose a validator"
        subtitle="Sorted by activated stake"
        footer={(
          <div className="stake-manual-validator">
            <label>Or enter a vote address</label>
            <div>
              <input
                value={manualVote}
                onChange={(event) => setManualVote(event.target.value)}
                placeholder="Vote address (base58)"
                aria-invalid={!!manualVote && !isValidSolanaVoteAddress(manualVote)}
              />
              <FlowButton disabled={!isValidSolanaVoteAddress(manualVote)} onClick={chooseManualValidator}>Use</FlowButton>
            </div>
          </div>
        )}
      >
        <label className="swap-stake-search">
          <Icon name="search" size={16} decorative />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or vote address" />
        </label>
        <div className="swap-stake-picker-list">
          {validatorsLoading ? (
            <div className="swap-stake-picker-empty">Loading validators…</div>
          ) : filteredValidators.length ? filteredValidators.map((validator) => {
            const isSelected = selected?.id === validator.id;
            return (
              <button className={`swap-stake-picker-row validator-row ${isSelected ? 'is-selected' : ''}`} type="button" key={validator.id} onClick={() => { setSelected(validator); setSheet(null); }}>
                <AssetMark label={validatorLabel(validator)} />
                <span className="swap-stake-picker-row__main">
                  <strong className={!validator.name ? 'is-mono' : ''}>
                    {validatorLabel(validator)}
                    {validator.delinquent && <em className="is-danger">Delinquent</em>}
                  </strong>
                  <small>{validator.activatedStakeFormatted ? `${validator.activatedStakeFormatted} ${nativeSymbol}` : truncateId(validator.id)}{validator.commissionPercent !== null ? ` · ${validator.commissionPercent}% fee` : ''}</small>
                </span>
                <span className="swap-stake-picker-row__value is-apy">
                  <strong>{validator.apyPercent !== null ? `${validator.apyPercent.toFixed(1)}%` : 'n/a'}</strong>
                  <small>APY</small>
                </span>
                {isSelected && <Icon name="check" size={16} decorative />}
              </button>
            );
          }) : (
            <div className="swap-stake-picker-empty">No validators match “{search}”. Enter a vote address below instead.</div>
          )}
        </div>
      </FlowSheet>

      <FlowSheet
        open={sheet === 'review'}
        onClose={() => { if (!submitting) setSheet(null); }}
        title="Review stake"
        size="medium"
        footer={submitting ? <FlowButton loading>Staking…</FlowButton> : (
          <div className="swap-stake-sheet-actions">
            <FlowButton variant="secondary" onClick={() => setSheet(null)}>Cancel</FlowButton>
            <FlowButton onClick={submitStake}>Confirm stake</FlowButton>
          </div>
        )}
      >
        {selected && (
          <div className="stake-review">
            <div className="stake-review__hero">
              <strong>{formatAmount(numericAmount)} <span>{nativeSymbol}</span></strong>
              {usdValue && <small>{usdValue}</small>}
            </div>
            <FlowDetails>
              <FlowDetailRow label="Validator" value={validatorLabel(selected)} />
              <FlowDetailRow label="Vote address" value={truncateId(selected.id)} />
              <FlowDetailRow label="APY" value={selected.apyPercent === null ? '—' : `${selected.apyPercent.toFixed(1)}%`} accent={selected.apyPercent === null ? 'muted' : 'success'} />
              <FlowDetailRow label="Est. rewards / year" value={yearlyReward === null ? '—' : `+${formatAmount(yearlyReward)} ${nativeSymbol}`} accent={yearlyReward === null ? 'muted' : 'success'} />
              <FlowDetailRow label="Network fee" value={feeEstimate ? `${feeEstimate} ${nativeSymbol}` : 'Estimating…'} />
            </FlowDetails>
            <FlowCallout>{capabilities?.activationNote || 'Stake activates after the next epoch boundary.'}</FlowCallout>
            {submitError && <FlowCallout tone="danger" title="Stake failed">{submitError}</FlowCallout>}
          </div>
        )}
      </FlowSheet>
    </div>
  );
}

export default StakeFlowView;
