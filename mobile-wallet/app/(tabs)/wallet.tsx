/**
 * @fileoverview Main wallet screen - shows balances and quick actions.
 */

import { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletScreenSelector } from '../../store';
import { useClipboard } from '../../hooks';
import { useToast } from '../../contexts';
import { getTokenIcon } from '../../utils/tokenIcons';
import { RefreshPill } from '../../components';

export default function WalletScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    address,
    network,
    networks,
    balances,
    isRefreshingBalances,
    balancesLastUpdated,
    formattedTotal,
    refreshBalances,
    prices,
    accounts,
    currentAccountIndex,
    currentWalletName,
  } = useWalletScreenSelector();
  const { copy } = useClipboard();
  const { showToast } = useToast();

  // Refresh balances on mount
  useEffect(() => {
    // Avoid spamming refreshes when we already have recent cached data.
    if (!balancesLastUpdated || Date.now() - balancesLastUpdated > 30_000) {
      refreshBalances();
    }
  }, [balancesLastUpdated, refreshBalances]);

  const handleRefresh = useCallback(() => {
    refreshBalances();
  }, [refreshBalances]);

  const handleCopyAddress = async () => {
    if (!address) return;
    const success = await copy(address);
    if (success) {
      showToast('Address copied to clipboard', 'success');
    }
  };

  const networkConfig = networks[network];
  const truncatedAddress = address
    ? `${address.slice(0, 8)}...${address.slice(-6)}`
    : '';
  const hasMultipleAccounts = accounts.length > 1;

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <RefreshPill isRefreshing={isRefreshingBalances} label="Refreshing balances..." />


      <FlatList
        data={balances.filter(b => b.isVisible !== false)}
        keyExtractor={(item, index) => `${item.token.symbol}-${index}`}
        renderItem={({ item }) => {
          const price = prices[item.token.symbol] ?? null;
          const balance = parseFloat(item.balance || '0');
          const usdValue = price !== null ? balance * price : null;
          const isNative = item.token.address === 'native' || !item.token.address;

          const handleTokenPress = () => {
            router.push({
              pathname: '/token-detail',
              params: {
                symbol: item.token.symbol,
                name: item.token.name,
                network: network,
                balance: item.balance || '0',
                contractAddress: isNative ? undefined : item.token.address,
                isNative: isNative ? 'true' : 'false',
                decimals: item.token.decimals?.toString() || '18',
              },
            });
          };

          return (
            <View className="px-5 bg-gray-900/50">
              <TokenRow
                symbol={item.token.symbol}
                name={item.token.name}
                balance={item.balance || '0'}
                usdValue={usdValue}
                isLoading={item.isLoading}
                onPress={handleTokenPress}
              />
            </View>
          );
        }}
        ListHeaderComponent={() => (
          <>
            {/* Header */}
            <View className="px-5 pt-4 pb-6">
              {/* Network & Account Selectors */}
              <View className="flex-row items-center mb-4">
                <Pressable
                  onPress={() => router.push('/network-select')}
                  className="flex-row items-center bg-gray-900 px-3 py-2 rounded-full mr-2"
                >
                  <View className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />
                  <Text className="text-gray-300 text-sm">{networkConfig?.name || network}</Text>
                  <Ionicons name="chevron-down" size={16} color="#9ca3af" className="ml-1" />
                </Pressable>
                
                {hasMultipleAccounts && (
                  <Pressable
                    onPress={() => router.push('/account-manage')}
                    className="flex-row items-center bg-gray-900 px-3 py-2 rounded-full"
                  >
                    <Ionicons name="person" size={12} color="#9ca3af" />
                    <Text className="text-gray-300 text-sm ml-1">#{currentAccountIndex + 1}</Text>
                    <Ionicons name="chevron-down" size={16} color="#9ca3af" className="ml-1" />
                  </Pressable>
                )}
              </View>

              {/* Total Balance */}
              <Text className="text-gray-400 text-sm mb-1">Total Balance</Text>
              <Text className="text-white text-4xl font-bold mb-1">{formattedTotal}</Text>
              
              <View className="flex-row items-center justify-between">
                <Pressable className="flex-row items-center" onPress={handleCopyAddress}>
                  <Text className="text-white font-medium">{currentWalletName || 'Wallet'}</Text>
                  <Text className="text-gray-500 mx-2">·</Text>
                  <Text className="text-gray-400 text-sm">{truncatedAddress}</Text>
                  <Ionicons name="copy-outline" size={14} color="#9ca3af" style={{ marginLeft: 8 }} />
                </Pressable>
                
                {balancesLastUpdated && (
                  <Text className="text-gray-600 text-xs">
                    Updated {new Date(balancesLastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
            </View>

            {/* Quick Actions */}
            <View className="flex-row justify-center gap-6 px-5 mb-6">
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

            {/* Token List Title & Manage Button */}
            <View className="bg-gray-900/50 rounded-t-3xl px-5 pt-5 pb-2 flex-row justify-between items-center">
              <Text className="text-white text-lg font-semibold">Tokens</Text>
              <TouchableOpacity onPress={() => router.push('/manage-tokens')}>
                <Text className="text-purple-400 text-sm font-medium">Manage</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        ListEmptyComponent={
          <View className="items-center py-12 bg-gray-900/50 h-full">
            <Ionicons name="wallet-outline" size={48} color="#4b5563" />
            <Text className="text-gray-500 mt-4">No tokens yet</Text>
            <Text className="text-gray-600 text-sm mt-1">
              Pull down to refresh
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshingBalances}
            onRefresh={handleRefresh}
            tintColor="#a855f7"
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      />
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
      <View className="w-16 h-16 rounded-full bg-purple-600 items-center justify-center mb-3">
        <Ionicons name={icon} size={26} color="white" />
      </View>
      <Text className="text-gray-300 text-sm">{label}</Text>
    </TouchableOpacity>
  );
}

function TokenRow({
  symbol,
  name,
  balance,
  usdValue,
  isLoading,
  onPress,
}: {
  symbol: string;
  name: string;
  balance: string;
  usdValue: number | null;
  isLoading: boolean;
  onPress: () => void;
}) {
  const tokenIcon = getTokenIcon(symbol);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center py-4 border-b border-gray-800"
    >
      {/* Token Icon */}
      <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
        {tokenIcon ? (
          <Image
            source={tokenIcon}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Text className="text-white font-bold">{symbol.charAt(0)}</Text>
        )}
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
            <Text className="text-gray-500 text-sm">
              {usdValue !== null ? `$${usdValue.toFixed(2)}` : '--'}
            </Text>
          </>
        )}
      </View>

      {/* Chevron indicator */}
      <Ionicons name="chevron-forward" size={16} color="#6b7280" style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}
