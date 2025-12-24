/**
 * @fileoverview Send transaction status screen.
 */

import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNetworksSelector } from '../store';
import { useClipboard } from '../hooks';
import { safeGoBack } from '../utils/navigation';
import { formatTokenAmountDisplay } from '../utils/amounts';

export default function SendStatusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const networks = useNetworksSelector();
  const { copy, isCopied } = useClipboard();

  const txHash = typeof params.hash === 'string' ? params.hash : '';
  const status = typeof params.status === 'string' ? params.status : 'pending';
  const amount = typeof params.amount === 'string' ? params.amount : '';
  const symbol = typeof params.symbol === 'string' ? params.symbol : '';
  const recipient = typeof params.recipient === 'string' ? params.recipient : '';
  const networkKey = typeof params.network === 'string' ? params.network : '';
  const fee = typeof params.fee === 'string' ? params.fee : '';
  const feeSymbol = typeof params.feeSymbol === 'string' ? params.feeSymbol : '';
  const destinationTag = typeof params.destinationTag === 'string' ? params.destinationTag : '';
  const comment = typeof params.comment === 'string' ? params.comment : '';

  const amountDisplayParam =
    typeof params.amountDisplay === 'string' ? params.amountDisplay : amount;
  const feeDisplayParam =
    typeof params.feeDisplay === 'string' ? params.feeDisplay : fee;
  const formattedAmount = formatTokenAmountDisplay(amountDisplayParam, 8);
  const formattedFee = feeDisplayParam
    ? formatTokenAmountDisplay(feeDisplayParam, 8)
    : '';

  const networkConfig = networkKey ? networks[networkKey] : undefined;
  const explorerUrl =
    networkConfig?.blockExplorer && txHash
      ? `${networkConfig.blockExplorer}/tx/${txHash}`
      : null;

  const hasDetails = Boolean(amount && symbol && recipient);
  const statusLabel =
    status === 'confirmed' ? 'Confirmed' : status === 'failed' ? 'Failed' : 'Pending';
  const statusIcon =
    status === 'confirmed'
      ? 'checkmark-circle'
      : status === 'failed'
        ? 'close-circle'
        : 'time';
  const statusColor =
    status === 'confirmed'
      ? '#34d399'
      : status === 'failed'
        ? '#f87171'
        : '#a855f7';

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <View className="flex-1 px-5">
        <View className="flex-row items-center justify-between py-4">
          <TouchableOpacity onPress={() => safeGoBack(router)}>
            <Ionicons name="chevron-back" size={28} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Transaction</Text>
          <View className="w-7" />
        </View>

        <View className="items-center mt-8 mb-8">
          <Ionicons name={statusIcon} size={64} color={statusColor} />
          <Text className="text-white text-2xl font-bold mt-4">{statusLabel}</Text>
          <Text className="text-gray-400 mt-2">{networkConfig?.name || networkKey}</Text>
        </View>

        {!hasDetails && (
          <View className="bg-gray-900 rounded-2xl p-5 mb-6">
            <Text className="text-white font-semibold">Transaction details unavailable</Text>
            <Text className="text-gray-400 text-sm mt-2">
              Return to your wallet to view the latest activity.
            </Text>
          </View>
        )}

        {hasDetails && (
          <View className="bg-gray-900 rounded-2xl p-5 mb-6">
            <DetailRow label="Amount" value={`${formattedAmount} ${symbol}`} />
            <DetailRow
              label="To"
              value={`${recipient.slice(0, 10)}...${recipient.slice(-6)}`}
              copyValue={recipient}
              copied={isCopied(recipient)}
              onCopy={copy}
            />
            <DetailRow label="Network" value={networkConfig?.name || networkKey} />
            {fee && feeSymbol && (
              <DetailRow label="Network Fee" value={`${formattedFee} ${feeSymbol}`} />
            )}
            {destinationTag && (
              <DetailRow label="Destination Tag" value={destinationTag} />
            )}
            {comment && (
              <DetailRow label="Note" value={comment} />
            )}
            <DetailRow
              label="Hash"
              value={txHash
                ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}`
                : 'Pending'}
              copyValue={txHash}
              copied={txHash ? isCopied(txHash) : false}
              onCopy={copy}
              isLast
            />
          </View>
        )}

        <View className="mt-auto pb-6">
          {explorerUrl && (
            <TouchableOpacity
              className="rounded-xl py-4 items-center mb-3 bg-gray-800"
              onPress={() => {
                Linking.openURL(explorerUrl).catch((error) => {
                  console.error('Failed to open explorer URL:', error);
                });
              }}
            >
              <Text className="text-white font-semibold">View on Explorer</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            className="bg-purple-600 rounded-xl py-4 items-center"
            onPress={() => router.replace('/(tabs)/wallet')}
          >
            <Text className="text-white font-semibold">Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  copyValue,
  copied,
  onCopy,
  isLast,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copied?: boolean;
  onCopy?: (text: string) => Promise<boolean>;
  isLast?: boolean;
}) {
  return (
    <View className={`flex-row justify-between py-3 ${isLast ? '' : 'border-b border-gray-800'}`}>
      <Text className="text-gray-400">{label}</Text>
      <View className="flex-1 flex-row items-center justify-end">
        <Text
          className="text-white font-medium text-right max-w-[60%]"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {value}
        </Text>
        {copyValue && (
          <TouchableOpacity
            onPress={async () => {
              await onCopy?.(copyValue);
            }}
            className="ml-2"
          >
            <Ionicons
              name={copied ? 'checkmark-circle' : 'copy-outline'}
              size={16}
              color={copied ? '#a855f7' : '#9ca3af'}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
