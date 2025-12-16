/**
 * @fileoverview Receive screen - shows address QR code.
 */

import {
  View,
  Text,
  TouchableOpacity,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import { useClipboard } from '../hooks';
import { QRCode, NetworkBadge } from '../components';

export default function ReceiveScreen() {
  const router = useRouter();
  const { address, network, networks } = useWalletStore();
  const { copy, copied } = useClipboard();

  const networkConfig = networks[network];
  const isTestnet = network.includes('test') || network.includes('sepolia');

  const handleCopy = async () => {
    if (!address) return;
    const success = await copy(address);
    if (success) {
      Alert.alert('Copied', 'Address copied to clipboard');
    }
  };

  const handleShare = async () => {
    if (!address) return;
    try {
      await Share.share({
        message: address,
        title: 'My Wallet Address',
      });
    } catch (error) {
      console.error('Share failed:', error);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4 border-b border-gray-800">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Receive</Text>
        <View className="w-7" />
      </View>

      <View className="flex-1 items-center justify-center px-6">
        {/* Network Badge */}
        <View className="mb-6">
          <NetworkBadge
            name={networkConfig?.name || network}
            isTestnet={isTestnet}
          />
        </View>

        {/* QR Code */}
        {address && (
          <View className="mb-6">
            <QRCode value={address} size={240} />
          </View>
        )}

        {/* Instructions */}
        <Text className="text-gray-400 text-center mb-6 px-4">
          Scan this QR code or share your address to receive{' '}
          <Text className="text-white font-medium">{networkConfig?.nativeSymbol || 'tokens'}</Text>
        </Text>

        {/* Address Display */}
        <TouchableOpacity
          onPress={handleCopy}
          className="bg-gray-900 rounded-xl p-4 w-full mb-6"
        >
          <Text className="text-gray-400 text-xs mb-1">Your Address</Text>
          <Text className="text-white font-mono text-sm" numberOfLines={1}>
            {address}
          </Text>
        </TouchableOpacity>

        {/* Action Buttons */}
        <View className="flex-row gap-4 w-full">
          <TouchableOpacity
            onPress={handleCopy}
            className="flex-1 bg-gray-800 rounded-xl py-4 flex-row items-center justify-center"
          >
            <Ionicons name="copy-outline" size={20} color="#a855f7" />
            <Text className="text-purple-400 font-semibold ml-2">Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            className="flex-1 bg-purple-600 rounded-xl py-4 flex-row items-center justify-center"
          >
            <Ionicons name="share-outline" size={20} color="white" />
            <Text className="text-white font-semibold ml-2">Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Warning */}
      <View className="px-6 pb-6">
        <View className="bg-yellow-500/10 rounded-xl p-4 flex-row items-start">
          <Ionicons name="warning-outline" size={20} color="#eab308" />
          <Text className="text-yellow-500/80 text-sm ml-3 flex-1">
            Only send{' '}
            <Text className="font-medium">{networkConfig?.name || network}</Text> assets to this
            address. Sending other assets may result in permanent loss.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
