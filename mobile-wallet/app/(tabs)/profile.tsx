/**
 * @fileoverview Profile/settings screen.
 */

import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';
import { walletBridge } from '../../services';

export default function ProfileScreen() {
  const router = useRouter();
  const { address, currentWalletName, network, networks, lock } = useWalletStore();

  const truncatedAddress = address
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : '';

  const handleLock = () => {
    Alert.alert('Lock Wallet', 'Are you sure you want to lock your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Lock',
        style: 'destructive',
        onPress: async () => {
          await lock();
          router.replace('/(auth)/unlock');
        },
      },
    ]);
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'This will permanently delete ALL wallets and reset the app. Make sure you have backed up your recovery phrases!\n\nThis action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await walletBridge.clearAllData();
              router.replace('/(auth)/welcome');
            } catch (error) {
              Alert.alert('Error', 'Failed to clear data');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-6">
        <Text className="text-white text-2xl font-bold">Profile</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Account Card */}
        <View className="mx-5 bg-gray-900 rounded-2xl p-5 mb-6">
          <View className="flex-row items-center">
            <View className="w-14 h-14 rounded-full bg-purple-600 items-center justify-center mr-4">
              <Text className="text-white text-2xl font-bold">
                {currentWalletName?.charAt(0).toUpperCase() || 'W'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-white text-lg font-semibold">
                {currentWalletName || 'Default Wallet'}
              </Text>
              <View className="flex-row items-center mt-1">
                <Text className="text-gray-400 text-sm">{truncatedAddress}</Text>
                <TouchableOpacity className="ml-2">
                  <Ionicons name="copy-outline" size={14} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Settings Sections */}
        <View className="px-5">
          <Text className="text-gray-400 text-sm mb-3 uppercase">Wallet</Text>

          <SettingsItem
            icon="wallet-outline"
            title="Wallets"
            subtitle="Manage and switch wallets"
            onPress={() => router.push('/wallet-manage')}
          />
          <SettingsItem
            icon="people-outline"
            title="Accounts"
            subtitle="HD accounts (derivation paths)"
            onPress={() => router.push('/account-manage')}
          />
          <SettingsItem
            icon="globe-outline"
            title="Network"
            subtitle={networks[network]?.name || network}
            onPress={() => router.push('/network-select')}
          />
          <SettingsItem
            icon="key-outline"
            title="Secret Recovery Phrase"
            subtitle="Backup your wallet"
            onPress={() => {}}
          />
          <SettingsItem
            icon="shield-outline"
            title="Connected Apps"
            subtitle="Manage dApp connections"
            onPress={() => {}}
          />
        </View>

        <View className="px-5 mt-6">
          <Text className="text-gray-400 text-sm mb-3 uppercase">Security</Text>

          <SettingsItem
            icon="lock-closed-outline"
            title="Auto-Lock"
            subtitle="15 minutes"
            onPress={() => {}}
          />
          <SettingsItem
            icon="finger-print-outline"
            title="Biometrics"
            subtitle="Enable Face ID / Touch ID"
            onPress={() => {}}
          />
          <SettingsItem
            icon="key-outline"
            title="Change Password"
            onPress={() => {}}
          />
        </View>

        <View className="px-5 mt-6">
          <Text className="text-gray-400 text-sm mb-3 uppercase">App</Text>

          <SettingsItem
            icon="color-palette-outline"
            title="Theme"
            subtitle="Dark"
            onPress={() => {}}
          />
          <SettingsItem
            icon="cash-outline"
            title="Currency"
            subtitle="USD"
            onPress={() => {}}
          />
          <SettingsItem
            icon="information-circle-outline"
            title="About"
            onPress={() => {}}
          />
        </View>

        {/* Danger Zone */}
        <View className="px-5 mt-6">
          <Text className="text-gray-400 text-sm mb-3 uppercase">Danger Zone</Text>

          <SettingsItem
            icon="trash-outline"
            title="Clear All Data"
            subtitle="Delete all wallets and reset app"
            onPress={handleClearData}
          />
        </View>

        {/* Lock Button */}
        <View className="px-5 py-8">
          <TouchableOpacity
            onPress={handleLock}
            className="bg-red-500/20 rounded-xl py-4 flex-row items-center justify-center"
          >
            <Ionicons name="lock-closed" size={20} color="#ef4444" />
            <Text className="text-red-400 font-semibold ml-2">Lock Wallet</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Components
// ============================================================================

function SettingsItem({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center py-4 border-b border-gray-800"
    >
      <View className="w-10 h-10 rounded-xl bg-gray-800 items-center justify-center mr-3">
        <Ionicons name={icon} size={20} color="#a855f7" />
      </View>
      <View className="flex-1">
        <Text className="text-white font-medium">{title}</Text>
        {subtitle && <Text className="text-gray-500 text-sm mt-0.5">{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#4b5563" />
    </TouchableOpacity>
  );
}
