/**
 * @fileoverview Portfolio screen - shows holdings and performance.
 */

import { View, Text, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';

export default function PortfolioScreen() {
  const { balances, formattedTotal, totalValue } = useWalletStore();

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-6">
        <Text className="text-white text-2xl font-bold">Portfolio</Text>
        <Text className="text-gray-400 mt-1">Your asset allocation</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Total Value Card */}
        <View className="mx-5 bg-gradient-to-br from-purple-600 to-blue-600 rounded-2xl p-6 mb-6">
          <Text className="text-white/70 text-sm">Total Value</Text>
          <Text className="text-white text-4xl font-bold mt-2">{formattedTotal}</Text>
          <View className="flex-row items-center mt-3">
            <Ionicons name="trending-up" size={16} color="#86efac" />
            <Text className="text-green-300 ml-1">+0.00%</Text>
            <Text className="text-white/50 ml-2">24h</Text>
          </View>
        </View>

        {/* Holdings Section */}
        <View className="px-5">
          <Text className="text-white text-lg font-semibold mb-4">Holdings</Text>

          {balances.length === 0 ? (
            <View className="items-center py-12">
              <Ionicons name="pie-chart-outline" size={48} color="#4b5563" />
              <Text className="text-gray-500 mt-4">No holdings yet</Text>
              <Text className="text-gray-600 text-sm mt-1 text-center px-8">
                Your portfolio breakdown will appear here once you have tokens.
              </Text>
            </View>
          ) : (
            balances.map((item, index) => (
              <HoldingRow
                key={`${item.token.symbol}-${index}`}
                symbol={item.token.symbol}
                name={item.token.name}
                balance={item.balance || '0'}
                value={0} // TODO: Calculate from prices
                percentage={0}
                change24h={0}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function HoldingRow({
  symbol,
  name,
  balance,
  value,
  percentage,
  change24h,
}: {
  symbol: string;
  name: string;
  balance: string;
  value: number;
  percentage: number;
  change24h: number;
}) {
  const isPositive = change24h >= 0;

  return (
    <View className="flex-row items-center py-4 border-b border-gray-800">
      {/* Token Icon */}
      <View className="w-12 h-12 rounded-full bg-gray-800 items-center justify-center mr-3">
        <Text className="text-white font-bold text-lg">{symbol.charAt(0)}</Text>
      </View>

      {/* Token Info */}
      <View className="flex-1">
        <Text className="text-white font-medium">{name}</Text>
        <Text className="text-gray-500 text-sm">
          {parseFloat(balance).toFixed(4)} {symbol}
        </Text>
      </View>

      {/* Value & Change */}
      <View className="items-end">
        <Text className="text-white font-medium">${value.toFixed(2)}</Text>
        <View className="flex-row items-center">
          <Ionicons
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={14}
            color={isPositive ? '#22c55e' : '#ef4444'}
          />
          <Text
            className={`text-sm ml-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}
          >
            {isPositive ? '+' : ''}
            {change24h.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}
