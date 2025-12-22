/**
 * @fileoverview Auth flow layout.
 */

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#030712' },
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="unlock" />
    </Stack>
  );
}
