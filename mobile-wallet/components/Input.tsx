/**
 * @fileoverview Reusable text input component.
 */

import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  isPassword?: boolean;
}

export function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  isPassword = false,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? 'border-red-500'
    : isFocused
    ? 'border-purple-500'
    : 'border-transparent';

  return (
    <View className="mb-4">
      {label && (
        <Text className="text-white mb-2 font-medium">{label}</Text>
      )}

      <View
        className={`
          flex-row items-center bg-gray-900 rounded-xl border ${borderColor}
        `}
      >
        {leftIcon && (
          <View className="pl-4">
            <Ionicons name={leftIcon} size={20} color="#6b7280" />
          </View>
        )}

        <TextInput
          {...props}
          secureTextEntry={isPassword && !showPassword}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          placeholderTextColor="#6b7280"
          className={`
            flex-1 px-4 py-4 text-white
            ${leftIcon ? 'pl-2' : ''}
            ${rightIcon || isPassword ? 'pr-2' : ''}
          `}
        />

        {isPassword && (
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            className="pr-4"
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#6b7280"
            />
          </TouchableOpacity>
        )}

        {rightIcon && !isPassword && (
          <TouchableOpacity
            onPress={onRightIconPress}
            className="pr-4"
            disabled={!onRightIconPress}
          >
            <Ionicons name={rightIcon} size={20} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <Text className="text-red-400 text-xs mt-1">{error}</Text>
      )}
      
      {hint && !error && (
        <Text className="text-gray-500 text-xs mt-1">{hint}</Text>
      )}
    </View>
  );
}
