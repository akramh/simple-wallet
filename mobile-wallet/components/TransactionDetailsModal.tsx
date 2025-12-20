/**
 * @fileoverview Transaction details modal component.
 * 
 * Displays full transaction details with options to copy hash
 * and view in block explorer.
 */

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Transaction } from '../services';

// Explorer URL mapping
const EXPLORER_URLS: Record<string, string> = {
  mainnet: 'https://etherscan.io/tx/',
  sepolia: 'https://sepolia.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  avalanche: 'https://snowtrace.io/tx/',
  linea: 'https://lineascan.build/tx/',
  'bitcoin-mainnet': 'https://mempool.space/tx/',
  'bitcoin-testnet': 'https://mempool.space/testnet/tx/',
  'solana-mainnet': 'https://solscan.io/tx/',
  'solana-devnet': 'https://solscan.io/tx/',
  'xrp-mainnet': 'https://xrpscan.com/tx/',
  'xrp-testnet': 'https://testnet.xrpscan.com/tx/',
  'ton-mainnet': 'https://tonscan.org/tx/',
  'ton-testnet': 'https://testnet.tonscan.org/tx/',
};

interface Props {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

export function TransactionDetailsModal({ visible, transaction, onClose }: Props) {
  if (!transaction) return null;

  const { hash, from, to, value, network, status, type, timestamp, blockNumber, tokenSymbol, fee } = transaction;
  
  const isSend = type === 'send';
  const isContractInteraction = type === 'contract_interaction';
  const symbol = tokenSymbol || 'ETH';

  const getExplorerUrl = () => {
    let baseUrl = EXPLORER_URLS[network] || EXPLORER_URLS.mainnet;
    let url = `${baseUrl}${hash}`;
    if (network === 'solana-devnet') {
      url = `${baseUrl}${hash}?cluster=devnet`;
    }
    return url;
  };

  const openInExplorer = () => {
    Linking.openURL(getExplorerUrl()).catch(err => {
      console.error('Failed to open explorer URL:', err);
      Alert.alert('Error', 'Failed to open block explorer');
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const formatValue = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (num === 0) return '0';
    return num.toFixed(8);
  };

  const truncateAddress = (addr: string | null) => {
    if (!addr) return 'Unknown';
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
  };

  const getStatusColor = () => {
    switch (status) {
      case 'confirmed': return 'text-green-400';
      case 'pending': return 'text-yellow-400';
      case 'failed': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getTypeLabel = () => {
    if (isContractInteraction) return 'Contract Interaction';
    return isSend ? 'Sent' : 'Received';
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-gray-950">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-4 border-b border-gray-800">
          <Text className="text-white text-xl font-bold">Transaction Details</Text>
          <TouchableOpacity onPress={onClose} className="p-2">
            <Ionicons name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
          {/* Type & Amount */}
          <View className="items-center py-8">
            <View
              className={`w-16 h-16 rounded-full items-center justify-center mb-4 ${
                isContractInteraction
                  ? 'bg-purple-500/20'
                  : isSend
                  ? 'bg-red-500/20'
                  : 'bg-green-500/20'
              }`}
            >
              <Ionicons
                name={
                  isContractInteraction
                    ? 'code-outline'
                    : isSend
                    ? 'arrow-up'
                    : 'arrow-down'
                }
                size={32}
                color={isContractInteraction ? '#8b5cf6' : isSend ? '#ef4444' : '#22c55e'}
              />
            </View>
            <Text className="text-gray-400 text-sm">{getTypeLabel()}</Text>
            <Text
              className={`text-3xl font-bold mt-1 ${
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
            <View className="flex-row items-center mt-2">
              <View
                className={`w-2 h-2 rounded-full mr-2 ${
                  status === 'confirmed'
                    ? 'bg-green-500'
                    : status === 'pending'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
              />
              <Text className={`capitalize ${getStatusColor()}`}>{status}</Text>
            </View>
          </View>

          {/* Details */}
          <View className="bg-gray-900 rounded-2xl p-4 mb-4">
            <DetailRow
              label="Date"
              value={formatDate(timestamp)}
            />
            <DetailRow
              label="Network"
              value={network}
            />
            {blockNumber && (
              <DetailRow
                label="Block"
                value={String(blockNumber)}
              />
            )}
            <DetailRow
              label="From"
              value={truncateAddress(from)}
              copyable
              fullValue={from}
              onCopy={() => copyToClipboard(from, 'From address')}
            />
            <DetailRow
              label="To"
              value={truncateAddress(to)}
              copyable
              fullValue={to || ''}
              onCopy={() => to && copyToClipboard(to, 'To address')}
            />
            {fee && (
              <DetailRow
                label="Fee"
                value={`${fee} ${symbol}`}
              />
            )}
            <DetailRow
              label="Transaction Hash"
              value={truncateAddress(hash)}
              copyable
              fullValue={hash}
              onCopy={() => copyToClipboard(hash, 'Transaction hash')}
              isLast
            />
          </View>

          {/* Actions */}
          <TouchableOpacity
            className="bg-purple-600 rounded-xl py-4 mb-4 flex-row items-center justify-center"
            onPress={openInExplorer}
          >
            <Ionicons name="open-outline" size={20} color="white" />
            <Text className="text-white font-semibold ml-2">View in Explorer</Text>
          </TouchableOpacity>

          {/* Bottom padding */}
          <View className="h-8" />
        </ScrollView>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  copyable,
  fullValue,
  onCopy,
  isLast,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  fullValue?: string;
  onCopy?: () => void;
  isLast?: boolean;
}) {
  return (
    <View
      className={`flex-row justify-between items-center py-3 ${
        isLast ? '' : 'border-b border-gray-800'
      }`}
    >
      <Text className="text-gray-400">{label}</Text>
      <View className="flex-row items-center">
        <Text className="text-white" numberOfLines={1}>
          {value}
        </Text>
        {copyable && onCopy && (
          <TouchableOpacity onPress={onCopy} className="ml-2 p-1">
            <Ionicons name="copy-outline" size={16} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default TransactionDetailsModal;
