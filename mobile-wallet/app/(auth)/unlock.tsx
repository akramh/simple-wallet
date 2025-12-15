/**
 * @fileoverview Unlock wallet screen with biometric support.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';
import { useBiometrics } from '../../hooks';

export default function UnlockScreen() {
  const router = useRouter();
  const { unlock, isLoading, error, clearError } = useWalletStore();
  const {
    isAvailable: biometricsAvailable,
    isEnabled: biometricsEnabled,
    biometricType,
    isAuthenticating,
    authenticate,
    getBiometricName,
  } = useBiometrics();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);

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

  const handleUnlock = async () => {
    if (password.length < 1) return;

    try {
      await unlock(password);
      router.replace('/(tabs)/wallet');
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

  const handleBiometricUnlock = async () => {
    const storedPassword = await authenticate();
    if (storedPassword) {
      try {
        await unlock(storedPassword);
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

  const getBiometricIcon = (): keyof typeof Ionicons.glyphMap => {
    return biometricType === 'facial' ? 'scan-outline' : 'finger-print-outline';
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950 px-6">
      {/* Logo */}
      <View className="flex-1 items-center justify-center">
        <View className="w-20 h-20 rounded-full bg-purple-600 items-center justify-center mb-6">
          <Ionicons name="lock-closed" size={40} color="white" />
        </View>
        <Text className="text-white text-2xl font-bold text-center mb-2">
          Welcome Back
        </Text>
        <Text className="text-gray-400 text-center mb-8">
          Enter your password to unlock
        </Text>

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
            onPress={handleBiometricUnlock}
            disabled={isAuthenticating}
            className="mt-6 flex-row items-center"
          >
            {isAuthenticating ? (
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
      </View>

      {/* Forgot Password */}
      <TouchableOpacity className="items-center pb-8">
        <Text className="text-gray-500">
          Forgot password?{' '}
          <Text
            className="text-purple-400"
            onPress={() => router.push('/(auth)/import')}
          >
            Restore with recovery phrase
          </Text>
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
