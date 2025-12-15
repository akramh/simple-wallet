/**
 * @fileoverview Token/asset card component for wallet list.
 */

import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface TokenCardProps {
  symbol: string;
  name: string;
  balance: string;
  fiatValue?: string;
  change24h?: number;
  iconUrl?: string;
  onPress?: () => void;
  isLoading?: boolean;
}

export function TokenCard({
  symbol,
  name,
  balance,
  fiatValue,
  change24h,
  iconUrl,
  onPress,
  isLoading = false,
}: TokenCardProps) {
  const isPositiveChange = (change24h ?? 0) >= 0;
  const formattedBalance = parseFloat(balance).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center py-4 border-b border-gray-800"
      activeOpacity={onPress ? 0.7 : 1}
    >
      {/* Token Icon */}
      <View className="w-12 h-12 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
        {iconUrl ? (
          <Image
            source={{ uri: iconUrl }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Text className="text-white font-bold text-lg">
            {symbol.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>

      {/* Token Info */}
      <View className="flex-1">
        <Text className="text-white font-medium text-base">{name}</Text>
        <Text className="text-gray-500 text-sm">{symbol}</Text>
      </View>

      {/* Balance & Value */}
      <View className="items-end">
        {isLoading ? (
          <>
            <View className="bg-gray-800 h-5 w-20 rounded mb-1" />
            <View className="bg-gray-800 h-4 w-14 rounded" />
          </>
        ) : (
          <>
            <Text className="text-white font-medium">{formattedBalance}</Text>
            {fiatValue && (
              <View className="flex-row items-center">
                <Text className="text-gray-500 text-sm">{fiatValue}</Text>
                {change24h !== undefined && (
                  <View className="flex-row items-center ml-2">
                    <Ionicons
                      name={isPositiveChange ? 'caret-up' : 'caret-down'}
                      size={12}
                      color={isPositiveChange ? '#22c55e' : '#ef4444'}
                    />
                    <Text
                      className={`text-xs ${
                        isPositiveChange ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {Math.abs(change24h).toFixed(1)}%
                    </Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}
