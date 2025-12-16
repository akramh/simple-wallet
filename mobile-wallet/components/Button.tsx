/**
 * @fileoverview Reusable button component with variants.
 */

import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, { bg: string; text: string }> = {
  primary: { bg: 'bg-purple-600', text: 'text-white' },
  secondary: { bg: 'bg-gray-800', text: 'text-white' },
  ghost: { bg: 'bg-transparent', text: 'text-purple-400' },
  danger: { bg: 'bg-red-500/20', text: 'text-red-400' },
};

const sizeStyles: Record<ButtonSize, { py: string; text: string; icon: number }> = {
  sm: { py: 'py-2', text: 'text-sm', icon: 16 },
  md: { py: 'py-3', text: 'text-base', icon: 18 },
  lg: { py: 'py-4', text: 'text-lg', icon: 20 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = true,
}: ButtonProps) {
  const { bg, text } = variantStyles[variant];
  const { py, text: textSize, icon: iconSize } = sizeStyles[size];

  const isDisabled = disabled || loading;
  const iconColor = variant === 'primary' ? 'white' : 
                    variant === 'danger' ? '#f87171' : '#a855f7';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      className={`
        ${bg} ${py} rounded-xl flex-row items-center justify-center
        ${fullWidth ? 'w-full' : ''}
        ${isDisabled ? 'opacity-50' : ''}
      `}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? 'white' : '#a855f7'} />
      ) : (
        <>
          {icon && iconPosition === 'left' && (
            <Ionicons name={icon} size={iconSize} color={iconColor} style={{ marginRight: 8 }} />
          )}
          <Text className={`${text} ${textSize} font-semibold`}>{title}</Text>
          {icon && iconPosition === 'right' && (
            <Ionicons name={icon} size={iconSize} color={iconColor} style={{ marginLeft: 8 }} />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
