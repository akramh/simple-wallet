/**
 * @fileoverview Token detail screen - shows comprehensive token information.
 *
 * Displays token price, chart, actions, metadata, and recent activity.
 * This is a full-screen push navigation from wallet or portfolio views.
 *
 * @responsibilities
 * - Display current token price and price changes
 * - Show interactive price chart with time range selection
 * - Provide quick actions (Send, Receive, More)
 * - Display token metadata (market cap, supply, etc.)
 * - Show recent token-specific transaction activity
 *
 * @security
 * - Does not handle sensitive data directly
 * - Navigates to existing Send/Receive flows for transactions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import { useToast } from '../contexts';
import { useClipboard, usePriceHistory } from '../hooks';
import { getTokenIcon } from '../utils/tokenIcons';
import { TransactionItem, PriceChart } from '../components';
import { formatLargeNumber, formatSupply, type TimeRange, type PricePoint } from '../services';
import { safeGoBack } from '../utils/navigation';

// ============================================================================
// Types
// ============================================================================

interface TokenDetailParams {
  symbol: string;
  name: string;
  network: string;
  balance: string;
  contractAddress?: string;
  isNative: string; // 'true' | 'false' - passed as string via params
  iconUrl?: string;
  decimals?: string;
}

// ============================================================================
// Main Screen
// ============================================================================

export default function TokenDetailScreen() {
  const router = useRouter();
  const isNavigatingRef = useRef(false);
  const params = useLocalSearchParams() as unknown as TokenDetailParams;
  const { showToast } = useToast();
  const { copy, isCopied } = useClipboard();

  // Parse params
  const symbol = params.symbol || 'TOKEN';
  const name = params.name || 'Unknown Token';
  const network = params.network || '';
  const balance = params.balance || '0';
  const contractAddress = params.contractAddress;
  const isNative = params.isNative === 'true';
  const decimals = params.decimals ? parseInt(params.decimals) : 18;

  // Store state
  const prices = useWalletStore((state) => state.prices);
  const networks = useWalletStore((state) => state.networks);
  const transactions = useWalletStore((state) => state.transactions);
  const isLoadingTransactions = useWalletStore((state) => state.isLoadingTransactions);
  const loadTransactions = useWalletStore((state) => state.loadTransactions);

  // Price history hook
  const {
    history,
    metadata,
    isLoadingHistory,
    isLoadingMetadata,
    selectedRange,
    setTimeRange,
    fetchHistory,
    fetchMetadata,
  } = usePriceHistory(symbol, '1D', true);

  // Local state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [touchedPrice, setTouchedPrice] = useState<PricePoint | null>(null);

  // Derived values
  const currentPrice = prices[symbol] ?? null;
  const balanceNum = parseFloat(balance);
  const holdingsValue = currentPrice !== null ? balanceNum * currentPrice : null;
  const networkConfig = networks[network];
  const tokenIcon = getTokenIcon(symbol);

  // Filter transactions for this token
  const tokenTransactions = useMemo(() => {
    if (!transactions) return [];

    return transactions
      .filter((tx) => {
        // For native tokens, show all native transactions on this network
        if (isNative) {
          return tx.tokenSymbol === symbol || (!tx.tokenSymbol && tx.network === network);
        }
        // For ERC-20s, match by contract address
        if (contractAddress) {
          return tx.tokenAddress?.toLowerCase() === contractAddress.toLowerCase();
        }
        // Fallback to symbol match
        return tx.tokenSymbol === symbol;
      })
      .slice(0, 5); // Show max 5 recent transactions
  }, [transactions, symbol, isNative, contractAddress, network]);

  // Load transactions on mount
  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      loadTransactions(),
      fetchHistory(selectedRange, true),
      fetchMetadata(true),
    ]);
    setIsRefreshing(false);
  }, [loadTransactions, fetchHistory, fetchMetadata, selectedRange]);

  // Handle time range change
  const handleRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, [setTimeRange]);

  // Navigation handlers
  const handleBack = () => safeGoBack(router);

  const handleSend = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    router.push({
      pathname: '/send',
      params: {
        preselectedToken: symbol,
        preselectedNetwork: network,
      },
    });
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  const handleReceive = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    router.push({
      pathname: '/receive',
      params: {
        network,
      },
    });
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  const handleMore = () => {
    // TODO: Open bottom sheet with more actions
    showToast('More actions coming soon', 'info');
  };

  const handleBuy = () => {
    showToast('Buy feature coming soon', 'info');
  };

  const handleSell = () => {
    showToast('Sell feature coming soon', 'info');
  };

  const handleCopyAddress = async () => {
    if (contractAddress) {
      await copy(contractAddress);
    }
  };

  const contractCopied = contractAddress ? isCopied(contractAddress) : false;

  const handleViewAllActivity = () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    router.push('/(tabs)/activity');
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 600);
  };

  // Format price change display
  const formatPriceChange = (change: { value: number; percent: number }) => {
    const sign = change.value >= 0 ? '+' : '';
    return {
      valueText: `${sign}$${Math.abs(change.value).toFixed(2)}`,
      percentText: `(${sign}${change.percent.toFixed(2)}%)`,
      isPositive: change.value >= 0,
    };
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-gray-800">
        <TouchableOpacity onPress={handleBack} className="p-2 -ml-2">
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center justify-center">
          <View className="w-6 h-6 rounded-full bg-gray-800 items-center justify-center mr-2 overflow-hidden">
            {tokenIcon ? (
              <Image
                source={tokenIcon}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Text className="text-white text-xs font-bold">{symbol.charAt(0)}</Text>
            )}
          </View>
          <Text className="text-white text-lg font-semibold">{name}</Text>
        </View>

        <View className="w-10" />
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#a855f7"
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Price Section */}
        <View className="px-4 pt-6 pb-4">
          {/* Show touched price when interacting with chart, otherwise show current price */}
          <Text className="text-white text-4xl font-bold">
            {touchedPrice
              ? `$${touchedPrice.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : currentPrice !== null
                ? `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '--'}
          </Text>

          {touchedPrice ? (
            <View className="flex-row items-center mt-1">
              <Text className="text-gray-400 text-sm">
                {new Date(touchedPrice.timestamp).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          ) : history?.priceChange ? (
            <View className="flex-row items-center mt-1">
              <Ionicons
                name={history.priceChange.percent >= 0 ? 'trending-up' : 'trending-down'}
                size={16}
                color={history.priceChange.percent >= 0 ? '#22c55e' : '#ef4444'}
                style={{ marginRight: 4 }}
              />
              <Text className={history.priceChange.percent >= 0 ? 'text-green-500' : 'text-red-500'}>
                {formatPriceChange(history.priceChange).valueText} {formatPriceChange(history.priceChange).percentText}
              </Text>
              <Text className="text-gray-500 ml-2">{selectedRange}</Text>
            </View>
          ) : isLoadingHistory ? (
            <View className="flex-row items-center mt-1">
              <ActivityIndicator size="small" color="#a855f7" />
              <Text className="text-gray-500 ml-2">Loading...</Text>
            </View>
          ) : (
            <Text className="text-gray-500 mt-1">Price change unavailable</Text>
          )}
        </View>

        {/* Price Chart */}
        <View className="mx-4 mb-4">
          <PriceChart
            data={history?.data ?? []}
            isPositive={(history?.priceChange?.percent ?? 0) >= 0}
            isLoading={isLoadingHistory}
            height={180}
            showTouch={true}
            onTouchPoint={setTouchedPrice}
          />
        </View>

        {/* Time Range Selector */}
        <TimeRangeSelector
          selected={selectedRange}
          onSelect={handleRangeChange}
        />

        {/* Action Buttons */}
        <View className="flex-row justify-center gap-4 mx-4 my-6">
          <ActionButton icon="arrow-up" label="Send" onPress={handleSend} />
          <ActionButton icon="arrow-down" label="Receive" onPress={handleReceive} />
          <ActionButton icon="ellipsis-horizontal" label="More" onPress={handleMore} />
        </View>

        {/* Holdings Card */}
        <View className="mx-4 bg-gray-900 rounded-xl p-4 mb-6">
          <Text className="text-gray-400 text-sm mb-1">Your Holdings</Text>
          <Text className="text-white text-2xl font-bold">
            {balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {symbol}
          </Text>
          <Text className="text-gray-500">
            {holdingsValue !== null ? `$${holdingsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          </Text>
        </View>

        {/* Token Info Card */}
        <View className="mx-4 mb-6">
          <Text className="text-white text-lg font-semibold mb-3">Token Information</Text>
          <View className="bg-gray-900 rounded-xl p-4">
            <InfoRow label="Name" value={name} />
            <InfoRow label="Symbol" value={symbol} />
            <InfoRow label="Network" value={networkConfig?.name || network} />
            {!isNative && contractAddress && (
              <InfoRow
                label="Contract"
                value={`${contractAddress.slice(0, 8)}...${contractAddress.slice(-6)}`}
                onPress={handleCopyAddress}
                showCopy
                copied={contractCopied}
              />
            )}
            <InfoRow label="Type" value={isNative ? 'Native' : 'Token'} isLast />
          </View>
        </View>

        {/* Market Data Card */}
        <View className="mx-4 mb-6">
          <Text className="text-white text-lg font-semibold mb-3">Market Data</Text>
          <View className="bg-gray-900 rounded-xl p-4">
            {isLoadingMetadata ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#a855f7" />
              </View>
            ) : (
              <>
                <InfoRow
                  label="Market Cap"
                  value={formatLargeNumber(metadata?.marketCap ?? null)}
                />
                <InfoRow
                  label="Circulating Supply"
                  value={formatSupply(metadata?.circulatingSupply ?? null, symbol)}
                />
                <InfoRow
                  label="Total Supply"
                  value={formatSupply(metadata?.totalSupply ?? null, symbol)}
                  isLast
                />
              </>
            )}
          </View>
          {metadata?.websiteUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(metadata.websiteUrl!)}
              className="mt-3 flex-row items-center justify-center"
            >
              <Ionicons name="globe-outline" size={16} color="#a855f7" />
              <Text className="text-purple-400 text-sm ml-2">Visit Website</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Activity Section */}
        <View className="mx-4 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white text-lg font-semibold">Recent Activity</Text>
            {tokenTransactions.length > 0 && (
              <TouchableOpacity onPress={handleViewAllActivity}>
                <Text className="text-purple-400 text-sm">View All</Text>
              </TouchableOpacity>
            )}
          </View>

          <View className="bg-gray-900 rounded-xl overflow-hidden">
            {isLoadingTransactions ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="small" color="#a855f7" />
              </View>
            ) : tokenTransactions.length > 0 ? (
              tokenTransactions.map((tx, index) => {
                // Determine the counterparty address
                const isSend = tx.type === 'send';
                const counterpartyAddress = isSend ? tx.to : tx.from;
                // Map contract_interaction to contract for TransactionItem
                const txType = tx.type === 'contract_interaction' ? 'contract' : tx.type;

                return (
                  <TransactionItem
                    key={tx.hash || index}
                    type={txType as 'send' | 'receive' | 'swap' | 'contract' | 'approval'}
                    status={tx.status}
                    amount={tx.value || '0'}
                    symbol={tx.tokenSymbol || symbol}
                    address={counterpartyAddress || '0x0000000000000000000000000000000000000000'}
                    timestamp={tx.timestamp}
                    hash={tx.hash}
                    onPress={() => {
                      // Could open transaction details modal
                    }}
                  />
                );
              })
            ) : (
              <View className="py-8 items-center">
                <Ionicons name="time-outline" size={32} color="#4b5563" />
                <Text className="text-gray-500 mt-2">No recent activity</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Fixed Bottom Buttons */}
      <View className="absolute bottom-0 left-0 right-0 bg-gray-950 border-t border-gray-800 px-4 py-4 pb-8">
        <View className="flex-row gap-4">
          <TouchableOpacity
            onPress={handleBuy}
            className="flex-1 bg-purple-600 rounded-xl py-4 items-center"
          >
            <Text className="text-white font-semibold text-lg">Buy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSell}
            className="flex-1 bg-gray-800 rounded-xl py-4 items-center"
          >
            <Text className="text-white font-semibold text-lg">Sell</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function TimeRangeSelector({
  selected,
  onSelect,
}: {
  selected: TimeRange;
  onSelect: (range: TimeRange) => void;
}) {
  const ranges: TimeRange[] = ['1H', '1D', '1W', '1M', 'YTD', 'ALL'];

  return (
    <View className="flex-row justify-around mx-4">
      {ranges.map((range) => (
        <TouchableOpacity
          key={range}
          onPress={() => onSelect(range)}
          className={`px-3 py-2 rounded-lg ${
            selected === range ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          <Text
            className={`text-sm font-medium ${
              selected === range ? 'text-white' : 'text-gray-400'
            }`}
          >
            {range}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ActionButton({
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

function InfoRow({
  label,
  value,
  onPress,
  showCopy,
  copied,
  isLast,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  showCopy?: boolean;
  copied?: boolean;
  isLast?: boolean;
}) {
  const content = (
    <View className={`flex-row justify-between py-3 ${!isLast ? 'border-b border-gray-800' : ''}`}>
      <Text className="text-gray-400 text-sm">{label}</Text>
      <View className="flex-row items-center">
        <Text className="text-white text-sm font-medium">{value}</Text>
        {showCopy && (
          <Ionicons
            name={copied ? 'checkmark-circle' : 'copy-outline'}
            size={14}
            color={copied ? '#a855f7' : '#9ca3af'}
            style={{ marginLeft: 8 }}
          />
        )}
      </View>
    </View>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>;
  }

  return content;
}
