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
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useWalletStore } from '../store';
import { ToastProvider } from '../contexts';
import { useBackgroundRefresh } from '../hooks';
import { BackgroundNotificationService } from '../services/BackgroundNotificationService';

import '../global.css';

// Configure notifications to show even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // Deprecated but often still needed for compat, keeping 'true' or removing if fully replaced by banner
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
  const router = useRouter();
  const segments = useSegments();
  const segmentList = segments as string[];
  const { initialize, isInitialized, hasWallet, isUnlocked, pendingBackup } = useWalletStore();

  // Enable background refresh polling when wallet is unlocked
  useBackgroundRefresh();

  useEffect(() => {
    // Initialize wallet on app start
    initialize();
  }, [initialize]);

  useEffect(() => {
    // Setup notifications
    const setupNotifications = async () => {
      try {
        const hasPermission = await BackgroundNotificationService.requestPermissions();
        if (hasPermission) {
          await BackgroundNotificationService.register();
        }
      } catch (e) {
        console.error('[RootLayout] Error setting up notifications:', e);
      }
    };
    setupNotifications();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    const inAuthGroup = segmentList[0] === '(auth)';
    const inSetupGroup = segmentList[0] === '(setup)';
    const route = segmentList[1];
    const isBackupScreen = inSetupGroup && route === 'backup';
    const isUnlockScreen = inAuthGroup && route === 'unlock';

    if (pendingBackup) {
      if (!isUnlocked && !isUnlockScreen) {
        router.replace('/(auth)/unlock');
        return;
      }
      if (isUnlocked && !isBackupScreen) {
        router.replace('/(setup)/backup');
      }
      return;
    }

    if (!hasWallet && !inAuthGroup && !inSetupGroup) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (hasWallet && !isUnlocked && !inAuthGroup) {
      router.replace('/(auth)/unlock');
      return;
    }

    if (hasWallet && isUnlocked && inAuthGroup) {
      router.replace('/(tabs)/wallet');
    }
  }, [isInitialized, hasWallet, isUnlocked, pendingBackup, router, segments]);

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
              {/* Wallet setup flow */}
              <Stack.Screen
                name="(setup)"
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
            <Stack.Screen
              name="manage-tokens"
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
