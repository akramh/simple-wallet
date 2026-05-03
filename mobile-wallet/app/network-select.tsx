/**
 * @fileoverview Network selection modal.
 */

import { View, Text, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkSelectScreenSelector } from '../store';
import { getNetworkIcon } from '../utils/tokenIcons';
import { safeGoBack } from '../utils/navigation';
import { isNetworkCompatible } from '../utils/networkCompatibility';

export default function NetworkSelectScreen() {
  const router = useRouter();
  const {
    network,
    networks,
    switchNetwork,
    isLoading,
    showTestnets,
    toggleShowTestnets,
    importType,
    privateKeyType,
  } = useNetworkSelectScreenSelector();

  const checkCompatibility = (networkConfig: any): boolean =>
    isNetworkCompatible(networkConfig, importType, privateKeyType);

  const handleNetworkSelect = async (networkKey: string, isDisabled: boolean) => {
    if (isDisabled) return;
    
    if (networkKey === network) {
      safeGoBack(router);
      return;
    }

    try {
      await switchNetwork(networkKey);
      safeGoBack(router);
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
      <View className="flex-row items-center justify-between px-5 pb-4 border-b border-gray-800">
        <TouchableOpacity onPress={() => safeGoBack(router)}>
          <Ionicons name="close" size={28} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Select Network</Text>
        <View className="w-7" />
      </View>

      <ScrollView className="flex-1 px-5 pt-4">
        {/* Private key wallet notice */}
        {importType === 'privateKey' && privateKeyType && (
          <View className="bg-yellow-500/10 rounded-xl p-3 mb-4 flex-row items-center">
            <Ionicons name="information-circle-outline" size={20} color="#eab308" />
            <Text className="text-yellow-500 text-sm ml-2 flex-1">
              This wallet only supports {privateKeyType.toUpperCase()} networks
            </Text>
          </View>
        )}

        {/* EVM Networks */}
        {evmNetworks.length > 0 && (
          <>
            <Text className="text-gray-400 text-sm uppercase mb-3">EVM Networks</Text>
            <View className="bg-gray-900 rounded-2xl overflow-hidden mb-6">
              {evmNetworks.map(([key, config], index) => {
                const isDisabled = !checkCompatibility(config);
                return (
                  <NetworkRow
                    key={key}
                    networkKey={key}
                    name={config.name}
                    symbol={config.nativeSymbol}
                    chainId={config.chainId}
                    isSelected={key === network}
                    isDisabled={isDisabled}
                    isLast={index === evmNetworks.length - 1}
                    onPress={() => handleNetworkSelect(key, isDisabled)}
                  />
                );
              })}
            </View>
          </>
        )}

        {/* Other Networks */}
        {otherNetworks.length > 0 && (
          <>
            <Text className="text-gray-400 text-sm uppercase mb-3">Other Networks</Text>
            <View className="bg-gray-900 rounded-2xl overflow-hidden mb-6">
              {otherNetworks.map(([key, config], index) => {
                const isDisabled = !checkCompatibility(config);
                return (
                  <NetworkRow
                    key={key}
                    networkKey={key}
                    name={config.name}
                    symbol={config.nativeSymbol}
                    type={config.type}
                    isSelected={key === network}
                    isDisabled={isDisabled}
                    isLast={index === otherNetworks.length - 1}
                    onPress={() => handleNetworkSelect(key, isDisabled)}
                  />
                );
              })}
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
  isDisabled,
  isLast,
  onPress,
}: {
  networkKey: string;
  name: string;
  symbol: string;
  chainId?: number;
  type?: string;
  isSelected: boolean;
  isDisabled?: boolean;
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
      disabled={isDisabled}
      className={`flex-row items-center px-4 py-4 ${!isLast ? 'border-b border-gray-800' : ''}`}
      style={isDisabled ? { opacity: 0.4 } : undefined}
    >
      {/* Network Icon */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3 overflow-hidden"
        style={{ backgroundColor: networkIcon ? 'transparent' : `${getIconColor()}20` }}
      >
        {networkIcon ? (
          <Image
            source={networkIcon}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <Text className="font-bold" style={{ color: getIconColor() }}>
            {symbol.charAt(0)}
          </Text>
        )}
      </View>

      {/* Network Info */}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className={`font-medium ${isDisabled ? 'text-gray-500' : 'text-white'}`}>{name}</Text>
          {isDisabled && (
            <Ionicons name="lock-closed" size={12} color="#6b7280" style={{ marginLeft: 6 }} />
          )}
        </View>
        <Text className="text-gray-500 text-sm">
          {isDisabled ? 'Unavailable' : (chainId ? `Chain ID: ${chainId}` : type?.toUpperCase() || 'Network')}
        </Text>
      </View>

      {/* Selected Indicator */}
      {isSelected && !isDisabled && (
        <View className="w-6 h-6 rounded-full bg-green-500 items-center justify-center">
          <Ionicons name="checkmark" size={16} color="white" />
        </View>
      )}
    </TouchableOpacity>
  );
}
