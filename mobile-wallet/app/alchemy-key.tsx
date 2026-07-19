/**
 * @fileoverview Settings screen for managing the Alchemy API key
 * (view masked status, update, remove). Reached from Profile → Alchemy
 * API Key.
 */

import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AlchemyKeySetup from '../components/AlchemyKeySetup';
import { safeGoBack } from '../utils/navigation';

export default function AlchemyKeyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-gray-950">
      {/* Header */}
      <View className="flex-row items-center px-5 py-3">
        <TouchableOpacity
          onPress={() => safeGoBack(router)}
          className="w-10 h-10 rounded-full bg-gray-900 items-center justify-center mr-3"
        >
          <Ionicons name="arrow-back" size={20} color="white" />
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Alchemy API Key</Text>
      </View>

      <ScrollView className="flex-1 px-5 pt-2" keyboardShouldPersistTaps="handled">
        <AlchemyKeySetup variant="settings" />
      </ScrollView>
    </SafeAreaView>
  );
}
