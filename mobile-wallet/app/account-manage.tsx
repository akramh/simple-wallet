/**
 * @fileoverview Account management screen - manage HD accounts within a wallet.
 * 
 * Accounts are different from wallets:
 * - Wallet = encrypted mnemonic (recovery phrase)
 * - Account = HD derivation path from that mnemonic (m/44'/60'/0'/0/index)
 * 
 * Users can have multiple accounts per wallet without needing separate passwords.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import { useToast } from '../contexts';

export default function AccountManageScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    accounts,
    currentAccountIndex,
    address,
    loadAccounts,
    createAccount,
    switchAccount,
    isLoading,
    error,
    clearError,
  } = useWalletStore();

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleAccountPress = async (index: number) => {
    if (index === currentAccountIndex) {
      // Already active
      return;
    }

    try {
      await switchAccount(index);
      router.back();
    } catch (err) {
      Alert.alert('Error', 'Failed to switch account');
    }
  };

  const handleAddAccount = async () => {
    try {
      const result = await createAccount();
      showToast(`Account #${result.index + 1} created`, 'success');
      // Automatically switch to the new account
      await switchAccount(result.index);
    } catch (err) {
      showToast('Failed to create account', 'error');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold flex-1">Accounts</Text>
        <TouchableOpacity onPress={handleAddAccount} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color="#a855f7" size="small" />
          ) : (
            <Ionicons name="add-circle-outline" size={28} color="#a855f7" />
          )}
        </TouchableOpacity>
      </View>

      {/* Info Banner */}
      <View className="mx-5 mb-4 p-3 bg-blue-900/30 rounded-xl flex-row items-center">
        <Ionicons name="information-circle" size={20} color="#60a5fa" />
        <Text className="text-blue-300 text-sm ml-2 flex-1">
          Accounts are derived from your wallet's recovery phrase using different derivation paths.
        </Text>
      </View>

      {/* Account List */}
      <FlatList
        data={accounts}
        keyExtractor={(item) => `account-${item.index}`}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        renderItem={({ item }) => {
          const isActive = item.index === currentAccountIndex;
          return (
            <TouchableOpacity
              onPress={() => handleAccountPress(item.index)}
              className={`mb-3 p-4 rounded-2xl flex-row items-center ${
                isActive ? 'bg-purple-600/20 border border-purple-600' : 'bg-gray-900'
              }`}
            >
              <View
                className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                  isActive ? 'bg-purple-600' : 'bg-gray-800'
                }`}
              >
                <Text className="text-white font-bold text-lg">
                  {item.index + 1}
                </Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white font-semibold text-lg">
                    Account #{item.index + 1}
                  </Text>
                  {isActive && (
                    <View className="ml-2 px-2 py-0.5 bg-purple-600 rounded-full">
                      <Text className="text-white text-xs font-medium">Active</Text>
                    </View>
                  )}
                </View>
                <Text className="text-gray-500 text-sm mt-1">
                  {item.address.slice(0, 12)}...{item.address.slice(-10)}
                </Text>
              </View>
              {!isActive && (
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-20">
            <Ionicons name="people-outline" size={48} color="#4b5563" />
            <Text className="text-gray-500 mt-4">No accounts found</Text>
            <Text className="text-gray-600 text-sm mt-1">Tap + to add an account</Text>
          </View>
        }
        ListFooterComponent={
          accounts.length > 0 ? (
            <View className="mt-4 mb-8">
              <Text className="text-gray-600 text-xs text-center">
                Derivation path: m/44'/60'/0'/0/{'{index}'}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
