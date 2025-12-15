/**
 * @fileoverview App entry point - handles routing based on wallet state.
 */

import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, Text } from 'react-native';
import { useWalletStore } from '../store';

export default function Index() {
  const { isLoading, isInitialized, hasWallet, isUnlocked } = useWalletStore();

  // Show loading screen while initializing
  if (isLoading || !isInitialized) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-950">
        <ActivityIndicator size="large" color="#9333ea" />
        <Text className="mt-4 text-gray-400">Loading wallet...</Text>
      </View>
    );
  }

  // No wallet? → Onboarding
  if (!hasWallet) {
    return <Redirect href="/(auth)/welcome" />;
  }

  // Has wallet but locked? → Unlock screen
  if (!isUnlocked) {
    return <Redirect href="/(auth)/unlock" />;
  }

  // Unlocked → Main app
  return <Redirect href="/(tabs)/wallet" />;
}
