/**
 * @fileoverview Wallet setup flow layout.
 */

import { Stack } from 'expo-router';

export default function SetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#030712' },
      }}
    >
      <Stack.Screen name="create" />
      <Stack.Screen name="import" />
      <Stack.Screen
        name="backup"
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
    </Stack>
  );
}
