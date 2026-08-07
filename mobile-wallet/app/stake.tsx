/**
 * @fileoverview Staking screen — positions overview + stake/unstake/withdraw.
 *
 * Mirrors the extension's StakingView/StakeFlowView on mobile: a positions
 * list (validator, amount, lifecycle state, epochs, USD) with state-gated
 * actions, and an in-screen wizard (validator picker → amount → confirm)
 * driven by local step state, following the send.tsx precedent. All chain
 * logic lives behind the chain-neutral WalletBridge staking API.
 *
 * @responsibilities
 * - Render staking positions and dispatch unstake/withdraw per state
 * - Drive the new-stake wizard and submit via the store's stake action
 *
 * @security
 * - Never touches passwords or keys; the bridge signs with its in-memory
 *   session password
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStakingScreenSelector } from '../store';
import {
  walletBridge,
  type StakePositionView,
  type ValidatorSummary,
  type StakingCapabilities,
} from '../services';
import { formatDecimal } from '../utils/amounts';
import { safeGoBack } from '../utils/navigation';

type StakeStep = 'list' | 'validator' | 'amount' | 'confirm';

const STATE_COLORS: Record<string, string> = {
  active: '#34d399',
  activating: '#eab308',
  deactivating: '#eab308',
  withdrawable: '#38bdf8',
  pending: '#eab308',
  inactive: '#6b7280',
};

/** Compact validator label: name when known, else truncated id. */
function validatorLabel(v: { name: string | null; id: string }): string {
  if (v.name) return v.name;
  if (!v.id) return 'Undelegated';
  return `${v.id.slice(0, 4)}…${v.id.slice(-4)}`;
}

/** Round a 9-decimal fixed amount string for display. */
function formatAmount(amount: string, maxDecimals: number = 4): string {
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return amount;
  if (n === 0) return '0';
  const cutoff = 1 / 10 ** maxDecimals;
  if (Math.abs(n) < cutoff) return `<${cutoff.toFixed(maxDecimals)}`;
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-gray-400 text-sm">{label}</Text>
      <Text className="text-gray-200 text-sm">{value}</Text>
    </View>
  );
}

