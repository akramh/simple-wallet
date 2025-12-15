/**
 * @fileoverview Activity/transaction history screen.
 */

import { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';

export default function ActivityScreen() {
  const { transactions, isLoadingTransactions } = useWalletStore();

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-4">
        <Text className="text-white text-2xl font-bold">Activity</Text>
        <Text className="text-gray-400 mt-1">Your transaction history</Text>
      </View>

      {/* Filters */}
      <View className="flex-row px-5 mb-4 gap-2">
        <FilterChip label="All" active />
        <FilterChip label="Sent" />
        <FilterChip label="Received" />
      </View>

      {/* Transaction List */}
      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {transactions.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="receipt-outline" size={64} color="#4b5563" />
            <Text className="text-gray-500 text-lg mt-4">No transactions yet</Text>
            <Text className="text-gray-600 text-sm mt-2 text-center px-8">
              Your transaction history will appear here once you make your first transaction.
            </Text>
          </View>
        ) : (
          transactions.map((tx) => (
            <TransactionRow
              key={tx.hash}
              type={tx.type}
              amount={tx.value}
              symbol={tx.tokenSymbol || 'ETH'}
              to={tx.to || 'Contract'}
              timestamp={tx.timestamp}
              status={tx.status}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function FilterChip({ label, active }: { label: string; active?: boolean }) {
  return (
    <TouchableOpacity
      className={`px-4 py-2 rounded-full ${
        active ? 'bg-purple-600' : 'bg-gray-800'
      }`}
    >
      <Text className={active ? 'text-white font-medium' : 'text-gray-400'}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TransactionRow({
  type,
  amount,
  symbol,
  to,
  timestamp,
  status,
}: {
  type: 'send' | 'receive' | 'contract_interaction';
  amount: string;
  symbol: string;
  to: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
}) {
  const isSend = type === 'send';
  const truncatedTo = `${to.slice(0, 6)}...${to.slice(-4)}`;
  const formattedDate = new Date(timestamp).toLocaleDateString();

  return (
    <View className="flex-row items-center py-4 border-b border-gray-800">
      {/* Icon */}
      <View
        className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
          isSend ? 'bg-red-500/20' : 'bg-green-500/20'
        }`}
      >
        <Ionicons
          name={isSend ? 'arrow-up' : 'arrow-down'}
          size={20}
          color={isSend ? '#ef4444' : '#22c55e'}
        />
      </View>

      {/* Info */}
      <View className="flex-1">
        <Text className="text-white font-medium">
          {isSend ? 'Sent' : 'Received'} {symbol}
        </Text>
        <Text className="text-gray-500 text-sm">
          {isSend ? `To ${truncatedTo}` : `From ${truncatedTo}`}
        </Text>
      </View>

      {/* Amount & Status */}
      <View className="items-end">
        <Text className={`font-medium ${isSend ? 'text-red-400' : 'text-green-400'}`}>
          {isSend ? '-' : '+'}
          {parseFloat(amount).toFixed(4)} {symbol}
        </Text>
        <Text className="text-gray-500 text-xs">{formattedDate}</Text>
      </View>
    </View>
  );
}
