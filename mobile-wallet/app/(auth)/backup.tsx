/**
 * @fileoverview Backup recovery phrase screen.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

export default function BackupScreen() {
  const router = useRouter();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const words = mnemonic?.split(' ') || [];

  const handleCopy = async () => {
    if (!mnemonic) return;
    await Clipboard.setStringAsync(mnemonic);
    Alert.alert('Copied', 'Recovery phrase copied to clipboard. Store it safely!');
  };

  const handleContinue = () => {
    if (!confirmed) {
      Alert.alert(
        'Confirm Backup',
        'Have you saved your recovery phrase in a safe place?',
        [
          { text: 'Not Yet', style: 'cancel' },
          {
            text: 'Yes, I Saved It',
            onPress: () => {
              router.replace('/(tabs)/wallet');
            },
          },
        ]
      );
    } else {
      router.replace('/(tabs)/wallet');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
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
            • Never share your recovery phrase with anyone{'\n'}
            • Never enter it on any website{'\n'}
            • Store it offline in a secure location{'\n'}
            • Anyone with this phrase can access your funds
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
                className="flex-row items-center justify-center mt-4 py-3 bg-gray-800 rounded-xl"
              >
                <Ionicons name="copy-outline" size={18} color="#a855f7" />
                <Text className="text-purple-400 ml-2">Copy to Clipboard</Text>
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
          disabled={!revealed}
          className={`rounded-xl py-4 mb-8 ${
            revealed ? 'bg-purple-600' : 'bg-gray-800'
          }`}
        >
          <Text className="text-white font-semibold text-center text-lg">
            {confirmed ? 'Continue to Wallet' : 'I\'ve Saved It'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
