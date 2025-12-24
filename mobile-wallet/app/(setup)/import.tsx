/**
 * @fileoverview Import existing wallet screen.
 * Supports importing via BIP-39 mnemonic or raw private key.
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
  const [importType, setImportType] = useState<'mnemonic' | 'privateKey'>('mnemonic');
  
  // Mnemonic State
  const [mnemonic, setMnemonic] = useState('');
  
  // Private Key State
  const [privateKey, setPrivateKey] = useState('');
  const [chainType, setChainType] = useState('evm');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Check if we're adding a wallet while already unlocked
  const [sessionPassword, setSessionPassword] = useState<string | null>(null);
  const isAddingWallet = isUnlocked && sessionPassword !== null;

  useEffect(() => {
    if (isUnlocked) {
      const pwd = walletBridge.getSessionPassword();
      setSessionPassword(pwd);
    }
  }, [isUnlocked]);

  // Validation
  const isValidMnemonic = () => {
    const wordCount = mnemonic.trim().split(/\s+/).filter(Boolean).length;
    return wordCount === 12 || wordCount === 24;
  };

  const isValidPrivateKey = () => {
    return privateKey.trim().length > 0;
  };

  const isNameValid = walletName.length >= 1 && walletName.length <= 12;
  const isPasswordValid = isAddingWallet ? true : (password.length >= 8 && password === confirmPassword);

  const isValid = isNameValid && isPasswordValid && (
    importType === 'mnemonic' ? isValidMnemonic() : isValidPrivateKey()
  );

  const handleImport = async () => {
    if (!isValid || isLoading) return;

    try {
      const passwordToUse = isAddingWallet ? sessionPassword! : password;
      const finalName = walletName || 'default';

      if (importType === 'mnemonic') {
        const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
        await importWallet(normalizedMnemonic, passwordToUse, finalName);
      } else {
        // Import Private Key directly via bridge
        await walletBridge.importFromPrivateKey(
            privateKey.trim(),
            chainType as any,
            passwordToUse,
            finalName
        );
      }

      // Navigate to main app (refresh logic is handled by store/bridge)
      router.replace('/(tabs)/wallet');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to import wallet.');
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

        {/* Tabs */}
        <View className="flex-row bg-gray-900 rounded-xl p-1 mb-6">
            <TouchableOpacity 
                className={`flex-1 py-3 rounded-lg ${importType === 'mnemonic' ? 'bg-gray-800' : ''}`}
                onPress={() => setImportType('mnemonic')}
            >
                <Text className={`text-center font-medium ${importType === 'mnemonic' ? 'text-white' : 'text-gray-500'}`}>
                    Recovery Phrase
                </Text>
            </TouchableOpacity>
            <TouchableOpacity 
                className={`flex-1 py-3 rounded-lg ${importType === 'privateKey' ? 'bg-gray-800' : ''}`}
                onPress={() => setImportType('privateKey')}
            >
                <Text className={`text-center font-medium ${importType === 'privateKey' ? 'text-white' : 'text-gray-500'}`}>
                    Private Key
                </Text>
            </TouchableOpacity>
        </View>

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

        {importType === 'mnemonic' ? (
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
            <Text className={`text-xs mt-1 ${isValidMnemonic() ? 'text-green-400' : 'text-gray-500'}`}>
                {mnemonic.trim().split(/\s+/).filter(Boolean).length} / 12 or 24 words
            </Text>
            </View>
        ) : (
            <>
                {/* Chain Selector */}
                <View className="mb-4">
                    <Text className="text-white mb-2">Chain Type</Text>
                    <View className="flex-row flex-wrap gap-2">
                        {['evm', 'bitcoin', 'solana', 'xrp', 'ton'].map((type) => (
                            <TouchableOpacity
                                key={type}
                                onPress={() => setChainType(type)}
                                className={`px-4 py-2 rounded-full border ${
                                    chainType === type 
                                    ? 'bg-purple-600 border-purple-600' 
                                    : 'bg-gray-900 border-gray-800'
                                }`}
                            >
                                <Text className={`text-sm font-medium ${chainType === type ? 'text-white' : 'text-gray-400'}`}>
                                    {type === 'evm' ? 'EVM' : type.charAt(0).toUpperCase() + type.slice(1)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <View className="mb-4">
                    <Text className="text-white mb-2">Private Key</Text>
                    <TextInput
                        value={privateKey}
                        onChangeText={setPrivateKey}
                        placeholder={
                            chainType === 'evm' ? 'Hex string (0x...)' : 
                            chainType === 'solana' ? 'Base58 string' : 
                            chainType === 'bitcoin' ? 'WIF format' : 
                            'Raw key format'
                        }
                        placeholderTextColor="#6b7280"
                        multiline
                        numberOfLines={3}
                        autoCapitalize="none"
                        autoCorrect={false}
                        className="bg-gray-900 rounded-xl px-4 py-4 text-white min-h-[100px]"
                        textAlignVertical="top"
                    />
                </View>
            </>
        )}

        {/* Only show password fields if creating first wallet */}
        {!isAddingWallet && (
          <>
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

        {/* Info banner */}
        {isAddingWallet && (
          <View className="bg-purple-900/30 rounded-xl p-4 mb-6 flex-row items-center">
            <Ionicons name="lock-closed" size={20} color="#a78bfa" />
            <Text className="text-purple-300 ml-3 flex-1">
              This wallet will be encrypted with your master password
            </Text>
          </View>
        )}

        <View className="bg-yellow-500/10 rounded-xl p-4 mb-6">
          <View className="flex-row items-center mb-2">
            <Ionicons name="warning-outline" size={20} color="#eab308" />
            <Text className="text-yellow-500 font-semibold ml-2">Important</Text>
          </View>
          <Text className="text-yellow-500/80 text-sm">
            {importType === 'mnemonic' 
                ? 'Never share your recovery phrase with anyone.' 
                : 'Never share your private key with anyone. This grants full access to your funds.'}
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
                Importing...
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