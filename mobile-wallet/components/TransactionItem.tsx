/**
 * @fileoverview Transaction list item component.
 */

import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type TransactionType = 'send' | 'receive' | 'swap' | 'contract' | 'approval';
type TransactionStatus = 'pending' | 'confirmed' | 'failed';

interface TransactionItemProps {
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  symbol: string;
  address: string; // to/from address
  timestamp: number;
  hash: string;
  onPress?: () => void;
}

const typeConfig: Record<TransactionType, {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  bgColor: string;
}> = {
  send: {
    icon: 'arrow-up',
    label: 'Sent',
    color: '#ef4444',
    bgColor: 'bg-red-500/20',
  },
  receive: {
    icon: 'arrow-down',
    label: 'Received',
    color: '#22c55e',
    bgColor: 'bg-green-500/20',
  },
  swap: {
    icon: 'swap-horizontal',
    label: 'Swapped',
    color: '#3b82f6',
    bgColor: 'bg-blue-500/20',
  },
  contract: {
    icon: 'code-slash',
    label: 'Contract',
    color: '#8b5cf6',
    bgColor: 'bg-purple-500/20',
  },
  approval: {
    icon: 'checkmark-circle',
    label: 'Approved',
    color: '#f59e0b',
    bgColor: 'bg-yellow-500/20',
  },
};

const statusConfig: Record<TransactionStatus, {
  label: string;
  color: string;
}> = {
  pending: { label: 'Pending', color: 'text-yellow-400' },
  confirmed: { label: '', color: '' },
  failed: { label: 'Failed', color: 'text-red-400' },
};

export function TransactionItem({
  type,
  status,
  amount,
  symbol,
  address,
  timestamp,
  hash,
  onPress,
}: TransactionItemProps) {
  const config = typeConfig[type];
  const statusInfo = statusConfig[status];
  const isSend = type === 'send';

  const truncatedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const formattedDate = formatRelativeTime(timestamp);
  const formattedAmount = parseFloat(amount).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center py-4 border-b border-gray-800"
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Icon */}
      <View
        className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${config.bgColor}`}
      >
        <Ionicons name={config.icon} size={20} color={config.color} />
      </View>

      {/* Info */}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className="text-white font-medium">{config.label} {symbol}</Text>
          {status !== 'confirmed' && (
            <View className="ml-2 px-2 py-0.5 rounded-full bg-gray-800">
              <Text className={`text-xs ${statusInfo.color}`}>
                {statusInfo.label}
              </Text>
            </View>
          )}
        </View>
        <Text className="text-gray-500 text-sm">
          {isSend ? 'To' : 'From'} {truncatedAddress}
        </Text>
      </View>

      {/* Amount & Time */}
      <View className="items-end">
        <Text
          className={`font-medium ${
            isSend ? 'text-red-400' : 'text-green-400'
          }`}
        >
          {isSend ? '-' : '+'}
          {formattedAmount} {symbol}
        </Text>
        <Text className="text-gray-500 text-xs">{formattedDate}</Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Format timestamp as relative time (e.g., "2 hours ago").
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return new Date(timestamp).toLocaleDateString();
  }
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'Just now';
}
