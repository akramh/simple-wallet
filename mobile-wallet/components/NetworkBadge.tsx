/**
 * @fileoverview Network indicator badge component.
 */

import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NetworkBadgeProps {
  name: string;
  isConnected?: boolean;
  isTestnet?: boolean;
  onPress?: () => void;
}

export function NetworkBadge({
  name,
  isConnected = true,
  isTestnet = false,
  onPress,
}: NetworkBadgeProps) {
  const statusColor = isConnected ? 'bg-green-500' : 'bg-red-500';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center bg-gray-900 px-3 py-2 rounded-full"
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View className={`w-2.5 h-2.5 rounded-full ${statusColor} mr-2`} />
      <Text className="text-gray-300 text-sm">{name}</Text>
      {isTestnet && (
        <View className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 rounded">
          <Text className="text-yellow-400 text-xs">Testnet</Text>
        </View>
      )}
      {onPress && (
        <Ionicons
          name="chevron-down"
          size={14}
          color="#9ca3af"
          style={{ marginLeft: 4 }}
        />
      )}
    </TouchableOpacity>
  );
}
