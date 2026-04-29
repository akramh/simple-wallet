/**
 * @fileoverview Tab navigation layout for main app screens.
 *
 * - `lazy: false` pre-mounts every tab during the first focus so subsequent
 *   tab presses are instant (no first-mount RPC fan-out delay). Data fetches
 *   inside each tab remain gated by a 30s freshness check + `useFocusEffect`.
 * - `tabBarButton: AnimatedTabButton` adds a light selection haptic and a
 *   brief press-down scale on every tab press.
 * - `tabBarIcon: AnimatedTabIcon` adds a tinted purple pill halo + ~8%
 *   icon scale-up on the focused tab.
 */

import { Tabs } from 'expo-router';
import { AnimatedTabButton, AnimatedTabIcon } from '../../components';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: false,
        tabBarButton: (props) => <AnimatedTabButton {...props} />,
        tabBarStyle: {
          backgroundColor: '#111827', // gray-900
          borderTopColor: '#1f2937', // gray-800
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: 24,
          height: 80,
        },
        tabBarActiveTintColor: '#a855f7', // purple-500
        tabBarInactiveTintColor: '#6b7280', // gray-500
        tabBarLabelStyle: {
          fontSize: 12,
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon name="wallet-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon name="time-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon name="pie-chart-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color, size }) => (
            <AnimatedTabIcon name="person-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
