/**
 * @fileoverview Welcome/onboarding screen.
 */

import { View, Text, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-gray-950 px-6">
      {/* Logo / Hero */}
      <View className="flex-1 items-center justify-center">
        <View className="w-24 h-24 rounded-full bg-purple-600 items-center justify-center mb-6">
          <Ionicons name="wallet" size={48} color="white" />
        </View>
        <Text className="text-white text-3xl font-bold text-center">
          Simple Wallet
        </Text>
        <Text className="text-gray-400 text-center mt-3 px-6">
          Your secure gateway to Web3. Store, send, and manage your crypto assets.
        </Text>
      </View>

      {/* Features */}
      <View className="mb-8">
        <FeatureItem
          icon="shield-checkmark-outline"
          title="Secure & Private"
          description="Your keys never leave your device"
        />
        <FeatureItem
          icon="globe-outline"
          title="Multi-Chain"
          description="Ethereum, Bitcoin, Solana & more"
        />
        <FeatureItem
          icon="flash-outline"
          title="Fast & Simple"
          description="Easy to use, no hassle"
        />
      </View>

      {/* Action Buttons */}
      <View className="pb-4">
        <TouchableOpacity
          onPress={() => router.push('/(setup)/create')}
          className="bg-purple-600 rounded-xl py-4 mb-3"
        >
          <Text className="text-white font-semibold text-center text-lg">
            Create New Wallet
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(setup)/import')}
          className="bg-gray-800 rounded-xl py-4"
        >
          <Text className="text-white font-semibold text-center text-lg">
            Import Existing Wallet
          </Text>
        </TouchableOpacity>
      </View>

      {/* Terms */}
      <Text className="text-gray-500 text-xs text-center pb-4">
        By continuing, you agree to our Terms of Service and Privacy Policy
      </Text>
    </SafeAreaView>
  );
}

function FeatureItem({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  return (
    <View className="flex-row items-center py-3">
      <View className="w-12 h-12 rounded-full bg-purple-600/20 items-center justify-center mr-4">
        <Ionicons name={icon} size={24} color="#a855f7" />
      </View>
      <View className="flex-1">
        <Text className="text-white font-medium">{title}</Text>
        <Text className="text-gray-500 text-sm">{description}</Text>
      </View>
    </View>
  );
}
