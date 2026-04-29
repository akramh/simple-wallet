/**
 * @fileoverview Main wallet screen - shows balances and quick actions.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletScreenSelector } from '../../store';
import { useClipboard } from '../../hooks';
import { getTokenIcon } from '../../utils/tokenIcons';
import { Skeleton } from '../../components';
import type { TokenBalance } from '../../services';

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
    refreshBalancesAndPrices,
    prices,
    isLoadingPrices,
    accounts,
    currentAccountIndex,
    currentWalletName,
  } = useWalletScreenSelector();
  const isNavigatingRef = useRef(false);
  const { copy, isCopied } = useClipboard();

  // Refresh balances every time the tab gains focus (silent — no spinner for
  // automatic refresh; gated by a 30s freshness threshold so re-visits don't
  // double-fetch). Deferred via InteractionManager so the RPC fan-out doesn't
  // block the tab transition's JS work and drop frames.
  useFocusEffect(
    useCallback(() => {
      const handle = InteractionManager.runAfterInteractions(() => {
        if (!balancesLastUpdated || Date.now() - balancesLastUpdated > 30_000) {
          refreshBalancesAndPrices({ silent: true });
        }
      });
      return () => handle.cancel();
    }, [balancesLastUpdated, refreshBalancesAndPrices]),
  );

  // Pull-to-refresh handler - shows loading indicator (user-initiated)
  const handleRefresh = useCallback(() => {
    refreshBalancesAndPrices({ silent: false, force: true });
  }, [refreshBalancesAndPrices]);

  const navigateOnce = useCallback(
    (action: () => void) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      action();
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 600);
    },
    []
  );

  const handleCopyAddress = async () => {
    if (!address) return;
    await copy(address);
  };

  const networkConfig = networks[network];
  const truncatedAddress = address
    ? `${address.slice(0, 8)}...${address.slice(-6)}`
    : '';
  const addressCopied = address ? isCopied(address) : false;
  const hasMultipleAccounts = accounts.length > 1;

  // Memoize the visible-tokens slice — recomputed only when balances change.
  const visibleBalances = useMemo(
    () => balances.filter((b) => b.isVisible !== false),
    [balances],
  );

  // Stable per-row tap handler. Calling pattern is `handleTokenPress(item)` —
  // identity stays the same across renders so a memoized TokenRow can skip
  // re-rendering when its data hasn't changed.
  const handleTokenPress = useCallback(
    (item: typeof balances[number]) => {
      const isNative = item.token.address === 'native' || !item.token.address;
      navigateOnce(() => {
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
      });
    },
    [router, navigateOnce, network],
  );

  const renderItem = useCallback(
    ({ item }: { item: typeof balances[number] }) => {
      const price = prices[item.token.symbol] ?? null;
      const balance = parseFloat(item.balance || '0');
      const usdValue = price !== null ? balance * price : null;
      return (
        <View className="px-5 bg-gray-900/50">
          <TokenRow
            symbol={item.token.symbol}
            name={item.token.name}
            balance={item.balance || '0'}
            usdValue={usdValue}
            isLoading={item.isLoading}
            item={item}
            onPress={handleTokenPress}
          />
        </View>
      );
    },
    [prices, handleTokenPress],
  );

  const keyExtractor = useCallback(
    (item: typeof balances[number], index: number) => `${item.token.symbol}-${index}`,
    [],
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <FlatList
        data={visibleBalances}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        removeClippedSubviews
        initialNumToRender={8}
        windowSize={5}
        ListHeaderComponent={() => (
          <>
            {/* Header */}
            <View className="px-5 pt-4 pb-6">
              {/* Network & Account Selectors */}
              <View className="flex-row items-center mb-4">
                <Pressable
                  onPress={() => navigateOnce(() => router.push('/network-select'))}
                  className="flex-row items-center bg-gray-900 px-3 py-2 rounded-full mr-2"
                >
                  <View className="w-2.5 h-2.5 rounded-full bg-green-500 mr-2" />
                  <Text className="text-gray-300 text-sm">{networkConfig?.name || network}</Text>
                  <Ionicons name="chevron-down" size={16} color="#9ca3af" className="ml-1" />
                </Pressable>
                
                {hasMultipleAccounts && (
                  <Pressable
                    onPress={() => navigateOnce(() => router.push('/account-manage'))}
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
                  <Ionicons
                    name={addressCopied ? 'checkmark-circle' : 'copy-outline'}
                    size={14}
                    color={addressCopied ? '#a855f7' : '#9ca3af'}
                    style={{ marginLeft: 8 }}
                  />
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
                onPress={() => navigateOnce(() => router.push('/send'))}
              />
              <QuickActionButton
                icon="arrow-down"
                label="Receive"
                onPress={() => navigateOnce(() => router.push('/receive'))}
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
              <TouchableOpacity onPress={() => navigateOnce(() => router.push('/manage-tokens'))}>
                <Text className="text-purple-400 text-sm font-medium">Manage</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        ListEmptyComponent={
          isRefreshingBalances || isLoadingPrices ? (
            // Cold cache + refreshing: show skeleton rows so the screen has
            // something living while the RPC fan-out resolves. Replaces the
            // "No tokens yet" copy that misleadingly fired during the first
            // few seconds of every cold start.
            <View className="px-5 bg-gray-900/50">
              {Array.from({ length: 4 }).map((_, i) => (
                <View
                  key={`skeleton-${i}`}
                  className="flex-row items-center py-4 border-b border-gray-800"
                >
                  <Skeleton width={40} height={40} borderRadius={20} style={{ marginRight: 12 }} />
                  <View className="flex-1">
                    <Skeleton width={120} height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width={60} height={12} />
                  </View>
                  <View className="items-end">
                    <Skeleton width={70} height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width={50} height={12} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center py-12 bg-gray-900/50 h-full">
              <Ionicons name="wallet-outline" size={48} color="#4b5563" />
              <Text className="text-gray-500 mt-4">No tokens yet</Text>
              <Text className="text-gray-600 text-sm mt-1">
                Pull down to refresh
              </Text>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshingBalances || isLoadingPrices}
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

interface TokenRowProps {
  symbol: string;
  name: string;
  balance: string;
  usdValue: number | null;
  isLoading: boolean;
  item: TokenBalance;
  onPress: (item: TokenBalance) => void;
}

// Memoized to skip rendering when none of this token's props changed.
// `onPress` takes the row's `item` so the parent can keep a single stable
// callback rather than producing a fresh closure per row each render.
const TokenRow = memo(function TokenRow({
  symbol,
  name,
  balance,
  usdValue,
  isLoading,
  item,
  onPress,
}: TokenRowProps) {
  const tokenIcon = getTokenIcon(symbol);
  const handlePress = useCallback(() => onPress(item), [onPress, item]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      className="flex-row items-center py-4 border-b border-gray-800"
    >
      {/* Token Icon */}
      <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
        {tokenIcon ? (
          <Image
            source={tokenIcon}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
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
});
