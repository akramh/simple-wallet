/**
 * @fileoverview Wallet management screen - list, add, switch wallets.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../store';
import { safeGoBack } from '../utils/navigation';

export default function WalletManageScreen() {
  const router = useRouter();
  const {
    walletList,
    currentWalletName,
    loadWalletList,
    switchWallet,
    canSwitchWalletWithoutPassword,
    isLoading,
    error,
    clearError,
  } = useWalletStore();

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [selectedWalletToSwitch, setSelectedWalletToSwitch] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadWalletList();
  }, []);

  const handleWalletPress = async (walletName: string) => {
    if (walletName === currentWalletName) {
      // Already active
      return;
    }
    if (canSwitchWalletWithoutPassword()) {
      try {
        await switchWallet(walletName);
        safeGoBack(router);
      } catch (err) {
        setSelectedWalletToSwitch(walletName);
        setPassword('');
        setShowPasswordModal(true);
      }
      return;
    }
    setSelectedWalletToSwitch(walletName);
    setPassword('');
    setShowPasswordModal(true);
  };

  const handleSwitchWallet = async () => {
    if (!selectedWalletToSwitch || !password) return;

    try {
      await switchWallet(selectedWalletToSwitch, password);
      setShowPasswordModal(false);
      setPassword('');
      setSelectedWalletToSwitch(null);
      safeGoBack(router);
    } catch (err) {
      // Error is shown in modal
    }
  };

  const handleAddWallet = () => {
    setShowAddWalletModal(true);
  };

  const handleCreateNew = () => {
    setShowAddWalletModal(false);
    router.push('/(setup)/create');
  };

  const handleImportExisting = () => {
    setShowAddWalletModal(false);
    router.push('/(setup)/import');
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-6">
        <TouchableOpacity onPress={() => safeGoBack(router)} className="mr-4">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold flex-1">Wallets</Text>
        <TouchableOpacity onPress={handleAddWallet}>
          <Ionicons name="add-circle-outline" size={28} color="#a855f7" />
        </TouchableOpacity>
      </View>

      {/* Wallet List */}
      <FlatList
        data={walletList}
        keyExtractor={(item) => item.name}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        renderItem={({ item }) => {
          const isActive = item.name === currentWalletName;
          return (
            <TouchableOpacity
              onPress={() => handleWalletPress(item.name)}
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
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white font-semibold text-lg">{item.name}</Text>
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
            <Ionicons name="wallet-outline" size={48} color="#4b5563" />
            <Text className="text-gray-500 mt-4">No wallets found</Text>
          </View>
        }
      />

      {/* Password Modal for Switching */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowPasswordModal(false)}
          className="flex-1 bg-black/60 justify-center px-6"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-2xl p-6">
              <Text className="text-white text-xl font-bold text-center mb-2">
                Switch Wallet
              </Text>
              <Text className="text-gray-400 text-center mb-6">
                Enter password for "{selectedWalletToSwitch}"
              </Text>

              <View className="flex-row bg-gray-800 rounded-xl items-center mb-4">
                <TextInput
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (error) clearError();
                  }}
                  placeholder="Enter password"
                  placeholderTextColor="#6b7280"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoFocus
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

              {error && (
                <Text className="text-red-400 text-center text-sm mb-4">{error}</Text>
              )}

              <View className="flex-row space-x-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowPasswordModal(false);
                    setPassword('');
                    clearError();
                  }}
                  className="flex-1 bg-gray-800 rounded-xl py-4"
                >
                  <Text className="text-white text-center font-semibold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSwitchWallet}
                  disabled={!password || isLoading}
                  className={`flex-1 rounded-xl py-4 ${
                    password && !isLoading ? 'bg-purple-600' : 'bg-gray-700'
                  }`}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white text-center font-semibold">Switch</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Add Wallet Modal */}
      <Modal
        visible={showAddWalletModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddWalletModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowAddWalletModal(false)}
          className="flex-1 bg-black/60 justify-end"
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View className="bg-gray-900 rounded-t-3xl px-6 pt-6 pb-10">
              {/* Handle bar */}
              <View className="w-10 h-1 bg-gray-600 rounded-full self-center mb-6" />
              
              <Text className="text-white text-xl font-bold text-center mb-2">
                Add Wallet
              </Text>
              <Text className="text-gray-400 text-center mb-8">
                Create a new wallet or import an existing one
              </Text>

              {/* Create New Wallet */}
              <TouchableOpacity
                onPress={handleCreateNew}
                className="flex-row items-center bg-gray-800 rounded-2xl p-4 mb-3"
              >
                <View className="w-12 h-12 rounded-full bg-purple-600/20 items-center justify-center mr-4">
                  <Ionicons name="add-circle" size={24} color="#a855f7" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold text-lg">Create New Wallet</Text>
                  <Text className="text-gray-400 text-sm">Generate a new recovery phrase</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>

              {/* Import Existing */}
              <TouchableOpacity
                onPress={handleImportExisting}
                className="flex-row items-center bg-gray-800 rounded-2xl p-4 mb-6"
              >
                <View className="w-12 h-12 rounded-full bg-blue-600/20 items-center justify-center mr-4">
                  <Ionicons name="download" size={24} color="#3b82f6" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold text-lg">Import Existing</Text>
                  <Text className="text-gray-400 text-sm">Use your recovery phrase</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>

              {/* Cancel Button */}
              <TouchableOpacity
                onPress={() => setShowAddWalletModal(false)}
                className="bg-gray-800 rounded-xl py-4"
              >
                <Text className="text-white text-center font-semibold">Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
