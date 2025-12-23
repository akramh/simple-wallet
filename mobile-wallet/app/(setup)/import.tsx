/**
 * @fileoverview Import existing wallet screen.
 * If user is already unlocked (adding a wallet), uses session password.
 * Otherwise, prompts for a new master password.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';
import { walletBridge } from '../../services/WalletBridge';
import { safeGoBack } from '../../utils/navigation';

export default function ImportWalletScreen() {
  const router = useRouter();
  const { importWallet, isLoading, error, clearError, isUnlocked } = useWalletStore();

  const [walletName, setWalletName] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Check if we're adding a wallet while already unlocked
  const [sessionPassword, setSessionPassword] = useState<string | null>(null);
  const isAddingWallet = isUnlocked && sessionPassword !== null;

  useEffect(() => {
    // If already unlocked, get the session password
    if (isUnlocked) {
      const pwd = walletBridge.getSessionPassword();
      setSessionPassword(pwd);
    }
  }, [isUnlocked]);

  // Validate mnemonic has 12 or 24 words
  const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
  const isValidMnemonic = wordCount === 12 || wordCount === 24;

  // Different validation based on whether we're adding or creating first wallet
  const isValid = isAddingWallet
    ? walletName.length >= 1 && walletName.length <= 12 && isValidMnemonic
    : walletName.length >= 1 &&
      walletName.length <= 12 &&
      isValidMnemonic &&
      password.length >= 8 &&
      password === confirmPassword;

  const handleImport = async () => {
    if (!isValid || isLoading) return;

    try {
      const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
      // Use session password if adding wallet, otherwise use entered password
      const passwordToUse = isAddingWallet ? sessionPassword! : password;
      await importWallet(normalizedMnemonic, passwordToUse, walletName || 'default');

      // Navigate to main app
      router.replace('/(tabs)/wallet');
    } catch (err) {
      Alert.alert('Error', error || 'Failed to import wallet. Check your recovery phrase.');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView 
          className="flex-1 px-6" 
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
        {/* Header */}
        <View className="flex-row items-center pt-4 pb-6">
          <TouchableOpacity onPress={() => safeGoBack(router)}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold ml-4">
            {isAddingWallet ? 'Import Wallet' : 'Import Wallet'}
          </Text>
        </View>

        {/* Instructions */}
        <Text className="text-gray-400 mb-6">
          {isAddingWallet
            ? 'Enter your 12 or 24 word recovery phrase. It will use your existing master password.'
            : 'Enter your 12 or 24 word recovery phrase to restore your wallet.'
          }
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

        {/* Only show password fields if creating first wallet */}
        {!isAddingWallet && (
          <>
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
          </>
        )}

        {/* Info banner when using master password */}
        {isAddingWallet && (
          <View className="bg-purple-900/30 rounded-xl p-4 mb-6 flex-row items-center">
            <Ionicons name="lock-closed" size={20} color="#a78bfa" />
            <Text className="text-purple-300 ml-3 flex-1">
              This wallet will be encrypted with your master password
            </Text>
          </View>
        )}

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
            <View className="flex-row items-center justify-center">
              <ActivityIndicator color="white" size="small" />
              <Text className="text-white font-semibold ml-3">
                Importing wallet...
              </Text>
            </View>
          ) : (
            <Text className="text-white font-semibold text-center text-lg">
              Import Wallet
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
