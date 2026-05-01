/**
 * @fileoverview Portfolio screen - shows holdings and performance.
 *
 * Implements “stale-while-revalidate” behavior:
 * - Render cached holdings immediately when available
 * - Refresh in the background when data is stale
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePortfolioScreenSelector } from '../../store';
import { getTokenIcon } from '../../utils/tokenIcons';
import { Skeleton } from '../../components';

type HoldingItem = {
  networkKey: string;
  token: { symbol: string; name: string; address?: string; decimals?: number };
  balance?: string;
  value?: number;
};

type Section = {
  title: string;
  networkKey: string;
  subtotal: number;
  data: HoldingItem[];
};

export default function PortfolioScreen() {
  const router = useRouter();
  const {
    formattedTotal,
    totalValue,
    allNetworkHoldings,
    allNetworkTotals,
    allNetworksLastUpdated,
    isRefreshingAllNetworks,
    refreshAllNetworks,
    hydrateAllNetworksFromCache,
    networks,
  } = usePortfolioScreenSelector();
  const isNavigatingRef = useRef(false);

  // Two-phase render to keep the first paint cheap. On Expo Go the SectionList
  // render takes ~3s because expo-image has no native cache and HoldingRow
  // uses several Views/Ionicons per row. Painting the header + skeleton on
  // the first frame and deferring the SectionList mount by one tick lets the
  // user see SOMETHING immediately. `showHeavy` is reset on every focus so
  // the skeleton flashes briefly on each tab visit (cheap, gives perceived
  // responsiveness even when the actual list mount is slow).
  const [showHeavy, setShowHeavy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setShowHeavy(false);

      // Double-rAF: first fires after the skeleton has committed; the second
      // (scheduled inside the first) fires on the next frame and flips
      // showHeavy=true. Without this, setShowHeavy would batch into the
      // focus tick and the heavy SectionList render would block the first
      // paint by ~3 seconds on Expo Go.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShowHeavy(true));
      });

      // Hydrate from cache so cached data is on screen by the first paint.
      const handle = InteractionManager.runAfterInteractions(() => {
        hydrateAllNetworksFromCache();
      });

      // Defer the silent refresh well past first paint. Kicking off
      // refreshAllNetworks in the same tick as focus delays the animation
      // frame by 3+ seconds on Expo Go because the async chain (alchemy
      // fetch + per-chain fallbacks + dynamic import) starves the rAF
      // callback. By the time this fires the page is fully visible and
      // the user is already interacting with cached data.
      const refreshTimer = setTimeout(() => {
        const cachedAt = allNetworksLastUpdated;
        if (!cachedAt || Date.now() - cachedAt > 30_000) {
          refreshAllNetworks({ silent: true });
        }
      }, 800);

      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
        clearTimeout(refreshTimer);
        handle.cancel();
      };
    }, [hydrateAllNetworksFromCache, refreshAllNetworks, allNetworksLastUpdated]),
  );

  // Pull-to-refresh handler - explicitly not silent so RefreshControl shows indicator
  const handleRefresh = useCallback(() => {
    refreshAllNetworks({ silent: false });
  }, [refreshAllNetworks]);

  const globalTotal = useMemo(
    () =>
      Object.entries(allNetworkTotals).reduce((acc, [key, value]) => {
        const isTestnet = networks[key]?.isTestnet;
        return isTestnet ? acc : acc + (value || 0);
      }, 0),
    [allNetworkTotals, networks],
  );
  const formattedGlobalTotal = globalTotal > 0 ? `$${globalTotal.toFixed(2)}` : formattedTotal;

  // Group flat holdings into network sections. Filters out zero-balance rows
  // up front so the renderer never sees them. Empty until showHeavy flips
  // so the first frame commits with just the skeleton.
  const sections = useMemo<Section[]>(() => {
    if (!showHeavy) return [];
    const byNetwork = new Map<string, HoldingItem[]>();
    for (const h of allNetworkHoldings as HoldingItem[]) {
      const val = parseFloat(h.balance || '0');
      if (!Number.isFinite(val) || val <= 0) continue;
      const arr = byNetwork.get(h.networkKey) ?? [];
      arr.push(h);
      byNetwork.set(h.networkKey, arr);
    }
    return Object.keys(networks)
      .filter((key) => byNetwork.has(key))
      .map((networkKey) => ({
        title: networks[networkKey]?.name || networkKey,
        networkKey,
        subtotal: allNetworkTotals[networkKey] || 0,
        data: byNetwork.get(networkKey) || [],
      }));
  }, [showHeavy, allNetworkHoldings, allNetworkTotals, networks]);

  const handlePressItem = useCallback(
    (item: HoldingItem) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      const isNative = item.token.address === 'native' || !item.token.address;
      router.push({
        pathname: '/token-detail',
        params: {
          symbol: item.token.symbol,
          name: item.token.name,
          network: item.networkKey,
          balance: item.balance || '0',
          contractAddress: isNative ? undefined : item.token.address,
          isNative: isNative ? 'true' : 'false',
          decimals: item.token.decimals?.toString() || '18',
        },
      });
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 600);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: HoldingItem; section: Section }) => {
      const itemValue = item.value || 0;
      const networkTotal = section.subtotal || totalValue;
      const percentage = networkTotal > 0 ? (itemValue / networkTotal) * 100 : 0;
      return (
        <HoldingRow
          symbol={item.token.symbol}
          name={item.token.name}
          balance={item.balance || '0'}
          value={itemValue}
          percentage={percentage}
          change24h={0}
          onPress={() => handlePressItem(item)}
        />
      );
    },
    [handlePressItem, totalValue],
  );

  const keyExtractor = useCallback(
    (item: HoldingItem, index: number) => `${item.networkKey}-${item.token.symbol}-${index}`,
    [],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View className="px-5 mb-2 mt-2 bg-gray-950">
        <Text className="text-white text-md font-semibold">{section.title}</Text>
      </View>
    ),
    [],
  );

  const ListHeader = useMemo(
    () => (
      <View>
        <View className="px-5 pt-4 pb-6">
          <Text className="text-white text-2xl font-bold">Portfolio</Text>
          <Text className="text-gray-400 mt-1">Your asset allocation</Text>
        </View>
        <View className="mx-5 bg-linear-to-br from-purple-600 to-blue-600 rounded-2xl p-6 mb-6">
          <Text className="text-white/70 text-sm">Total Value (All Networks)</Text>
          <Text className="text-white text-4xl font-bold mt-2">{formattedGlobalTotal}</Text>
          <View className="flex-row items-center mt-3">
            <Ionicons name="trending-up" size={16} color="#86efac" />
            <Text className="text-green-300 ml-1">+0.00%</Text>
            <Text className="text-white/50 ml-2">24h</Text>
          </View>
          <View className="flex-row items-center mt-2 justify-between">
            <Text className="text-white/60 text-xs">
              {allNetworksLastUpdated
                ? `Updated ${new Date(allNetworksLastUpdated).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Pull down to refresh'}
            </Text>
          </View>
        </View>
        <View className="px-5">
          <Text className="text-white text-lg font-semibold mb-2">Holdings</Text>
        </View>
      </View>
    ),
    [formattedGlobalTotal, allNetworksLastUpdated],
  );

  // Skeleton conditions: heavy list still deferred (first frame after focus),
  // cold cache, OR explicit refresh in flight. ListEmptyComponent only renders
  // when sections is empty, which happens for all of these.
  const showSkeleton =
    sections.length === 0 &&
    (!showHeavy || isRefreshingAllNetworks || allNetworksLastUpdated === null);

  const ListEmpty = useMemo(() => {
    if (showSkeleton) {
      return (
        <View className="px-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={`portfolio-skel-${i}`} className="mb-4">
              <Skeleton width={120} height={14} style={{ marginBottom: 8 }} />
              {Array.from({ length: 2 }).map((__, j) => (
                <View
                  key={`portfolio-skel-${i}-${j}`}
                  className="flex-row items-center py-3 border-b border-gray-800"
                >
                  <Skeleton
                    width={40}
                    height={40}
                    borderRadius={20}
                    style={{ marginRight: 12 }}
                  />
                  <View className="flex-1">
                    <Skeleton width={140} height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width={60} height={12} />
                  </View>
                  <Skeleton width={70} height={14} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View className="items-center py-12">
        <Ionicons name="pie-chart-outline" size={48} color="#4b5563" />
        <Text className="text-gray-500 mt-4">No holdings yet</Text>
        <Text className="text-gray-600 text-sm mt-1 text-center px-8">
          Your portfolio breakdown will appear here once you have tokens.
        </Text>
      </View>
    );
  }, [showSkeleton]);

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshingAllNetworks}
            onRefresh={handleRefresh}
            tintColor="#a855f7"
          />
        }
      />
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

type HoldingRowProps = {
  symbol: string;
  name: string;
  balance: string;
  value: number;
  percentage: number;
  change24h: number;
  onPress: () => void;
};

const HoldingRow = memo(
  function HoldingRow({ symbol, name, balance, value, change24h, onPress }: HoldingRowProps) {
    const isPositive = change24h >= 0;
    const icon = getTokenIcon(symbol);

    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        className="flex-row items-center py-4 border-b border-gray-800 px-5"
      >
        <View className="w-12 h-12 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
          {icon ? (
            <Image
              source={icon}
              style={{ width: 40, height: 40 }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text className="text-white font-bold text-lg">{symbol.charAt(0)}</Text>
          )}
        </View>

        <View className="flex-1">
          <Text className="text-white font-medium">{name}</Text>
          <Text className="text-gray-500 text-sm">
            {parseFloat(balance).toFixed(4)} {symbol}
          </Text>
        </View>

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

        <Ionicons name="chevron-forward" size={16} color="#6b7280" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
    );
  },
  (prev, next) =>
    prev.symbol === next.symbol &&
    prev.name === next.name &&
    prev.balance === next.balance &&
    prev.value === next.value &&
    prev.percentage === next.percentage &&
    prev.change24h === next.change24h,
);
