/**
 * @fileoverview Root layout for Expo Router.
 *
 * This layout wraps the entire app with:
 * - NativeWind styling
 * - QueryClient for React Query
 * - Safe area handling
 * - Wallet initialization
 *
 * Note: Crypto polyfill is loaded in index.js (app entry point) before expo-router.
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWalletStore } from '../store';
import { ToastProvider } from '../contexts';

import '../global.css';

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      retry: 2,
    },
  },
});

export default function RootLayout() {
  const { initialize, isInitialized } = useWalletStore();

  useEffect(() => {
    // Initialize wallet on app start
    initialize();
  }, [initialize]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <View className="flex-1 bg-gray-950">
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: '#030712' }, // gray-950
              }}
            >
              {/* Auth flow screens */}
              <Stack.Screen
                name="(auth)"
                options={{
                  headerShown: false,
                }}
              />
            {/* Main tab navigation */}
            <Stack.Screen
              name="(tabs)"
              options={{
                headerShown: false,
              }}
            />
            {/* Modal screens */}
            <Stack.Screen
              name="send"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="receive"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="network-select"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen
              name="secret-phrase"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
        </View>
        </ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
