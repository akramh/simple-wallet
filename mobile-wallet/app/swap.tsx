/**
 * @fileoverview Swap screen — source token → destination network/token →
 * amount → confirm.
 *
 * Mirrors the extension's SwapFlowView on mobile: a four-step wizard driven
 * by local step state (the send.tsx / stake.tsx precedent), with quoting
 * debounced on the confirm step. All routing (same-chain 1inch vs cross-chain
 * Mayan) lives behind the chain-neutral WalletBridge swap API; this screen
 * only renders what the quote reports.
 *
 * @responsibilities
 * - Drive the wizard and collect the swap request
 * - Debounce quote refreshes (the 1inch free tier is ~1 req/sec)
 * - Submit the quote and hand the result to the status screen
 *
 * @security
 * - Never touches passwords or keys; the bridge injects its in-memory session
 *   password for Solana-source swaps and EVM sources sign with the unlocked
 *   in-memory signer
 * - Quotes expire; the confirm step re-quotes rather than submitting a stale
 *   quote, which the service layer would reject anyway
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSwapScreenSelector } from '../store';
import {
  walletBridge,
  type Token,
  type SwapCapabilities,
} from '../services';
import { useDebouncedValue } from '../hooks';
import { safeGoBack } from '../utils/navigation';

type SwapStep = 'source' | 'destination' | 'amount' | 'confirm';

/** Human labels for the execution phases reported by the service layer. */
const PHASE_LABELS: Record<string, string> = {
  'checking-allowance': 'Checking token allowance…',
  approving: 'Approving token spend…',
  'approval-confirmed': 'Approval confirmed',
  'submitting-swap': 'Submitting swap…',
  'swap-submitted': 'Swap submitted',
};

/**
 * Swap wizard screen.
 *
 * @returns The swap screen element.
 */
