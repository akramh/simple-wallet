/**
 * @fileoverview Manage Tokens screen - toggle visibility and add custom tokens.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Switch,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useWalletStore } from '../store';
import { getTokenIcon } from '../utils/tokenIcons';
import { safeGoBack } from '../utils/navigation';
import type { TokenBalance } from '../services';

interface TokenRowProps {
  item: TokenBalance;
  onToggle: (address: string, value: boolean) => void;
}

// Memoized row: only re-renders when this specific token's `isVisible` (or
// identity) changes, not on every search keystroke or store tick.
const TokenRow = memo(function TokenRow({ item, onToggle }: TokenRowProps) {
  const icon = getTokenIcon(item.token.symbol);
  const isNative = item.token.type === 'native';
  const isVisible = item.isVisible !== false;
  const handleToggle = useCallback(
    (val: boolean) => onToggle(item.token.address!, val),
    [onToggle, item.token.address],
  );

  return (
    <View className="flex-row items-center py-4 border-b border-gray-800">
      <View className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center mr-3 overflow-hidden">
        {icon ? (
          <Image source={icon} className="w-full h-full" resizeMode="cover" />
        ) : (
          <Text className="text-white font-bold">{item.token.symbol.charAt(0)}</Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-white font-medium">{item.token.name}</Text>
        <Text className="text-gray-500 text-sm">{item.token.symbol}</Text>
      </View>
      {!isNative && (
        <Switch
          value={isVisible}
          onValueChange={handleToggle}
          trackColor={{ false: '#374151', true: '#a855f7' }}
          thumbColor="#fff"
        />
      )}
    </View>
  );
});

export default function ManageTokensScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Shallow selector — `useWalletStore()` without one re-rendered this screen
  // on every store change. We only need a handful of fields here.
  const {
    network,
    networks,
    balances,
    toggleTokenVisibility,
    addCustomToken,
    error,
  } = useWalletStore(
    useShallow((state) => ({
      network: state.network,
      networks: state.networks,
      balances: state.balances,
      toggleTokenVisibility: state.toggleTokenVisibility,
      addCustomToken: state.addCustomToken,
      error: state.error,
    })),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Custom token form state
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState('18');
  const [isAddingToken, setIsAddingToken] = useState(false);

  const networkConfig = networks[network];
  const isEVM = networkConfig?.type === 'evm' || !networkConfig?.type;

  // Recompute only when the inputs actually change. Previously this filter
  // ran on every render, including unrelated parent re-renders.
  const filteredBalances = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return balances;
    return balances.filter(
      (item) =>
        item.token.name.toLowerCase().includes(query) ||
        item.token.symbol.toLowerCase().includes(query),
    );
  }, [balances, searchQuery]);

  const renderItem = useCallback(
    ({ item }: { item: TokenBalance }) => (
      <TokenRow item={item} onToggle={toggleTokenVisibility} />
    ),
    [toggleTokenVisibility],
  );

  const keyExtractor = useCallback((item: TokenBalance) => item.token.symbol, []);

  const handleAddToken = async () => {
    if (!tokenAddress || !tokenSymbol) return;

    try {
      setIsAddingToken(true);
      await addCustomToken({
        address: tokenAddress,
        symbol: tokenSymbol,
        decimals: parseInt(tokenDecimals, 10),
        name: tokenSymbol, // Default name to symbol
        type: 'erc20',
      });
      setShowAddModal(false);
      setTokenAddress('');
      setTokenSymbol('');
      setTokenDecimals('18');
    } catch (err) {
      // Error is handled by store
    } finally {
      setIsAddingToken(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-6"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => safeGoBack(router)} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold flex-1">Manage Tokens</Text>
        {isEVM && (
          <TouchableOpacity onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={28} color="#a855f7" />
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View className="px-5 mb-4">
        <View className="flex-row items-center bg-gray-900 rounded-xl px-4 py-3">
          <Ionicons name="search" size={20} color="#9ca3af" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search tokens"
            placeholderTextColor="#6b7280"
            className="flex-1 text-white ml-3"
          />
        </View>
      </View>

      {/* Token List */}
      <FlatList
        data={filteredBalances}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        removeClippedSubviews
        initialNumToRender={12}
        windowSize={5}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-gray-500">No tokens found</Text>
          </View>
        }
      />

      {/* Add Token Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowAddModal(false)}
          className="flex-1 bg-black/60 justify-end"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-t-3xl px-6 pt-6 pb-10">
              <View className="w-10 h-1 bg-gray-600 rounded-full self-center mb-6" />
              <Text className="text-white text-xl font-bold text-center mb-6">
                Add Custom Token
              </Text>

              <Text className="text-gray-400 text-sm mb-2">Contract Address</Text>
              <TextInput
                value={tokenAddress}
                onChangeText={setTokenAddress}
                placeholder="0x..."
                placeholderTextColor="#6b7280"
                className="bg-gray-800 text-white p-4 rounded-xl mb-4"
              />

              <View className="flex-row space-x-4">
                <View className="flex-1">
                  <Text className="text-gray-400 text-sm mb-2">Symbol</Text>
                  <TextInput
                    value={tokenSymbol}
                    onChangeText={setTokenSymbol}
                    placeholder="e.g. USDT"
                    placeholderTextColor="#6b7280"
                    className="bg-gray-800 text-white p-4 rounded-xl mb-4"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-400 text-sm mb-2">Decimals</Text>
                  <TextInput
                    value={tokenDecimals}
                    onChangeText={setTokenDecimals}
                    keyboardType="numeric"
                    placeholder="18"
                    placeholderTextColor="#6b7280"
                    className="bg-gray-800 text-white p-4 rounded-xl mb-4"
                  />
                </View>
              </View>

              {error && (
                <Text className="text-red-400 text-center text-sm mb-4">{error}</Text>
              )}

              <TouchableOpacity
                onPress={handleAddToken}
                disabled={isAddingToken || !tokenAddress || !tokenSymbol}
                className={`rounded-xl py-4 ${
                  !tokenAddress || !tokenSymbol ? 'bg-gray-700' : 'bg-purple-600'
                }`}
              >
                {isAddingToken ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white text-center font-semibold">Add Token</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
