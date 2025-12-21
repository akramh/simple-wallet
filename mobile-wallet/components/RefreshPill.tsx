import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface RefreshPillProps {
  isRefreshing: boolean;
  label?: string;
}

export function RefreshPill({ isRefreshing, label = 'Refreshing...' }: RefreshPillProps) {
  const insets = useSafeAreaInsets();

  if (!isRefreshing) return null;

  return (
    <View 
      style={{ top: insets.top + 8 }}
      className="absolute left-0 right-0 z-50 items-center"
    >
      <View className="bg-surface/90 px-4 py-2 rounded-full border border-brand/30 flex-row items-center shadow-2xl backdrop-blur-md">
        <ActivityIndicator size="small" color="#a855f7" />
        <Text className="text-text-primary text-xs font-medium ml-2">{label}</Text>
      </View>
    </View>
  );
}