export default function SwapScreen() {
  const router = useRouter();
  const {
    network,
    networks,
    swapQuote,
    isLoadingSwapQuote,
    swapQuoteError,
    swapPhase,
    loadSwapQuote,
    clearSwapQuote,
    executeSwap,
  } = useSwapScreenSelector();

  const [step, setStep] = useState<SwapStep>('source');
  const [capabilities, setCapabilities] = useState<SwapCapabilities | null>(null);
  const [sourceTokens, setSourceTokens] = useState<Token[]>([]);
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toNetworkKey, setToNetworkKey] = useState<string>('');
  const [destTokens, setDestTokens] = useState<Token[]>([]);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const debouncedAmount = useDebouncedValue(amount, 500);

  const networkLabel = useCallback(
    (key: string) => networks?.[key]?.name || key,
    [networks]
  );

  useEffect(() => {
    try {
      setCapabilities(walletBridge.getSwapCapabilities(network));
      setSourceTokens(walletBridge.getSwapDestTokens(network));
    } catch {
      setCapabilities(null);
      setSourceTokens([]);
    }
  }, [network]);

  // Destination tokens are not balance-filtered — you can swap into a token
  // you hold none of.
  useEffect(() => {
    if (!toNetworkKey) return;
    try {
      setDestTokens(walletBridge.getSwapDestTokens(toNetworkKey));
    } catch {
      setDestTokens([]);
    }
  }, [toNetworkKey]);

  // Clear any quote left over from a previous run of the wizard.
  useEffect(() => clearSwapQuote, [clearSwapQuote]);

  const validateAmount = (value: string): string | null => {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return 'Enter a valid numeric amount';
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
    return null;
  };

  // Debounced quoting while the confirm step is open, so a stale price is
  // never what the user taps Confirm on.
  useEffect(() => {
    if (step !== 'confirm' || !fromToken || !toToken || !toNetworkKey) return;
    if (validateAmount(debouncedAmount)) return;
    loadSwapQuote({
      fromNetworkKey: network,
      fromToken,
      toNetworkKey,
      toToken,
      amount: debouncedAmount.trim(),
    });
  }, [step, fromToken, toToken, toNetworkKey, debouncedAmount, network, loadSwapQuote]);

  const selectableDestTokens = useMemo(
    () => destTokens.filter((t) => !(toNetworkKey === network && t.symbol === fromToken?.symbol)),
    [destTokens, toNetworkKey, network, fromToken]
  );

  const handleSwap = async () => {
    if (!swapQuote) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await executeSwap(swapQuote);
      router.replace({
        pathname: '/swap-status',
        params: {
          provider: result.provider,
          txId: result.txId,
          approvalTxId: result.approvalTxId ?? '',
          fromNetwork: result.fromNetworkKey,
          toNetwork: result.toNetworkKey,
          amount: amount.trim(),
          fromSymbol: fromToken?.symbol ?? '',
          toSymbol: toToken?.symbol ?? '',
          expectedOut: swapQuote.amountOutFormatted,
        },
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  const headerTitle =
    step === 'source'
      ? 'Swap from'
      : step === 'destination'
        ? 'Swap to'
        : step === 'amount'
          ? `Amount (${fromToken?.symbol ?? ''})`
          : 'Confirm swap';

  const handleBack = () => {
    if (step === 'destination') setStep('source');
    else if (step === 'amount') setStep('destination');
    else if (step === 'confirm') setStep('amount');
    else safeGoBack(router);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <View className="flex-row items-center px-5 pb-4 border-b border-gray-800">
        <TouchableOpacity onPress={handleBack} className="w-7" testID="swap-back">
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="flex-1 text-white text-lg font-semibold text-center">{headerTitle}</Text>
        <View className="w-7" />
      </View>

      <ScrollView className="flex-1 px-5">
        {capabilities && !capabilities.canSwap && (
          <View className="bg-gray-900 border border-amber-400/40 rounded-xl p-3 mt-5">
            <Text className="text-amber-300 text-sm">
              {capabilities.unsupportedReason || 'Swaps are not available on this network'}
            </Text>
          </View>
        )}

        {step === 'source' && (
          <View className="mt-5">
            {sourceTokens.map((token) => (
              <TouchableOpacity
                key={`${token.symbol}-${token.address}`}
                testID={`swap-source-${token.symbol}`}
                className="bg-gray-900 rounded-xl p-4 mb-3 flex-row items-center justify-between"
                onPress={() => {
                  setFromToken(token);
                  setStep('destination');
                }}
              >
                <View>
                  <Text className="text-white font-semibold text-base">{token.symbol}</Text>
                  <Text className="text-gray-500 text-sm">{token.name}</Text>
                </View>
                {token.type === 'native' && <Text className="text-gray-500 text-xs">Native</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {step === 'destination' && (
          <View className="mt-5">
            <Text className="text-gray-400 text-sm mb-2">Destination network</Text>
            {(capabilities?.destinationNetworkKeys ?? []).map((key) => (
              <TouchableOpacity
                key={key}
                testID={`swap-dest-network-${key}`}
                className={`rounded-xl p-4 mb-3 flex-row items-center justify-between ${
                  toNetworkKey === key ? 'bg-purple-600' : 'bg-gray-900'
                }`}
                onPress={() => {
                  setToNetworkKey(key);
                  setToToken(null);
                }}
              >
                <Text className="text-white font-medium">{networkLabel(key)}</Text>
                <Text className="text-gray-300 text-xs">
                  {key === network ? 'Same network' : 'Cross-chain'}
                </Text>
              </TouchableOpacity>
            ))}

            {toNetworkKey !== '' && (
              <>
                <Text className="text-gray-400 text-sm mt-4 mb-2">
                  Token to receive on {networkLabel(toNetworkKey)}
                </Text>
                {selectableDestTokens.map((token) => (
                  <TouchableOpacity
                    key={`${token.symbol}-${token.address}`}
                    testID={`swap-dest-token-${token.symbol}`}
                    className="bg-gray-900 rounded-xl p-4 mb-3 flex-row items-center justify-between"
                    onPress={() => {
                      setToToken(token);
                      setStep('amount');
                    }}
                  >
                    <View>
                      <Text className="text-white font-semibold text-base">{token.symbol}</Text>
                      <Text className="text-gray-500 text-sm">{token.name}</Text>
                    </View>
                    {token.type === 'native' && <Text className="text-gray-500 text-xs">Native</Text>}
                  </TouchableOpacity>
                ))}
                {selectableDestTokens.length === 0 && (
                  <Text className="text-gray-500 text-sm">No tokens available on this network.</Text>
                )}
              </>
            )}
          </View>
        )}

        {step === 'amount' && fromToken && toToken && (
          <View className="mt-5">
            <View className="bg-gray-900 rounded-xl p-4 mb-4">
              <Text className="text-white font-semibold">
                {fromToken.symbol} → {toToken.symbol}
              </Text>
              <Text className="text-gray-500 text-sm mt-1">
                {networkLabel(network)} → {networkLabel(toNetworkKey)}
              </Text>
            </View>

            <TextInput
              testID="swap-amount-input"
              className="bg-gray-900 text-white rounded-xl px-4 py-4 text-lg"
              placeholder={`0.0 ${fromToken.symbol}`}
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={(text) => {
                setAmount(text);
                setAmountError(null);
              }}
            />
            {amountError && <Text className="text-red-400 text-sm mt-2">{amountError}</Text>}

            <TouchableOpacity
              testID="swap-get-quote"
              className="bg-purple-600 rounded-xl py-4 mt-5"
              onPress={() => {
                const err = validateAmount(amount);
                if (err) {
                  setAmountError(err);
                  return;
                }
                clearSwapQuote();
                setStep('confirm');
              }}
            >
              <Text className="text-white font-semibold text-center text-lg">Get quote</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'confirm' && fromToken && toToken && (
          <View className="mt-5">
            <View className="bg-gray-900 rounded-xl p-4 mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-gray-400">You pay</Text>
                <Text className="text-white font-semibold">
                  {amount.trim()} {fromToken.symbol}
                </Text>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-gray-400">You receive</Text>
                <Text className="text-white font-semibold">
                  {isLoadingSwapQuote
                    ? '…'
                    : swapQuote
                      ? `~${swapQuote.amountOutFormatted} ${swapQuote.toTokenSymbol}`
                      : '—'}
                </Text>
              </View>
              {swapQuote && (
                <>
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-gray-400">Minimum received</Text>
                    <Text className="text-gray-300">
                      {swapQuote.minAmountOutFormatted} {swapQuote.toTokenSymbol}
                    </Text>
                  </View>
                  {swapQuote.rateFormatted !== '' && (
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-400">Rate</Text>
                      <Text className="text-gray-300">{swapQuote.rateFormatted}</Text>
                    </View>
                  )}
                  {swapQuote.feeFormatted !== '' && (
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-400">Network fee</Text>
                      <Text className="text-gray-300">{swapQuote.feeFormatted}</Text>
                    </View>
                  )}
                  {swapQuote.bridgeFeeFormatted && (
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-400">Bridge fee</Text>
                      <Text className="text-gray-300">{swapQuote.bridgeFeeFormatted}</Text>
                    </View>
                  )}
                  {typeof swapQuote.etaSeconds === 'number' && (
                    <View className="flex-row justify-between mb-2">
                      <Text className="text-gray-400">Estimated time</Text>
                      <Text className="text-gray-300">
                        ~{Math.max(1, Math.round(swapQuote.etaSeconds / 60))} min
                      </Text>
                    </View>
                  )}
                  <View className="flex-row justify-between">
                    <Text className="text-gray-400">Via</Text>
                    <Text className="text-gray-300">
                      {swapQuote.provider === 'oneinch' ? '1inch' : 'Mayan'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {swapQuote?.needsApproval && (
              <View className="bg-gray-900 border border-sky-400/40 rounded-xl p-3 mb-4">
                <Text className="text-sky-300 text-sm">
                  Requires a token approval first — 2 transactions will be sent.
                </Text>
              </View>
            )}

            {swapQuoteError && (
              <View className="bg-gray-900 border border-red-400/40 rounded-xl p-3 mb-4">
                <Text className="text-red-400 text-sm">{swapQuoteError}</Text>
              </View>
            )}
            {submitError && (
              <View className="bg-gray-900 border border-red-400/40 rounded-xl p-3 mb-4">
                <Text className="text-red-400 text-sm">{submitError}</Text>
              </View>
            )}
            {submitting && swapPhase && (
              <View className="flex-row items-center mb-4">
                <ActivityIndicator color="#a855f7" />
                <Text className="text-gray-400 text-sm ml-3">
                  {PHASE_LABELS[swapPhase] ?? swapPhase}
                </Text>
              </View>
            )}

            <TouchableOpacity
              testID="swap-confirm"
              className={`rounded-xl py-4 ${
                submitting || isLoadingSwapQuote || !swapQuote ? 'bg-gray-700' : 'bg-purple-600'
              }`}
              disabled={submitting || isLoadingSwapQuote || !swapQuote}
              onPress={handleSwap}
            >
              <Text className="text-white font-semibold text-center text-lg">
                {submitting ? 'Swapping…' : 'Confirm & Swap'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
