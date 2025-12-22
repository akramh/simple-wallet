/**
 * @fileoverview Profile/settings screen.
 */

import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProfileScreenSelector } from '../../store';
import { walletBridge } from '../../services';
import { useBiometrics, useClipboard } from '../../hooks';
import { useToast } from '../../contexts';

// Auto-lock timeout options in minutes
const AUTO_LOCK_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { address, currentWalletName, network, networks, lock } = useProfileScreenSelector();
  const biometrics = useBiometrics();
  const { copy } = useClipboard();
  const { showToast } = useToast();

  // Auto-lock state
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [showAutoLockPicker, setShowAutoLockPicker] = useState(false);

  // Biometrics state
  const [showBiometricsPasswordModal, setShowBiometricsPasswordModal] = useState(false);
  const [biometricsPassword, setBiometricsPassword] = useState('');
  const [isBiometricsLoading, setIsBiometricsLoading] = useState(false);

  const handleCopyAddress = async () => {
    if (!address) return;
    const success = await copy(address);
    if (success) {
      showToast('Address copied to clipboard', 'success');
    }
  };

  // Handle biometrics toggle
  const handleBiometricsToggle = useCallback(async () => {
    if (biometrics.isEnabled) {
      // Disable biometrics
      Alert.alert(
        'Disable Biometrics',
        `Are you sure you want to disable ${biometrics.getBiometricName()}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await biometrics.disable();
            },
          },
        ]
      );
    } else {
      // Enable biometrics - need password
      if (!biometrics.isAvailable) {
        Alert.alert(
          'Biometrics Unavailable',
          'Biometric authentication is not available on this device. Please ensure you have Face ID or Touch ID set up in your device settings.'
        );
        return;
      }
      setShowBiometricsPasswordModal(true);
    }
  }, [biometrics]);

  const handleEnableBiometrics = async () => {
    if (!biometricsPassword) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    setIsBiometricsLoading(true);
    try {
      const success = await biometrics.enable(biometricsPassword);
      if (success) {
        Alert.alert('Success', `${biometrics.getBiometricName()} has been enabled`);
        setShowBiometricsPasswordModal(false);
        setBiometricsPassword('');
      } else {
        Alert.alert('Error', 'Failed to enable biometrics. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to enable biometrics');
    } finally {
      setIsBiometricsLoading(false);
    }
  };

  // Handle auto-lock selection
  const handleAutoLockSelect = (minutes: number) => {
    setAutoLockMinutes(minutes);
    walletBridge.setAutoLockTimeout(minutes);
    setShowAutoLockPicker(false);
  };

  const truncatedAddress = address
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : '';

  const handleLock = async () => {
    await lock();
    router.replace('/(auth)/unlock');
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
              <TouchableOpacity 
                className="flex-row items-center mt-1"
                onPress={handleCopyAddress}
              >
                <Text className="text-gray-400 text-sm">{truncatedAddress}</Text>
                <Ionicons name="copy-outline" size={14} color="#9ca3af" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
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
            onPress={() => router.push('/secret-phrase' as never)}
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
            subtitle={AUTO_LOCK_OPTIONS.find(o => o.value === autoLockMinutes)?.label || '15 minutes'}
            onPress={() => setShowAutoLockPicker(true)}
          />
          <BiometricsSettingsItem
            isAvailable={biometrics.isAvailable}
            isEnabled={biometrics.isEnabled}
            biometricName={biometrics.getBiometricName()}
            onToggle={handleBiometricsToggle}
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
            onPress={() => router.push('/licenses' as never)}
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

      {/* Auto-Lock Picker Modal */}
      <Modal
        visible={showAutoLockPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAutoLockPicker(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowAutoLockPicker(false)}
          className="flex-1 bg-black/70 justify-end"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-t-3xl p-5">
              <Text className="text-white text-xl font-bold text-center mb-6">
                Auto-Lock Timeout
              </Text>
              {AUTO_LOCK_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => handleAutoLockSelect(option.value)}
                  className={`py-4 px-4 rounded-xl mb-2 ${
                    autoLockMinutes === option.value ? 'bg-purple-600' : 'bg-gray-800'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white font-medium">{option.label}</Text>
                    {autoLockMinutes === option.value && (
                      <Ionicons name="checkmark" size={20} color="white" />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setShowAutoLockPicker(false)}
                className="mt-4 py-4 rounded-xl bg-gray-800"
              >
                <Text className="text-gray-300 font-semibold text-center">Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Biometrics Password Modal */}
      <Modal
        visible={showBiometricsPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBiometricsPasswordModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowBiometricsPasswordModal(false)}
          className="flex-1 bg-black/70 justify-center px-5"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-2xl p-5">
              <Text className="text-white text-xl font-bold text-center mb-2">
                Enable {biometrics.getBiometricName()}
              </Text>
              <Text className="text-gray-400 text-center mb-6">
                Enter your password to enable biometric unlock
              </Text>
              <TextInput
                value={biometricsPassword}
                onChangeText={setBiometricsPassword}
                placeholder="Enter your password"
                placeholderTextColor="#6b7280"
                secureTextEntry
                autoFocus
                className="bg-gray-800 rounded-xl px-4 py-4 text-white mb-4"
              />
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowBiometricsPasswordModal(false);
                    setBiometricsPassword('');
                  }}
                  className="flex-1 py-4 rounded-xl bg-gray-800"
                >
                  <Text className="text-gray-300 font-semibold text-center">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleEnableBiometrics}
                  disabled={isBiometricsLoading}
                  className="flex-1 py-4 rounded-xl bg-purple-600"
                >
                  <Text className="text-white font-semibold text-center">
                    {isBiometricsLoading ? 'Enabling...' : 'Enable'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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

function BiometricsSettingsItem({
  isAvailable,
  isEnabled,
  biometricName,
  onToggle,
}: {
  isAvailable: boolean;
  isEnabled: boolean;
  biometricName: string;
  onToggle: () => void;
}) {
  return (
    <View className="flex-row items-center py-4 border-b border-gray-800">
      <View className="w-10 h-10 rounded-xl bg-gray-800 items-center justify-center mr-3">
        <Ionicons name="finger-print-outline" size={20} color="#a855f7" />
      </View>
      <View className="flex-1">
        <Text className="text-white font-medium">{biometricName}</Text>
        <Text className="text-gray-500 text-sm mt-0.5">
          {isAvailable
            ? isEnabled
              ? 'Enabled'
              : 'Tap to enable'
            : 'Not available on this device'}
        </Text>
      </View>
      <Switch
        value={isEnabled}
        onValueChange={onToggle}
        disabled={!isAvailable}
        trackColor={{ false: '#374151', true: '#7c3aed' }}
        thumbColor={isEnabled ? '#a855f7' : '#6b7280'}
      />
    </View>
  );
}
