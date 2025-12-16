/**
 * @fileoverview Empty state placeholder component.
 */

import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <View className="items-center py-16 px-8">
      <View className="w-20 h-20 rounded-full bg-gray-800 items-center justify-center mb-4">
        <Ionicons name={icon} size={40} color="#4b5563" />
      </View>
      <Text className="text-gray-400 text-lg font-medium text-center mb-2">
        {title}
      </Text>
      {description && (
        <Text className="text-gray-500 text-sm text-center mb-4">
          {description}
        </Text>
      )}
      {action}
    </View>
  );
}
