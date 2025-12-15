/**
 * @fileoverview Import existing wallet screen.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';

export default function ImportWalletScreen() {
  const router = useRouter();
  const { importWallet, isLoading, error, clearError } = useWalletStore();

  const [walletName, setWalletName] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Validate mnemonic has 12 or 24 words
  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const isValidMnemonic = wordCount === 12 || wordCount === 24;

  const isValid =
    walletName.length >= 1 &&
    walletName.length <= 12 &&
    isValidMnemonic &&
    password.length >= 8 &&
    password === confirmPassword;

  const handleImport = async () => {
    if (!isValid) return;

    try {
      clearError();
      const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
      await importWallet(normalizedMnemonic, password, walletName || 'default');

      // Navigate to main app
      router.replace('/(tabs)/wallet');
    } catch (err) {
      Alert.alert('Error', error || 'Failed to import wallet. Check your recovery phrase.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="flex-row items-center pt-4 pb-6">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold ml-4">Import Wallet</Text>
        </View>

        {/* Instructions */}
        <Text className="text-gray-400 mb-6">
          Enter your 12 or 24 word recovery phrase to restore your wallet.
        </Text>

        {/* Wallet Name */}
        <View className="mb-4">
          <Text className="text-white mb-2">Wallet Name</Text>
          <TextInput
            value={walletName}
            onChangeText={setWalletName}
            placeholder="My Wallet"
            placeholderTextColor="#6b7280"
            maxLength={12}
            autoCapitalize="none"
            className="bg-gray-900 rounded-xl px-4 py-4 text-white"
          />
        </View>

        {/* Recovery Phrase */}
        <View className="mb-4">
          <Text className="text-white mb-2">Recovery Phrase</Text>
          <TextInput
            value={mnemonic}
            onChangeText={setMnemonic}
            placeholder="Enter your 12 or 24 word phrase"
            placeholderTextColor="#6b7280"
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-gray-900 rounded-xl px-4 py-4 text-white min-h-[120px]"
            textAlignVertical="top"
          />
          <Text className={`text-xs mt-1 ${isValidMnemonic ? 'text-green-400' : 'text-gray-500'}`}>
            {wordCount} / 12 or 24 words
          </Text>
        </View>

        {/* Password */}
        <View className="mb-4">
          <Text className="text-white mb-2">New Password</Text>
          <View className="flex-row bg-gray-900 rounded-xl items-center">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor="#6b7280"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              className="flex-1 px-4 py-4 text-white"
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
          {password.length > 0 && password.length < 8 && (
            <Text className="text-red-400 text-xs mt-1">
              Password must be at least 8 characters
            </Text>
          )}
        </View>

        {/* Confirm Password */}
        <View className="mb-6">
          <Text className="text-white mb-2">Confirm Password</Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm password"
            placeholderTextColor="#6b7280"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            className="bg-gray-900 rounded-xl px-4 py-4 text-white"
          />
          {confirmPassword.length > 0 && password !== confirmPassword && (
            <Text className="text-red-400 text-xs mt-1">
              Passwords don't match
            </Text>
          )}
        </View>

        {/* Warning */}
        <View className="bg-yellow-500/10 rounded-xl p-4 mb-6">
          <View className="flex-row items-center mb-2">
            <Ionicons name="warning-outline" size={20} color="#eab308" />
            <Text className="text-yellow-500 font-semibold ml-2">Important</Text>
          </View>
          <Text className="text-yellow-500/80 text-sm">
            Never share your recovery phrase with anyone. Anyone with this phrase can access your wallet.
          </Text>
        </View>

        {/* Import Button */}
        <TouchableOpacity
          onPress={handleImport}
          disabled={!isValid || isLoading}
          className={`rounded-xl py-4 mb-8 ${
            isValid && !isLoading ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-center text-lg">
              Import Wallet
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
