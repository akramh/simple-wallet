/**
 * @fileoverview Swap status screen — polls a submitted swap to completion.
 *
 * Reached via router.replace from swap.tsx with the execution result in route
 * params (the send-status.tsx precedent). Cross-chain swaps settle on the
 * destination chain minutes after the source transaction confirms, so this
 * screen polls the chain-neutral getSwapStatus until a terminal state or a
 * bounded timeout.
 *
 * @responsibilities
 * - Poll swap status on an interval and render the terminal outcome
 * - Offer a way back to the wallet without cancelling anything on-chain
 *
 * @security
 * - Read-only: no keys, passwords, or signing. Leaving the screen never
 *   affects the in-flight swap.
 */

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { walletBridge, type SwapStatusView, type SwapProviderId } from '../services';

/** Poll cadence and ceiling. Mayan relays can take minutes. */
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 30 * 60 * 1000;

/**
 * Swap status screen.
 *
 * @returns The swap status screen element.
 */
export default function SwapStatusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const provider = (typeof params.provider === 'string' ? params.provider : 'mayan') as SwapProviderId;
  const txId = typeof params.txId === 'string' ? params.txId : '';
  const approvalTxId = typeof params.approvalTxId === 'string' ? params.approvalTxId : '';
  const fromNetwork = typeof params.fromNetwork === 'string' ? params.fromNetwork : '';
  const amount = typeof params.amount === 'string' ? params.amount : '';
  const fromSymbol = typeof params.fromSymbol === 'string' ? params.fromSymbol : '';
  const toSymbol = typeof params.toSymbol === 'string' ? params.toSymbol : '';
  const expectedOut = typeof params.expectedOut === 'string' ? params.expectedOut : '';

  const [status, setStatus] = useState<SwapStatusView>({ state: 'pending' });
  const startedAtRef = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!txId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await walletBridge.getSwapStatus({ provider, txId, fromNetworkKey: fromNetwork });
        if (!cancelled) setStatus(next);
        return next.state !== 'pending';
      } catch {
        // Transient failures shouldn't end the poll; try again next tick.
        return false;
      }
    };

    poll();
    const timer = setInterval(async () => {
      if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
        clearInterval(timer);
        if (!cancelled) setTimedOut(true);
        return;
      }
      const done = await poll();
      if (done) clearInterval(timer);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [provider, txId, fromNetwork]);

  const isPending = status.state === 'pending' && !timedOut;
  const title =
    status.state === 'completed'
      ? 'Swap complete'
      : status.state === 'refunded'
        ? 'Swap refunded'
        : status.state === 'failed'
          ? 'Swap failed'
          : timedOut
            ? 'Still in progress'
            : 'Swapping…';

  const iconName =
    status.state === 'completed'
      ? 'checkmark-circle'
      : status.state === 'failed'
        ? 'close-circle'
        : status.state === 'refunded'
          ? 'return-down-back'
          : 'time-outline';
  const iconColor =
    status.state === 'completed' ? '#34d399' : status.state === 'failed' ? '#f87171' : '#eab308';

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <ScrollView className="flex-1 px-5">
        <View className="items-center py-10">
          {isPending ? (
            <ActivityIndicator size="large" color="#a855f7" />
          ) : (
            <Ionicons name={iconName as any} size={64} color={iconColor} />
          )}
          <Text testID="swap-status-title" className="text-white text-xl font-semibold mt-5">
            {title}
          </Text>
          <Text className="text-gray-400 text-base mt-2">
            {amount} {fromSymbol} → ~{expectedOut} {toSymbol}
          </Text>
        </View>

        <View className="bg-gray-900 rounded-xl p-4">
          {approvalTxId !== '' && (
            <View className="mb-3">
              <Text className="text-gray-400 text-sm">Approval transaction</Text>
              <Text className="text-gray-300 text-sm mt-1">
                {approvalTxId.slice(0, 10)}…{approvalTxId.slice(-8)}
              </Text>
            </View>
          )}
          <View>
            <Text className="text-gray-400 text-sm">Swap transaction</Text>
            <Text className="text-gray-300 text-sm mt-1">
              {txId.slice(0, 10)}…{txId.slice(-8)}
            </Text>
          </View>
          {status.destTxId && status.destTxId !== txId && (
            <View className="mt-3">
              <Text className="text-gray-400 text-sm">Destination transaction</Text>
              <Text className="text-gray-300 text-sm mt-1">
                {status.destTxId.slice(0, 10)}…{status.destTxId.slice(-8)}
              </Text>
            </View>
          )}
        </View>

        {isPending && provider === 'mayan' && (
          <Text className="text-gray-500 text-sm mt-4 text-center">
            Cross-chain swaps settle on the destination chain a few minutes after the source
            transaction confirms.
          </Text>
        )}
        {timedOut && (
          <Text className="text-gray-500 text-sm mt-4 text-center">
            Still relaying. Your funds are safe — check the transaction again later.
          </Text>
        )}
        {status.detail && (
          <Text className="text-gray-500 text-sm mt-4 text-center">{status.detail}</Text>
        )}

        <TouchableOpacity
          testID="swap-status-done"
          className="bg-purple-600 rounded-xl py-4 mt-8 mb-8"
          onPress={() => router.replace('/(tabs)/wallet')}
        >
          <Text className="text-white font-semibold text-center text-lg">Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
