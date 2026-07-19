/**
 * @fileoverview First-run "get started with Alchemy" onboarding screen.
 * Shown before wallet create/import when no Alchemy key is configured and
 * the user hasn't previously skipped. Mirrors the CLI and extension flows.
 */

import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AlchemyKeySetup from '../../components/AlchemyKeySetup';
import { setSetupDismissed } from '../../services/alchemyKeyStore';

export default function AlchemySetupScreen() {
  const router = useRouter();

  const goToWelcome = () => router.replace('/(auth)/welcome');

  return (
    <SafeAreaView className="flex-1 bg-gray-950 px-6">
      <View className="items-center mt-12 mb-6">
        <View className="w-20 h-20 rounded-full bg-purple-600 items-center justify-center mb-4">
          <Ionicons name="key" size={40} color="white" />
        </View>
        <Text className="text-white text-2xl font-bold text-center">
          Get started with Alchemy
        </Text>
      </View>

      <AlchemyKeySetup
        variant="onboarding"
        onSaved={goToWelcome}
        onSkip={() => {
          setSetupDismissed();
          goToWelcome();
        }}
      />
    </SafeAreaView>
  );
}
