/**
 * @fileoverview Unlock wallet screen with biometric support and wallet selection.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnlockScreenSelector } from '../../store';
import { useBiometrics } from '../../hooks';

const BIOMETRIC_OPTIN_KEY = 'wallet_biometric_optin_prompted';

export default function UnlockScreen() {
  const router = useRouter();
  const { unlock, isLoading, error, clearError, walletList, loadWalletList, lastWalletName } = useUnlockScreenSelector();
  const {
    isAvailable: biometricsAvailable,
    isEnabled: biometricsEnabled,
    biometricType,
    isAuthenticating,
    authenticate,
    enable,
    getBiometricName,
  } = useBiometrics();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [selectedWallet, setSelectedWallet] = useState<string>(lastWalletName ?? 'default');
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const [isEnablingBiometrics, setIsEnablingBiometrics] = useState(false);

  // Load wallet list on mount
  useEffect(() => {
    loadWalletList();
  }, []);

  // Set last-used wallet (if available), otherwise fall back to first wallet.
  useEffect(() => {
    if (walletList.length === 0) return;
    if (lastWalletName && walletList.find(w => w.name === lastWalletName)) {
      setSelectedWallet(lastWalletName);
      return;
    }
    if (!walletList.find(w => w.name === selectedWallet)) {
      setSelectedWallet(walletList[0].name);
    }
  }, [walletList, lastWalletName]);

  // Auto-trigger biometrics on mount if enabled
  useEffect(() => {
    if (biometricsEnabled && biometricsAvailable) {
      handleBiometricUnlock();
    }
  }, [biometricsEnabled, biometricsAvailable]);

  // Clear error when password changes
  useEffect(() => {
    if (error) clearError();
  }, [password]);

  const maybePromptBiometricOptIn = async (passwordToStore: string) => {
    if (!biometricsAvailable || biometricsEnabled) return;
    try {
      const prompted = await AsyncStorage.getItem(BIOMETRIC_OPTIN_KEY);
      if (prompted === 'true') return;
    } catch {
      // If storage fails, avoid blocking unlock; still allow prompt.
    }

    Alert.alert(
      `Enable ${getBiometricName()}?`,
      'Unlock faster with biometrics. You can change this later in Settings.',
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            AsyncStorage.setItem(BIOMETRIC_OPTIN_KEY, 'true').catch(() => {});
          },
        },
        {
          text: `Enable ${getBiometricName()}`,
          onPress: async () => {
            const success = await enable(passwordToStore);
            AsyncStorage.setItem(BIOMETRIC_OPTIN_KEY, 'true').catch(() => {});
            if (!success) {
              Alert.alert('Error', `Failed to enable ${getBiometricName()}.`);
            }
          },
        },
      ]
    );
  };

  const unlockWithPassword = async (
    passwordToUse: string,
    options?: { skipBiometricPrompt?: boolean }
  ) => {
    if (passwordToUse.length < 1) return;

    try {
      await unlock(passwordToUse, selectedWallet);
      router.replace('/(tabs)/wallet');
      if (!options?.skipBiometricPrompt) {
        maybePromptBiometricOptIn(passwordToUse);
      }
    } catch (err) {
      setAttempts((prev) => prev + 1);
      setPassword('');

      if (attempts >= 4) {
        Alert.alert(
          'Too Many Attempts',
          'You have made too many failed attempts. Please try again later.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleUnlock = async () => {
    await unlockWithPassword(password);
  };

  const handleBiometricUnlock = async () => {
    const storedPassword = await authenticate();
    if (storedPassword) {
      try {
        await unlock(storedPassword, selectedWallet);
        router.replace('/(tabs)/wallet');
      } catch {
        // Biometric auth succeeded but password invalid - disable biometrics
        Alert.alert(
          'Authentication Failed',
          'Please enter your password manually.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleEnableBiometrics = async () => {
    if (!biometricsAvailable) {
      Alert.alert(
        'Biometrics Unavailable',
        'Biometric authentication is not available on this device.'
      );
      return;
    }
    if (!password) {
      Alert.alert('Enter Password', 'Enter your password to enable biometrics.');
      return;
    }

    setIsEnablingBiometrics(true);
    const success = await enable(password);
    setIsEnablingBiometrics(false);
    if (!success) {
      Alert.alert('Error', `Failed to enable ${getBiometricName()}.`);
      return;
    }

    AsyncStorage.setItem(BIOMETRIC_OPTIN_KEY, 'true').catch(() => {});
    await unlockWithPassword(password, { skipBiometricPrompt: true });
  };

  const getBiometricIcon = (): keyof typeof Ionicons.glyphMap => {
    return biometricType === 'facial' ? 'scan-outline' : 'finger-print-outline';
  };

  const selectedWalletInfo = walletList.find(w => w.name === selectedWallet);

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          className="px-6"
        >
          {/* Logo */}
          <View className="items-center justify-center mb-6">
            <View className="w-20 h-20 rounded-full bg-purple-600 items-center justify-center mb-6">
              <Ionicons name="lock-closed" size={40} color="white" />
            </View>
            <Text className="text-white text-2xl font-bold text-center mb-2">
              Welcome Back
            </Text>
            <Text className="text-gray-400 text-center mb-6">
              Enter your password to unlock
            </Text>
          </View>

        {/* Wallet Selector (only show if multiple wallets) */}
        {walletList.length > 1 && (
          <TouchableOpacity
            onPress={() => setShowWalletPicker(true)}
            className="w-full bg-gray-900 rounded-xl py-3 px-4 mb-4 flex-row items-center justify-between"
          >
            <View className="flex-row items-center">
              <View className="w-8 h-8 rounded-full bg-purple-600/30 items-center justify-center mr-3">
                <Text className="text-purple-400 font-bold">
                  {selectedWallet.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text className="text-white font-medium">{selectedWallet}</Text>
                {selectedWalletInfo && (
                  <Text className="text-gray-500 text-xs">
                    {selectedWalletInfo.address.slice(0, 8)}...{selectedWalletInfo.address.slice(-6)}
                  </Text>
                )}
              </View>
            </View>
            <Ionicons name="chevron-down" size={20} color="#6b7280" />
          </TouchableOpacity>
        )}

        {/* Password Input */}
        <View className="w-full mb-4">
          <View className="flex-row bg-gray-900 rounded-xl items-center">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor="#6b7280"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoFocus
              onSubmitEditing={handleUnlock}
              returnKeyType="go"
              className="flex-1 px-4 py-4 text-white text-center"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              className="px-4"
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="#6b7280"
              />
            </TouchableOpacity>
          </View>
          {error && (
            <Text className="text-red-400 text-center text-sm mt-2">
              {error}
            </Text>
          )}
        </View>

        {/* Unlock Button */}
        <TouchableOpacity
          onPress={handleUnlock}
          disabled={password.length < 1 || isLoading}
          className={`w-full rounded-xl py-4 ${
            password.length >= 1 && !isLoading ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-center text-lg">
              Unlock
            </Text>
          )}
        </TouchableOpacity>

        {/* Biometrics Option */}
        {biometricsAvailable && (
          <TouchableOpacity
            onPress={biometricsEnabled ? handleBiometricUnlock : handleEnableBiometrics}
            disabled={isAuthenticating || isEnablingBiometrics}
            className="mt-6 flex-row items-center justify-center"
          >
            {isAuthenticating || isEnablingBiometrics ? (
              <ActivityIndicator size="small" color="#a855f7" />
            ) : (
              <Ionicons name={getBiometricIcon()} size={24} color="#a855f7" />
            )}
            <Text className="text-purple-400 ml-2">
              {biometricsEnabled
                ? `Use ${getBiometricName()}`
                : `Enable ${getBiometricName()}`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Wallet Picker Modal */}
      <Modal
        visible={showWalletPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWalletPicker(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowWalletPicker(false)}
          className="flex-1 bg-black/60 justify-end"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-t-3xl pt-6 pb-10">
              <View className="items-center mb-4">
                <View className="w-12 h-1 bg-gray-700 rounded-full" />
              </View>
              <Text className="text-white text-xl font-bold text-center mb-4">
                Select Wallet
              </Text>
              <FlatList
                data={walletList}
                keyExtractor={(item) => item.name}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedWallet(item.name);
                      setShowWalletPicker(false);
                    }}
                    className={`mx-4 mb-2 p-4 rounded-xl flex-row items-center ${
                      selectedWallet === item.name ? 'bg-purple-600/20 border border-purple-600' : 'bg-gray-800'
                    }`}
                  >
                    <View className="w-10 h-10 rounded-full bg-purple-600/30 items-center justify-center mr-3">
                      <Text className="text-purple-400 font-bold text-lg">
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-medium">{item.name}</Text>
                      <Text className="text-gray-500 text-sm">
                        {item.address.slice(0, 10)}...{item.address.slice(-8)}
                      </Text>
                    </View>
                    {selectedWallet === item.name && (
                      <Ionicons name="checkmark-circle" size={24} color="#a855f7" />
                    )}
                  </TouchableOpacity>
                )}
                ListFooterComponent={
                  <TouchableOpacity
                    onPress={() => {
                      setShowWalletPicker(false);
                      router.push('/(setup)/create');
                    }}
                    className="mx-4 mt-2 p-4 rounded-xl bg-gray-800 flex-row items-center justify-center"
                  >
                    <Ionicons name="add-circle-outline" size={20} color="#a855f7" />
                    <Text className="text-purple-400 font-medium ml-2">
                      Add New Wallet
                    </Text>
                  </TouchableOpacity>
                }
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
