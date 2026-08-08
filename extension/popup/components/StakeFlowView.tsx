/**
 * @fileoverview New-stake wizard for the extension popup/sidepanel.
 *
 * Three steps: pick a validator (list sorted by activated stake descending,
 * each row showing the delegated amount, with search + manual address
 * entry), enter an amount, confirm with fee and activation-delay context.
 * Dispatches the chain-neutral STAKE message; signing happens in the service
 * worker.
 *
 * @responsibilities
 * - Fetch and filter validators via GET_STAKE_VALIDATORS
 * - Validate the stake amount against the network minimum
 * - Submit STAKE and surface the resulting transaction
 *
 * @security
 * - No secrets handled in UI; the service worker signs with the session
 *   password
 */

import React, { useState, useEffect, useMemo } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import { ScreenHeader } from './ui';
import { validatorLabel, type StakingCapabilitiesData } from './StakingView';

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
  /** Called on exit; didStake=true when a stake was submitted. */
  onClose: (didStake: boolean) => void;
}

type Step = 'validator' | 'amount' | 'confirm' | 'result';

/**
 * New-stake wizard.
 *
 * @param props - Component props
 * @returns Stake flow component
 */
function StakeFlowView({ network, networks, capabilities, onClose }: Props) {
  const [step, setStep] = useState<Step>('validator');
  const [validators, setValidators] = useState<ValidatorData[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [manualVote, setManualVote] = useState('');
  const [selected, setSelected] = useState<ValidatorData | null>(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ txId: string; positionId?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);

  const nativeSymbol = networks[network]?.nativeSymbol || 'SOL';
  const minStake = capabilities?.minStakeFormatted ?? '0';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await sendMessageWithRetry<{ validators?: ValidatorData[]; error?: string }>({
          type: 'GET_STAKE_VALIDATORS',
          payload: { networkKey: network },
        });
        if (!cancelled) setValidators(resp?.validators || []);
      } catch {
        // Validator discovery failing must not dead-end the flow — the
        // manual vote-address entry below still works.
        if (!cancelled) setValidators([]);
      } finally {
        if (!cancelled) setValidatorsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [network]);

  // Best-effort fee for the confirm step — parity with CLI/mobile. Null
  // renders as a pending ellipsis; staking never blocks on the estimate.
  useEffect(() => {
    if (step !== 'confirm') return;
    let cancelled = false;
    setFeeEstimate(null);
    sendMessageWithRetry<{ fee?: string; error?: string }>({
      type: 'ESTIMATE_STAKE_FEE',
      payload: { networkKey: network },
    })
      .then((resp) => { if (!cancelled && resp?.fee) setFeeEstimate(resp.fee); })
      .catch(() => { /* leave the pending ellipsis */ });
    return () => { cancelled = true; };
  }, [step, network]);

  const filteredValidators = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return validators;
    return validators.filter(
      (v) => (v.name || '').toLowerCase().includes(q) || v.id.toLowerCase().includes(q)
    );
  }, [validators, search]);

  const isValidVoteAddress = (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());

  const chooseManual = () => {
    const trimmed = manualVote.trim();
    if (!isValidVoteAddress(trimmed)) return;
    setSelected({
      id: trimmed,
      name: null,
      commissionPercent: null,
      apyPercent: null,
      activatedStakeFormatted: null,
      delinquent: false,
    });
    setStep('amount');
  };

  const validateAmount = (value: string): string | null => {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return 'Enter a valid numeric amount';
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
    if (num < parseFloat(minStake)) return `Minimum stake is ${minStake} ${nativeSymbol}`;
    return null;
  };

  const submitStake = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await sendMessageWithRetry<{ result?: { txId: string; positionId?: string }; error?: string }>({
        type: 'STAKE',
        payload: { validatorId: selected.id, amount: amount.trim(), networkKey: network },
      });
      if (resp?.error) throw new Error(resp.error);
      if (!resp?.result?.txId) throw new Error('No transaction id returned');
      setResult(resp.result);
      setStep('result');
    } catch (err: any) {
      setSubmitError(err?.message || 'Staking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const explorerUrl = result
    ? `${networks[network]?.blockExplorer || 'https://solscan.io'}/tx/${result.txId}${network === 'solana-devnet' ? '?cluster=devnet' : ''}`
    : null;

  return (
    <div className="takeover">
      <ScreenHeader
        title={`Stake ${nativeSymbol}`}
        onBack={() => {
          if (step === 'amount') setStep('validator');
          else if (step === 'confirm') setStep('amount');
          else onClose(step === 'result');
        }}
      />

      <div style={{ padding: '0 16px 16px' }}>
        {step === 'validator' && (
          <>
            <div className="form-group">
              <label>Choose a validator</label>
              <input
                type="text"
                placeholder="Search by name or vote address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {validatorsLoading ? (
              <div className="loading">Loading validators...</div>
            ) : (
              <div className="transaction-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
                {filteredValidators.map((v) => (
                  <div
                    key={v.id}
                    className="transaction-item"
                    onClick={() => { setSelected(v); setStep('amount'); }}
                  >
                    <div className="tx-content">
                      <div className="tx-row-primary">
                        <span className="tx-type">{validatorLabel(v)}</span>
                        <span className="tx-amount-value">
                          {v.apyPercent !== null ? `${v.apyPercent.toFixed(1)}% APY` : 'APY n/a'}
                        </span>
                      </div>
                      <div className="tx-row-secondary">
                        {/* Pre-formatted display string ("430,800") — render
                            verbatim; falls back to the vote address for
                            manual entries where stake is unknown. */}
                        <span className="tx-address">
                          {v.activatedStakeFormatted !== null
                            ? `${v.activatedStakeFormatted} ${nativeSymbol}`
                            : `${v.id.slice(0, 8)}…${v.id.slice(-8)}`}
                        </span>
                        <span className="tx-time">
                          {v.commissionPercent !== null ? `${v.commissionPercent}% fee` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredValidators.length === 0 && (
                  <div className="tx-row-secondary" style={{ padding: 8 }}>
                    <span className="tx-address">No validators match — enter a vote address below.</span>
                  </div>
                )}
              </div>
            )}

            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Or enter a vote address</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Validator vote address (base58)"
                  value={manualVote}
                  onChange={(e) => setManualVote(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-secondary"
                  disabled={!isValidVoteAddress(manualVote)}
                  onClick={chooseManual}
                >
                  Use
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'amount' && selected && (
          <>
            <div className="form-group">
              <label>Validator</label>
              <div className="asset-picker-chip" style={{ cursor: 'default' }}>
                <span className="asset-picker-chip__main">
                  <span className="asset-picker-chip__symbol">{validatorLabel(selected)}</span>
                  <span className="asset-picker-chip__network">
                    {selected.apyPercent !== null ? `${selected.apyPercent.toFixed(1)}% APY` : ''}
                    {selected.commissionPercent !== null ? ` · ${selected.commissionPercent}% fee` : ''}
                  </span>
                </span>
              </div>
            </div>

            <div className="form-group">
              <label>Amount ({nativeSymbol}, min {minStake})</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`0.0 ${nativeSymbol}`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError(null);
                }}
              />
              {amountError && <div className="tx-error-inline">{amountError}</div>}
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                const err = validateAmount(amount);
                if (err) { setAmountError(err); return; }
                setStep('confirm');
              }}
            >
              Review
            </button>
          </>
        )}

        {step === 'confirm' && selected && (
          <>
            <div className="form-group">
              <label>Confirm stake</label>
              <div className="transaction-item" style={{ cursor: 'default' }}>
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">Stake</span>
                    <span className="tx-amount-value">{amount.trim()} {nativeSymbol}</span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">To {validatorLabel(selected)}</span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">{selected.id}</span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">Network fee</span>
                    <span className="tx-time">
                      {feeEstimate ? `${feeEstimate} ${nativeSymbol}` : '…'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {capabilities && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>{capabilities.activationNote}</span>
              </div>
            )}

            {submitError && <div className="tx-error-inline" style={{ marginBottom: 8 }}>{submitError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={submitting} onClick={() => setStep('amount')}>
                Back
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={submitting} onClick={submitStake}>
                {submitting ? 'Staking…' : 'Confirm & Stake'}
              </button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <>
            <div className="form-group">
              <label>Stake submitted</label>
              <div className="transaction-item" style={{ cursor: 'default' }}>
                <div className="tx-content">
                  <div className="tx-row-primary">
                    <span className="tx-type">Pending confirmation</span>
                    <span className="tx-amount-value">{amount.trim()} {nativeSymbol}</span>
                  </div>
                  <div className="tx-row-secondary">
                    <span className="tx-address">Tx {result.txId.slice(0, 8)}…{result.txId.slice(-8)}</span>
                  </div>
                  {result.positionId && (
                    <div className="tx-row-secondary">
                      <span className="tx-address">Stake account {result.positionId.slice(0, 8)}…{result.positionId.slice(-8)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {capabilities && (
              <div className="activity-fallback-chip" style={{ marginBottom: 12 }}>
                <span>{capabilities.activationNote}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {explorerUrl && (
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => window.open(explorerUrl, '_blank')}>
                  View on explorer
                </button>
              )}
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onClose(true)}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default StakeFlowView;