function StatePill({ state }: { state: string }) {
  const color = STATE_COLORS[state] || '#6b7280';
  return (
    <View
      className="flex-row items-center px-3 py-1 rounded-full"
      style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}66` }}
    >
      <View className="w-1.5 h-1.5 rounded-full mr-2" style={{ backgroundColor: color }} />
      <Text className="text-xs font-semibold uppercase" style={{ color }}>
        {state}
      </Text>
    </View>
  );
}

export default function StakeScreen() {
  const router = useRouter();
  const {
    network,
    networks,
    balances,
    stakePositions,
    isLoadingStakePositions,
    loadStakePositions,
    stake,
    unstake,
    withdrawStake,
  } = useStakingScreenSelector();

  const nativeSymbol = networks[network]?.nativeSymbol || 'SOL';

  const [step, setStep] = useState<StakeStep>('list');
  const [capabilities, setCapabilities] = useState<StakingCapabilities | null>(null);
  const [validators, setValidators] = useState<ValidatorSummary[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [manualVote, setManualVote] = useState('');
  const [selectedValidator, setSelectedValidator] = useState<ValidatorSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const nativeBalance = useMemo(() => {
    const native = balances.find((b: any) => b.token?.type === 'native');
    return native ? parseFloat(native.balance ?? '0') || 0 : 0;
  }, [balances]);

  useEffect(() => {
    loadStakePositions();
    try {
      setCapabilities(walletBridge.getStakingCapabilities(network));
    } catch {
      setCapabilities(null);
    }
  }, [network, loadStakePositions]);

  const openStakeFlow = useCallback(async () => {
    setStep('validator');
    setSearch('');
    setManualVote('');
    setSelectedValidator(null);
    setAmount('');
    setValidatorsLoading(true);
    try {
      setValidators(await walletBridge.getStakeValidators(network));
    } finally {
      setValidatorsLoading(false);
    }
  }, [network]);

  const filteredValidators = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return validators;
    return validators.filter(
      (v) => (v.name || '').toLowerCase().includes(q) || v.id.toLowerCase().includes(q)
    );
  }, [validators, search]);

  const isValidVoteAddress = (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());

  const minStake = parseFloat(capabilities?.minStakeFormatted ?? '0');
  const amountNum = parseFloat(amount) || 0;
  const amountError =
    amount.trim() === ''
      ? null
      : !/^\d+(\.\d+)?$/.test(amount.trim())
        ? 'Enter a valid numeric amount'
        : amountNum <= 0
          ? 'Amount must be greater than 0'
          : amountNum < minStake
            ? `Minimum stake is ${capabilities?.minStakeFormatted} ${nativeSymbol}`
            : amountNum > nativeBalance
              ? 'Insufficient balance'
              : null;

  const goToConfirm = useCallback(async () => {
    setStep('confirm');
    setFeeEstimate(null);
    try {
      setFeeEstimate(await walletBridge.estimateStakeFee(network));
    } catch {
      setFeeEstimate(null);
    }
  }, [network]);

  const submitStake = useCallback(async () => {
    if (!selectedValidator) return;
    setSubmitting(true);
    try {
      const result = await stake(selectedValidator.id, amount.trim());
      setStep('list');
      Alert.alert(
        'Stake submitted',
        `${amount.trim()} ${nativeSymbol} staked with ${validatorLabel(selectedValidator)}.\n\n` +
          `Tx ${result.txId.slice(0, 8)}…${result.txId.slice(-8)}\n\n` +
          (capabilities?.activationNote ?? '')
      );
    } catch (error) {
      Alert.alert('Staking failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }, [selectedValidator, amount, stake, nativeSymbol, capabilities]);

  const confirmUnstake = useCallback(
    (position: StakePositionView) => {
      Alert.alert(
        'Unstake',
        `Unstake ${formatAmount(position.totalFormatted)} ${nativeSymbol} from ${validatorLabel(position.validator)}?\n\n${capabilities?.deactivationNote ?? ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unstake',
            style: 'destructive',
            onPress: async () => {
              setActingOn(position.positionId);
              try {
                await unstake(position.positionId);
              } catch (error) {
                Alert.alert('Unstake failed', error instanceof Error ? error.message : 'Unknown error');
              } finally {
                setActingOn(null);
              }
            },
          },
        ]
      );
    },
    [unstake, nativeSymbol, capabilities]
  );

  const confirmWithdraw = useCallback(
    (position: StakePositionView) => {
      Alert.alert(
        'Withdraw',
        `Withdraw ${formatAmount(position.totalFormatted)} ${nativeSymbol} back to your wallet?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Withdraw',
            onPress: async () => {
              setActingOn(position.positionId);
              try {
                await withdrawStake(position.positionId);
              } catch (error) {
                Alert.alert('Withdraw failed', error instanceof Error ? error.message : 'Unknown error');
              } finally {
                setActingOn(null);
              }
            },
          },
        ]
      );
    },
    [withdrawStake, nativeSymbol]
  );

  const headerTitle =
    step === 'list' ? 'Staking' : step === 'validator' ? 'Choose validator' : step === 'amount' ? `Stake ${nativeSymbol}` : 'Confirm stake';

  const handleBack = () => {
    if (step === 'validator') setStep('list');
    else if (step === 'amount') setStep('validator');
    else if (step === 'confirm') setStep('amount');
    else safeGoBack(router);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pb-4 border-b border-gray-800">
        <TouchableOpacity onPress={handleBack} className="w-7">
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="flex-1 text-white text-lg font-semibold text-center">{headerTitle}</Text>
        <View className="w-7" />
      </View>

      {step === 'list' && (
        <ScrollView
          className="flex-1 px-5"
          refreshControl={
            <RefreshControl
              refreshing={isLoadingStakePositions}
              onRefresh={() => loadStakePositions()}
              tintColor="#a855f7"
            />
          }
        >
          <TouchableOpacity className="bg-purple-600 rounded-xl py-4 mt-5 mb-4" onPress={openStakeFlow}>
            <Text className="text-white font-semibold text-center text-lg">Stake {nativeSymbol}</Text>
          </TouchableOpacity>

          {isLoadingStakePositions && stakePositions.length === 0 ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#a855f7" />
              <Text className="text-gray-500 mt-4">Loading staking positions…</Text>
            </View>
          ) : stakePositions.length === 0 ? (
            <View className="items-center py-12">
              <Ionicons name="layers-outline" size={48} color="#4b5563" />
              <Text className="text-gray-500 mt-4">No staking positions yet</Text>
              <Text className="text-gray-600 text-sm mt-1 text-center px-6">
                Stake {nativeSymbol} with a validator to start earning rewards.
              </Text>
            </View>
          ) : (
            stakePositions.map((p) => {
              const canUnstake = p.state === 'active' || p.state === 'activating';
              const canWithdraw = p.state === 'withdrawable';
              const busy = actingOn === p.positionId;
              const epochsAgo =
                typeof p.activationEpoch === 'number' && typeof p.currentEpoch === 'number'
                  ? p.currentEpoch - p.activationEpoch
                  : null;
              return (
                <View key={p.positionId} className="bg-gray-900 rounded-2xl p-5 mb-4">
                  <View className="flex-row justify-between items-center mb-3">
                    <Text className="text-white font-semibold text-base flex-1 mr-2" numberOfLines={1}>
                      {validatorLabel(p.validator)}
                    </Text>
                    <StatePill state={p.state} />
                  </View>

                  <Text className="text-white text-2xl font-bold">
                    {formatAmount(p.totalFormatted)} {nativeSymbol}
                  </Text>
                  {typeof p.usdValue === 'number' && (
                    <Text className="text-gray-400 text-sm mt-1">~${formatDecimal(p.usdValue, 2)}</Text>
                  )}

                  <View className="border-t border-gray-800 mt-4 pt-2">
                    {typeof p.activationEpoch === 'number' && (
                      <DetailRow
                        label="Staked at epoch"
                        value={`${p.activationEpoch}${epochsAgo !== null && epochsAgo >= 0 ? ` (${epochsAgo === 0 ? 'this epoch' : `${epochsAgo} epoch${epochsAgo === 1 ? '' : 's'} ago`})` : ''}`}
                      />
                    )}
                    {typeof p.deactivationEpoch === 'number' && (
                      <DetailRow label="Unstaked at epoch" value={String(p.deactivationEpoch)} />
                    )}
                    {typeof p.currentEpoch === 'number' && (
                      <DetailRow label="Current epoch" value={String(p.currentEpoch)} />
                    )}
                    {p.validator.apyPercent !== null && (
                      <DetailRow label="APY" value={`${p.validator.apyPercent.toFixed(1)}%`} />
                    )}
                    {p.lastRewardFormatted && (
                      <DetailRow label="Last reward" value={`+${formatAmount(p.lastRewardFormatted, 6)} ${nativeSymbol}`} />
                    )}
                    <DetailRow
                      label="Stake account"
                      value={`${p.positionId.slice(0, 6)}…${p.positionId.slice(-6)}`}
                    />
                  </View>

                  {canUnstake && (
                    <TouchableOpacity
                      className={`rounded-xl py-3 mt-3 border border-gray-700 ${busy ? 'opacity-50' : ''}`}
                      disabled={busy}
                      onPress={() => confirmUnstake(p)}
                    >
                      <Text className="text-white font-medium text-center">
                        {busy ? 'Unstaking…' : 'Unstake'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {canWithdraw && (
                    <TouchableOpacity
                      className={`bg-purple-600 rounded-xl py-3 mt-3 ${busy ? 'opacity-50' : ''}`}
                      disabled={busy}
                      onPress={() => confirmWithdraw(p)}
                    >
                      <Text className="text-white font-medium text-center">
                        {busy ? 'Withdrawing…' : 'Withdraw'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {p.state === 'activating' && (
                    <Text className="text-gray-500 text-xs mt-3">Activates at the next epoch boundary</Text>
                  )}
                  {p.state === 'deactivating' && (
                    <Text className="text-gray-500 text-xs mt-3">
                      Withdraw unlocks after the next epoch boundary
                    </Text>
                  )}
                </View>
              );
            })
          )}
          <View className="h-8" />
        </ScrollView>
      )}

      {step === 'validator' && (
        <ScrollView className="flex-1 px-5" keyboardShouldPersistTaps="handled">
          <TextInput
            className="bg-gray-900 text-white rounded-xl px-4 py-3 mt-5 mb-3"
            placeholder="Search by name or vote address…"
            placeholderTextColor="#6b7280"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {validatorsLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#a855f7" />
              <Text className="text-gray-500 mt-4">Loading validators…</Text>
            </View>
          ) : (
            filteredValidators.map((v) => (
              <TouchableOpacity
                key={v.id}
                className="bg-gray-900 rounded-2xl p-4 mb-3"
                onPress={() => {
                  setSelectedValidator(v);
                  setStep('amount');
                }}
              >
                <View className="flex-row justify-between items-center">
                  <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={1}>
                    {validatorLabel(v)}
                  </Text>
                  <Text className="text-purple-400 font-medium">
                    {v.apyPercent !== null ? `${v.apyPercent.toFixed(1)}% APY` : 'APY n/a'}
                  </Text>
                </View>
                <View className="flex-row justify-between mt-1">
                  {/* Pre-formatted display string ("430,800") — render verbatim;
                      falls back to the vote address when stake is unknown. */}
                  <Text className="text-gray-500 text-xs">
                    {v.activatedStakeFormatted !== null
                      ? `${v.activatedStakeFormatted} ${nativeSymbol}`
                      : `${v.id.slice(0, 8)}…${v.id.slice(-8)}`}
                  </Text>
                  <Text className="text-gray-500 text-xs">
                    {v.commissionPercent !== null ? `${v.commissionPercent}% fee` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}

          <Text className="text-gray-400 text-sm mt-3 mb-2">Or enter a vote address</Text>
          <View className="flex-row gap-2 mb-8">
            <TextInput
              className="bg-gray-900 text-white rounded-xl px-4 py-3 flex-1"
              placeholder="Validator vote address (base58)"
              placeholderTextColor="#6b7280"
              value={manualVote}
              onChangeText={setManualVote}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              className={`rounded-xl px-4 justify-center ${isValidVoteAddress(manualVote) ? 'bg-purple-600' : 'bg-gray-800'}`}
              disabled={!isValidVoteAddress(manualVote)}
              onPress={() => {
                setSelectedValidator({
                  id: manualVote.trim(),
                  name: null,
                  commissionPercent: null,
                  apyPercent: null,
                  activatedStakeFormatted: null,
                  delinquent: false,
                });
                setStep('amount');
              }}
            >
              <Text className="text-white font-medium">Use</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {step === 'amount' && selectedValidator && (
        <View className="flex-1 px-5">
          <View className="bg-gray-900 rounded-2xl p-4 mt-5 mb-4">
            <Text className="text-white font-semibold">{validatorLabel(selectedValidator)}</Text>
            <Text className="text-gray-500 text-xs mt-1">
              {selectedValidator.apyPercent !== null ? `${selectedValidator.apyPercent.toFixed(1)}% APY` : ''}
              {selectedValidator.commissionPercent !== null ? ` · ${selectedValidator.commissionPercent}% fee` : ''}
            </Text>
          </View>

          <Text className="text-gray-400 text-sm mb-2">
            Amount ({nativeSymbol}, min {capabilities?.minStakeFormatted ?? '0'})
          </Text>
          <TextInput
            className="bg-gray-900 text-white rounded-xl px-4 py-4 text-xl"
            placeholder="0.0"
            placeholderTextColor="#6b7280"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <View className="flex-row justify-between mt-2">
            <Text className="text-gray-500 text-xs">
              Balance: {formatAmount(String(nativeBalance))} {nativeSymbol}
            </Text>
            {amountError && <Text className="text-red-400 text-xs">{amountError}</Text>}
          </View>

          <TouchableOpacity
            className={`rounded-xl py-4 mt-6 ${!amountError && amount.trim() !== '' ? 'bg-purple-600' : 'bg-gray-800'}`}
            disabled={!!amountError || amount.trim() === ''}
            onPress={goToConfirm}
          >
            <Text className="text-white font-semibold text-center text-lg">Review</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'confirm' && selectedValidator && (
        <View className="flex-1 px-5">
          <View className="bg-gray-900 rounded-2xl p-5 mt-5">
            <DetailRow label="Stake" value={`${amount.trim()} ${nativeSymbol}`} />
            <DetailRow label="Validator" value={validatorLabel(selectedValidator)} />
            <DetailRow
              label="Vote address"
              value={`${selectedValidator.id.slice(0, 6)}…${selectedValidator.id.slice(-6)}`}
            />
            <DetailRow
              label="Network fee"
              value={feeEstimate ? `${feeEstimate} ${nativeSymbol}` : '…'}
            />
          </View>

          {capabilities && (
            <View className="bg-gray-900 rounded-2xl p-4 mt-4">
              <Text className="text-gray-400 text-sm">{capabilities.activationNote}</Text>
            </View>
          )}

          <TouchableOpacity
            className={`bg-purple-600 rounded-xl py-4 mt-6 ${submitting ? 'opacity-50' : ''}`}
            disabled={submitting}
            onPress={submitStake}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold text-center text-lg">Confirm & Stake</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
