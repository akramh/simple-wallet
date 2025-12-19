/**
 * @fileoverview Activity/transaction history screen.
 * 
 * Displays transaction history for the current wallet and network.
 * Supports filtering by transaction type and pull-to-refresh.
 */

import { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useActivityScreenSelector } from '../../store';
import { TransactionDetailsModal } from '../../components/TransactionDetailsModal';
import type { Transaction } from '../../services';

export default function ActivityScreen() {
  const {
    isUnlocked,
    network,
    transactions,
    isLoadingTransactions,
    transactionFilter,
    loadTransactions,
    setTransactionFilter,
    getFilteredTransactions,
  } = useActivityScreenSelector();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Load transactions on mount and when network changes
  useEffect(() => {
    if (isUnlocked) {
      loadTransactions();
    }
  }, [isUnlocked, network]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadTransactions();
    setIsRefreshing(false);
  }, [loadTransactions]);

  const filteredTransactions = getFilteredTransactions();

  const handleTransactionPress = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setShowDetailsModal(true);
  };

  const handleCloseModal = () => {
    setShowDetailsModal(false);
    setSelectedTransaction(null);
  };

  // Show loading state on initial load
  if (isLoadingTransactions && transactions.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-950">
        <View className="px-5 pt-4 pb-4">
          <Text className="text-white text-2xl font-bold">Activity</Text>
          <Text className="text-gray-400 mt-1">Your transaction history</Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#9333ea" />
          <Text className="text-gray-400 mt-4">Loading transactions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-4">
        <Text className="text-white text-2xl font-bold">Activity</Text>
        <Text className="text-gray-400 mt-1">Your transaction history</Text>
      </View>

      {/* Filters */}
      <View className="flex-row px-5 mb-4 gap-2">
        <FilterChip
          label="All"
          active={transactionFilter === 'all'}
          onPress={() => setTransactionFilter('all')}
        />
        <FilterChip
          label="Sent"
          active={transactionFilter === 'sent'}
          onPress={() => setTransactionFilter('sent')}
        />
        <FilterChip
          label="Received"
          active={transactionFilter === 'received'}
          onPress={() => setTransactionFilter('received')}
        />
      </View>

      {/* Transaction List */}
      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#9333ea"
            colors={['#9333ea']}
          />
        }
      >
        {filteredTransactions.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="receipt-outline" size={64} color="#4b5563" />
            <Text className="text-gray-500 text-lg mt-4">
              {transactionFilter === 'all'
                ? 'No transactions yet'
                : `No ${transactionFilter} transactions`}
            </Text>
            <Text className="text-gray-600 text-sm mt-2 text-center px-8">
              {transactionFilter === 'all'
                ? 'Your transaction history will appear here once you make your first transaction.'
                : `You haven't ${transactionFilter === 'sent' ? 'sent' : 'received'} any tokens yet.`}
            </Text>
            {!isLoadingTransactions && (
              <TouchableOpacity
                className="mt-6 px-6 py-3 bg-purple-600 rounded-full"
                onPress={handleRefresh}
              >
                <Text className="text-white font-medium">Refresh</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {filteredTransactions.map((tx) => (
              <TransactionRow
                key={tx.hash}
                transaction={tx}
                onPress={() => handleTransactionPress(tx)}
              />
            ))}
            {/* Bottom padding */}
            <View className="h-8" />
          </>
        )}
      </ScrollView>

      {/* Transaction Details Modal */}
      <TransactionDetailsModal
        visible={showDetailsModal}
        transaction={selectedTransaction}
        onClose={handleCloseModal}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className={`px-4 py-2 rounded-full ${
        active ? 'bg-purple-600' : 'bg-gray-800'
      }`}
      onPress={onPress}
    >
      <Text className={active ? 'text-white font-medium' : 'text-gray-400'}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TransactionRow({
  transaction,
  onPress,
}: {
  transaction: Transaction;
  onPress: () => void;
}) {
  const { type, value, tokenSymbol, to, from, timestamp, status } = transaction;
  
  const isSend = type === 'send';
  const isContractInteraction = type === 'contract_interaction';
  
  // For display, show the counterparty address
  const counterparty = isSend ? to : from;
  const truncatedAddress = counterparty
    ? `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}`
    : 'Unknown';
  
  // Format the date
  const formatDate = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  };

  // Format the value for display
  const formatValue = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (num === 0) return '0';
    if (Math.abs(num) < 0.0001) return '<0.0001';
    if (Math.abs(num) < 1) return num.toFixed(6);
    if (Math.abs(num) < 1000) return num.toFixed(4);
    return num.toFixed(2);
  };

  // Get icon and colors based on type
  const getTypeStyle = () => {
    if (isContractInteraction) {
      return {
        icon: 'code-outline' as const,
        color: '#8b5cf6',
        bgColor: 'bg-purple-500/20',
        label: 'Contract',
      };
    }
    if (isSend) {
      return {
        icon: 'arrow-up' as const,
        color: '#ef4444',
        bgColor: 'bg-red-500/20',
        label: 'Sent',
      };
    }
    return {
      icon: 'arrow-down' as const,
      color: '#22c55e',
      bgColor: 'bg-green-500/20',
      label: 'Received',
    };
  };

  const typeStyle = getTypeStyle();
  const symbol = tokenSymbol || 'ETH';

  return (
    <TouchableOpacity
      className="flex-row items-center py-4 border-b border-gray-800"
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Icon */}
      <View
        className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${typeStyle.bgColor}`}
      >
        <Ionicons name={typeStyle.icon} size={20} color={typeStyle.color} />
      </View>

      {/* Info */}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className="text-white font-medium">
            {typeStyle.label} {symbol}
          </Text>
          {status === 'pending' && (
            <View className="ml-2 px-2 py-0.5 bg-yellow-500/20 rounded-full">
              <Text className="text-yellow-500 text-xs">Pending</Text>
            </View>
          )}
          {status === 'failed' && (
            <View className="ml-2 px-2 py-0.5 bg-red-500/20 rounded-full">
              <Text className="text-red-500 text-xs">Failed</Text>
            </View>
          )}
        </View>
        <Text className="text-gray-500 text-sm">
          {isSend ? `To ${truncatedAddress}` : `From ${truncatedAddress}`}
        </Text>
      </View>

      {/* Amount & Date */}
      <View className="items-end">
        <Text
          className={`font-medium ${
            isContractInteraction
              ? 'text-purple-400'
              : isSend
              ? 'text-red-400'
              : 'text-green-400'
          }`}
        >
          {isSend ? '-' : isContractInteraction ? '' : '+'}
          {formatValue(value)} {symbol}
        </Text>
        <Text className="text-gray-500 text-xs">{formatDate(timestamp)}</Text>
      </View>

      {/* Chevron to indicate tappable */}
      <Ionicons
        name="chevron-forward"
        size={16}
        color="#6b7280"
        style={{ marginLeft: 8 }}
      />
    </TouchableOpacity>
  );
}
