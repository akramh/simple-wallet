/**
 * @fileoverview Network selection modal.
 */

import { View, Text, TouchableOpacity, ScrollView, Image, Switch } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkSelectScreenSelector } from '../store';
import { getNetworkIcon } from '../utils/tokenIcons';

export default function NetworkSelectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { 
    network, 
    networks, 
    switchNetwork, 
    isLoading,
    showTestnets,
    toggleShowTestnets 
  } = useNetworkSelectScreenSelector();

  const handleNetworkSelect = async (networkKey: string) => {
    if (networkKey === network) {
      router.back();
      return;
    }

    try {
      await switchNetwork(networkKey);
      router.back();
    } catch (error) {
      console.error('Failed to switch network:', error);
    }
  };

  const shouldShow = (key: string, config: any) => {
    // Always show current network
    if (key === network) return true;
    // Show if showTestnets is on OR if it's not a testnet
    return showTestnets || !config.isTestnet;
  };

  // Group networks by type
  const evmNetworks = Object.entries(networks).filter(
    ([key, config]) => (!config.type || config.type === 'evm') && shouldShow(key, config)
  );
  const otherNetworks = Object.entries(networks).filter(
    ([key, config]) => config.type && config.type !== 'evm' && shouldShow(key, config)
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-5 pb-4 border-b border-gray-800"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Select Network</Text>
        <View className="w-7" />
      </View>

      <ScrollView className="flex-1 px-5 pt-4">
        {/* EVM Networks */}
        {evmNetworks.length > 0 && (
          <>
            <Text className="text-gray-400 text-sm uppercase mb-3">EVM Networks</Text>
            <View className="bg-gray-900 rounded-2xl overflow-hidden mb-6">
              {evmNetworks.map(([key, config], index) => (
                <NetworkRow
                  key={key}
                  networkKey={key}
                  name={config.name}
                  symbol={config.nativeSymbol}
                  chainId={config.chainId}
                  isSelected={key === network}
                  isLast={index === evmNetworks.length - 1}
                  onPress={() => handleNetworkSelect(key)}
                />
              ))}
            </View>
          </>
        )}

        {/* Other Networks */}
        {otherNetworks.length > 0 && (
          <>
            <Text className="text-gray-400 text-sm uppercase mb-3">Other Networks</Text>
            <View className="bg-gray-900 rounded-2xl overflow-hidden mb-6">
              {otherNetworks.map(([key, config], index) => (
                <NetworkRow
                  key={key}
                  networkKey={key}
                  name={config.name}
                  symbol={config.nativeSymbol}
                  type={config.type}
                  isSelected={key === network}
                  isLast={index === otherNetworks.length - 1}
                  onPress={() => handleNetworkSelect(key)}
                />
              ))}
            </View>
          </>
        )}

        {/* Testnet Toggle */}
        <View className="flex-row items-center justify-between bg-gray-900 rounded-2xl px-4 py-3 mb-6">
          <Text className="text-white font-medium">Show Test Networks</Text>
          <Switch
            value={showTestnets}
            onValueChange={toggleShowTestnets}
            trackColor={{ false: '#374151', true: '#a855f7' }}
            thumbColor="#fff"
          />
        </View>

        {/* Add Custom Network */}
        <TouchableOpacity className="flex-row items-center justify-center py-4 mb-8">
          <Ionicons name="add-circle-outline" size={20} color="#a855f7" />
          <Text className="text-purple-400 ml-2">Add Custom Network</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function NetworkRow({
  networkKey,
  name,
  symbol,
  chainId,
  type,
  isSelected,
  isLast,
  onPress,
}: {
  networkKey: string;
  name: string;
  symbol: string;
  chainId?: number;
  type?: string;
  isSelected: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  const networkIcon = getNetworkIcon(networkKey);
  
  // Fallback icon color based on symbol
  const getIconColor = () => {
    switch (symbol) {
      case 'ETH':
        return '#627eea';
      case 'POL':
      case 'MATIC':
        return '#8247e5';
      case 'BNB':
        return '#f0b90b';
      case 'BTC':
        return '#f7931a';
      case 'SOL':
        return '#00ffa3';
      case 'XRP':
        return '#23292f';
      default:
        return '#6b7280';
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center px-4 py-4 ${!isLast ? 'border-b border-gray-800' : ''}`}
    >
      {/* Network Icon */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3 overflow-hidden"
        style={{ backgroundColor: networkIcon ? 'transparent' : `${getIconColor()}20` }}
      >
        {networkIcon ? (
          <Image
            source={networkIcon}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Text className="font-bold" style={{ color: getIconColor() }}>
            {symbol.charAt(0)}
          </Text>
        )}
      </View>

      {/* Network Info */}
      <View className="flex-1">
        <Text className="text-white font-medium">{name}</Text>
        <Text className="text-gray-500 text-sm">
          {chainId ? `Chain ID: ${chainId}` : type?.toUpperCase() || 'Network'}
        </Text>
      </View>

      {/* Selected Indicator */}
      {isSelected && (
        <View className="w-6 h-6 rounded-full bg-green-500 items-center justify-center">
          <Ionicons name="checkmark" size={16} color="white" />
        </View>
      )}
    </TouchableOpacity>
  );
}
