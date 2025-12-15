/**
 * @fileoverview Main wallet screen - shows balances and quick actions.
 */

import { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';

export default function WalletScreen() {
  const router = useRouter();
  const {
    address,
    network,
    networks,
    balances,
    isRefreshingBalances,
    formattedTotal,
    refreshBalances,
  } = useWalletStore();

  // Refresh balances on mount
  useEffect(() => {
    refreshBalances();
  }, []);

  const handleRefresh = useCallback(() => {
    refreshBalances();
  }, [refreshBalances]);

  const networkConfig = networks[network];
  const truncatedAddress = address
    ? `${address.slice(0, 8)}...${address.slice(-6)}`
    : '';

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-6">
        {/* Network Selector */}
        <Pressable
          onPress={() => router.push('/network-select')}
          className="flex-row items-center self-start bg-gray-900 px-3 py-2 rounded-full mb-4"
        >
          <View className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />
          <Text className="text-gray-300 text-sm">{networkConfig?.name || network}</Text>
          <Ionicons name="chevron-down" size={16} color="#9ca3af" className="ml-1" />
        </Pressable>

        {/* Total Balance */}
        <Text className="text-gray-400 text-sm mb-1">Total Balance</Text>
        <Text className="text-white text-4xl font-bold mb-1">{formattedTotal}</Text>
        <Pressable className="flex-row items-center">
          <Text className="text-gray-400 text-sm">{truncatedAddress}</Text>
          <Ionicons name="copy-outline" size={14} color="#9ca3af" className="ml-2" />
        </Pressable>
      </View>

      {/* Quick Actions */}
      <View className="flex-row justify-center gap-4 px-5 mb-6">
        <QuickActionButton
          icon="arrow-up"
          label="Send"
          onPress={() => router.push('/send')}
        />
        <QuickActionButton
          icon="arrow-down"
          label="Receive"
          onPress={() => router.push('/receive')}
        />
        <QuickActionButton
          icon="swap-horizontal"
          label="Swap"
          onPress={() => {}}
          disabled
        />
        <QuickActionButton
          icon="card"
          label="Buy"
          onPress={() => {}}
          disabled
        />
      </View>

      {/* Token List */}
      <View className="flex-1 bg-gray-900/50 rounded-t-3xl px-5 pt-5">
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-white text-lg font-semibold">Tokens</Text>
          <TouchableOpacity>
            <Text className="text-purple-400 text-sm">+ Add Token</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingBalances}
              onRefresh={handleRefresh}
              tintColor="#a855f7"
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {balances.length === 0 ? (
            <View className="items-center py-12">
              <Ionicons name="wallet-outline" size={48} color="#4b5563" />
              <Text className="text-gray-500 mt-4">No tokens yet</Text>
              <Text className="text-gray-600 text-sm mt-1">
                Pull down to refresh
              </Text>
            </View>
          ) : (
            balances.map((item, index) => (
              <TokenRow
                key={`${item.token.symbol}-${index}`}
                symbol={item.token.symbol}
                name={item.token.name}
                balance={item.balance || '0'}
                isLoading={item.isLoading}
              />
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function QuickActionButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className={`items-center ${disabled ? 'opacity-40' : ''}`}
    >
      <View className="w-14 h-14 rounded-full bg-purple-600 items-center justify-center mb-2">
        <Ionicons name={icon} size={24} color="white" />
      </View>
      <Text className="text-gray-300 text-xs">{label}</Text>
    </TouchableOpacity>
  );
}

function TokenRow({
  symbol,
  name,
  balance,
  isLoading,
}: {
  symbol: string;
  name: string;
  balance: string;
  isLoading: boolean;
}) {
  return (
    <View className="flex-row items-center py-4 border-b border-gray-800">
      {/* Token Icon */}
      <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3">
        <Text className="text-white font-bold">{symbol.charAt(0)}</Text>
      </View>

      {/* Token Info */}
      <View className="flex-1">
        <Text className="text-white font-medium">{name}</Text>
        <Text className="text-gray-500 text-sm">{symbol}</Text>
      </View>

      {/* Balance */}
      <View className="items-end">
        {isLoading ? (
          <View className="bg-gray-800 h-5 w-16 rounded" />
        ) : (
          <>
            <Text className="text-white font-medium">
              {parseFloat(balance).toFixed(4)}
            </Text>
            <Text className="text-gray-500 text-sm">${(0).toFixed(2)}</Text>
          </>
        )}
      </View>
    </View>
  );
}
