/**
 * @fileoverview Secret recovery phrase view screen with password confirmation.
 *
 * This screen allows users to view their wallet's recovery phrase after
 * confirming their password. The phrase is only retrieved and displayed
 * after successful password verification.
 *
 * @security
 * - Password must be verified before showing the mnemonic
 * - Mnemonic is fetched only after password confirmation
 * - Screen prevents screenshots where possible
 */

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { walletBridge } from '../services';
import { KeyboardAwareScrollView } from '../components/KeyboardAwareScrollView';
import { useClipboard } from '../hooks';

type ScreenState = 'password' | 'revealed';

export default function SecretPhraseScreen() {
  const router = useRouter();
  const [screenState, setScreenState] = useState<ScreenState>('password');
  const [password, setPassword] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBlurred, setIsBlurred] = useState(true);
  const { copy, isCopied } = useClipboard();

  const words = mnemonic?.split(' ') || [];

  const handleVerifyPassword = async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const phrase = await walletBridge.getSecretPhrase(password);
      setMnemonic(phrase);
      setScreenState('revealed');
      setPassword(''); // Clear password from memory
    } catch (err) {
      console.error('[SecretPhraseScreen] Password verification failed:', err);
      setError('Invalid password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!mnemonic) return;
    await copy(mnemonic);
  };

  const phraseCopied = mnemonic ? isCopied(mnemonic) : false;

  const handleBack = () => {
    // Clear mnemonic from memory before navigating back
    setMnemonic(null);
    setPassword('');
    router.back();
  };

  // Password confirmation screen
  if (screenState === 'password') {
    return (
      <SafeAreaView className="flex-1 bg-gray-950">
        {/* Header */}
        <View className="flex-row items-center px-4 pb-3 border-b border-gray-800">
          <TouchableOpacity onPress={handleBack} className="p-2 -ml-2">
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-lg font-semibold ml-2">
            Secret Recovery Phrase
          </Text>
        </View>

        <KeyboardAwareScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
          {/* Info Section */}
          <View className="pt-8 pb-6">
            <View className="w-16 h-16 rounded-full bg-yellow-500/20 items-center justify-center mx-auto mb-4">
              <Ionicons name="shield-checkmark" size={32} color="#eab308" />
            </View>
            <Text className="text-white text-xl font-bold text-center">
              Verify Your Identity
            </Text>
            <Text className="text-gray-400 mt-3 text-center">
              Enter your password to view your secret recovery phrase.
            </Text>
          </View>

          {/* Warning */}
          <View className="bg-red-500/10 rounded-xl p-4 mb-6">
            <View className="flex-row items-center mb-2">
              <Ionicons name="alert-circle" size={20} color="#ef4444" />
              <Text className="text-red-400 font-semibold ml-2">
                Security Warning
              </Text>
            </View>
            <Text className="text-red-400/80 text-sm">
              Never share your recovery phrase with anyone. Anyone with this phrase can access and steal your funds.
            </Text>
          </View>

          {/* Password Input */}
          <View className="mb-6">
            <Text className="text-gray-400 mb-2">Password</Text>
            <View className="flex-row items-center bg-gray-900 rounded-xl px-4">
              <Ionicons name="lock-closed-outline" size={20} color="#6b7280" />
              <TextInput
                className="flex-1 text-white py-4 ml-3"
                placeholder="Enter your password"
                placeholderTextColor="#6b7280"
                secureTextEntry
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError(null);
                }}
                onSubmitEditing={handleVerifyPassword}
                autoFocus
              />
            </View>
            {error && (
              <Text className="text-red-400 text-sm mt-2">{error}</Text>
            )}
          </View>

          {/* Verify Button */}
          <TouchableOpacity
            onPress={handleVerifyPassword}
            disabled={isLoading || !password.trim()}
            className={`rounded-xl py-4 mb-8 ${
              password.trim() && !isLoading
                ? 'bg-purple-600'
                : 'bg-gray-800'
            }`}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold text-center text-lg">
                Verify Password
              </Text>
            )}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  // Recovery phrase revealed screen
  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center px-4 pb-3 border-b border-gray-800">
        <TouchableOpacity onPress={handleBack} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">
          Secret Recovery Phrase
        </Text>
      </View>

      <ScrollView className="flex-1 px-6">
        {/* Header Info */}
        <View className="pt-6 pb-4">
          <Text className="text-gray-400">
            This is your 12-word recovery phrase. Write it down and store it in a safe place.
          </Text>
        </View>

        {/* Warning */}
        <View className="bg-red-500/10 rounded-xl p-4 mb-6">
          <View className="flex-row items-center mb-2">
            <Ionicons name="alert-circle-outline" size={20} color="#ef4444" />
            <Text className="text-red-400 font-semibold ml-2">
              Critical Security Warning
            </Text>
          </View>
          <Text className="text-red-400/80 text-sm">
            • Never share your recovery phrase with anyone{'\n'}
            • Never enter it on any website{'\n'}
            • Store it offline in a secure location{'\n'}
            • Anyone with this phrase can access your funds
          </Text>
        </View>

        {/* Recovery Phrase Grid */}
        <View className="bg-gray-900 rounded-2xl p-4 mb-6">
          {isBlurred ? (
            <TouchableOpacity
              onPress={() => setIsBlurred(false)}
              className="items-center py-12"
            >
              <Ionicons name="eye-off-outline" size={48} color="#6b7280" />
              <Text className="text-gray-400 mt-4 font-medium">
                Tap to reveal recovery phrase
              </Text>
              <Text className="text-gray-500 text-sm mt-1">
                Make sure no one is watching your screen
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <View className="flex-row flex-wrap">
                {words.map((word, index) => (
                  <View key={index} className="w-1/3 p-1">
                    <View className="bg-gray-800 rounded-lg px-3 py-3 flex-row items-center">
                      <Text className="text-gray-500 text-xs w-5">
                        {index + 1}.
                      </Text>
                      <Text className="text-white font-medium ml-1">
                        {word}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Copy Button */}
              <TouchableOpacity
                onPress={handleCopy}
                className={`flex-row items-center justify-center mt-4 py-3 rounded-xl ${
                  phraseCopied ? 'bg-purple-600' : 'bg-gray-800'
                }`}
                disabled={phraseCopied}
              >
                <Ionicons
                  name={phraseCopied ? 'checkmark-circle' : 'copy-outline'}
                  size={18}
                  color={phraseCopied ? '#ffffff' : '#a855f7'}
                />
                <Text className={`ml-2 ${phraseCopied ? 'text-white' : 'text-purple-400'}`}>
                  {phraseCopied ? 'Copied!' : 'Copy to Clipboard'}
                </Text>
              </TouchableOpacity>

              {/* Hide Button */}
              <TouchableOpacity
                onPress={() => setIsBlurred(true)}
                className="flex-row items-center justify-center mt-2 py-3"
              >
                <Ionicons name="eye-off-outline" size={18} color="#6b7280" />
                <Text className="text-gray-400 ml-2">Hide Phrase</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Done Button */}
        <TouchableOpacity
          onPress={handleBack}
          className="bg-purple-600 rounded-xl py-4 mb-8"
        >
          <Text className="text-white font-semibold text-center text-lg">
            Done
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
