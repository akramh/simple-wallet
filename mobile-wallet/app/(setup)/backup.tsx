/**
 * @fileoverview Backup recovery phrase screen.
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWalletStore } from '../../store';
import { useClipboard } from '../../hooks';
import { safeGoBack } from '../../utils/navigation';

export default function BackupScreen() {
  const router = useRouter();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();
  const { setPendingBackup } = useWalletStore();
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { copy, isCopied } = useClipboard();

  const words = mnemonic?.split(' ') || [];
// Prevent accidental back navigation
  useEffect(() => {
    const onBackPress = () => {
      Alert.alert(
        'Wait!',
        'You need to back up your recovery phrase before leaving. If you leave now, you may lose access to your wallet forever.',
        [
          { text: 'Stay', style: 'cancel', onPress: () => {} },
          { 
            text: 'Leave Anyway', 
            style: 'destructive', 
            onPress: () => safeGoBack(router)
          },
        ]
      );
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, []);

  
  const handleCopy = async () => {
    if (!mnemonic) return;
    await copy(mnemonic);
  };

  const phraseCopied = mnemonic ? isCopied(mnemonic) : false;

  const handleContinue = () => {
    if (!confirmed) return;
    setPendingBackup(false);
    router.replace('/(tabs)/wallet');
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      <Stack.Screen options={{ gestureEnabled: false, headerLeft: () => null }} />
      <ScrollView className="flex-1 px-6">
        {/* Header */}
        <View className="pt-4 pb-6">
          <Text className="text-white text-2xl font-bold">
            Backup Your Wallet
          </Text>
          <Text className="text-gray-400 mt-2">
            Write down these 12 words in order and store them in a safe place.
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
            Keep this phrase safe and offline. Never share it. Anyone with it can steal your funds.
          </Text>
        </View>

        {/* Recovery Phrase Grid */}
        <View className="bg-gray-900 rounded-2xl p-4 mb-6">
          {!revealed ? (
            <TouchableOpacity
              onPress={() => setRevealed(true)}
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
                  <View
                    key={index}
                    className="w-1/3 p-1"
                  >
                    <View className="bg-gray-800 rounded-lg px-3 py-3 flex-row items-center">
                      <Text className="text-gray-500 text-xs w-5">{index + 1}.</Text>
                      <Text className="text-white font-medium ml-1">{word}</Text>
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
            </>
          )}
        </View>

        {/* Confirmation Checkbox */}
        {revealed && (
          <TouchableOpacity
            onPress={() => setConfirmed(!confirmed)}
            className="flex-row items-center mb-6"
          >
            <View
              className={`w-6 h-6 rounded border mr-3 items-center justify-center ${
                confirmed ? 'bg-purple-600 border-purple-600' : 'border-gray-600'
              }`}
            >
              {confirmed && <Ionicons name="checkmark" size={16} color="white" />}
            </View>
            <Text className="text-gray-400 flex-1">
              I have saved my recovery phrase in a safe place
            </Text>
          </TouchableOpacity>
        )}

        {/* Continue Button */}
        <TouchableOpacity
          onPress={handleContinue}
          disabled={!revealed || !confirmed}
          className={`rounded-xl py-4 mb-8 ${
            revealed && confirmed ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          <Text className="text-white font-semibold text-center text-lg">
            Continue to Wallet
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
