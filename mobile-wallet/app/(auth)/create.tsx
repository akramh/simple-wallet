/**
 * @fileoverview Create new wallet screen.
 * If user is already unlocked (adding a new wallet), uses session password.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';
import { walletBridge } from '../../services/WalletBridge';

export default function CreateWalletScreen() {
  const router = useRouter();
  const { createWallet, isLoading, error, clearError, isUnlocked } = useWalletStore();

  const [walletName, setWalletName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  
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

  // Different validation based on whether we're adding or creating first wallet
  const isValid = isAddingWallet
    ? walletName.length >= 1 && walletName.length <= 12 && agreedToTerms
    : walletName.length >= 1 &&
      walletName.length <= 12 &&
      password.length >= 8 &&
      password === confirmPassword &&
      agreedToTerms;

  const handleCreate = async () => {
    if (!isValid || isLoading) return;

    try {
      // Use session password if adding wallet, otherwise use entered password
      const passwordToUse = isAddingWallet ? sessionPassword! : password;
      const result = await createWallet(passwordToUse, walletName || 'default');

      // Navigate to backup screen with mnemonic
      router.push({
        pathname: '/(auth)/backup',
        params: { mnemonic: result.mnemonic },
      });
    } catch (err) {
      Alert.alert('Error', error || 'Failed to create wallet');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950 px-6">
      {/* Header */}
      <View className="flex-row items-center pt-4 pb-6">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold ml-4">
          {isAddingWallet ? 'Add Wallet' : 'Create Wallet'}
        </Text>
      </View>

      {/* Form */}
      <View className="flex-1">
        <Text className="text-gray-400 mb-6">
          {isAddingWallet 
            ? 'Add a new wallet to your account. It will use your existing master password.'
            : 'Choose a name and secure password for your new wallet.'
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
          <Text className="text-gray-500 text-xs mt-1">
            {walletName.length}/12 characters
          </Text>
        </View>

        {/* Only show password fields if creating first wallet */}
        {!isAddingWallet && (
          <>
            {/* Password */}
            <View className="mb-4">
              <Text className="text-white mb-2">Password</Text>
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

        {/* Terms Checkbox */}
        <TouchableOpacity
          onPress={() => setAgreedToTerms(!agreedToTerms)}
          className="flex-row items-center mb-6"
        >
          <View
            className={`w-6 h-6 rounded border mr-3 items-center justify-center ${
              agreedToTerms ? 'bg-purple-600 border-purple-600' : 'border-gray-600'
            }`}
          >
            {agreedToTerms && <Ionicons name="checkmark" size={16} color="white" />}
          </View>
          <Text className="text-gray-400 flex-1">
            I understand I'm responsible for keeping my recovery phrase safe
          </Text>
        </TouchableOpacity>
      </View>

      {/* Create Button */}
      <TouchableOpacity
        onPress={handleCreate}
        disabled={!isValid || isLoading}
        className={`rounded-xl py-4 mb-4 ${
          isValid && !isLoading ? 'bg-purple-600' : 'bg-gray-800'
        }`}
      >
        {isLoading ? (
          <View className="flex-row items-center justify-center">
            <ActivityIndicator color="white" size="small" />
            <Text className="text-white font-semibold ml-3">
              {isAddingWallet ? 'Adding wallet...' : 'Creating wallet...'}
            </Text>
          </View>
        ) : (
          <Text className="text-white font-semibold text-center text-lg">
            {isAddingWallet ? 'Add Wallet' : 'Create Wallet'}
          </Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}
