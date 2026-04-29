/**
 * @fileoverview Animated tab-bar icon: tinted pill halo + scale on focus.
 *
 * Used inside `tabBarIcon` in `app/(tabs)/_layout.tsx`. Renders an Ionicons
 * glyph with a soft purple pill behind it that fades+scales in when the tab
 * is focused, and fades out when blurred. The icon itself scales up ~8% on
 * focus so the active tab feels physically "lifted".
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

const FOCUS_DURATION_MS = 180;
const PILL_SIZE = 44;
const PILL_TINT = 'rgba(168, 85, 247, 0.15)'; // purple-500 @ 15% — matches active tint #a855f7

type IconName = keyof typeof Ionicons.glyphMap;

interface AnimatedTabIconProps {
  name: IconName;
  size: number;
  color: string;
  focused: boolean;
}

export function AnimatedTabIcon({ name, size, color, focused }: AnimatedTabIconProps) {
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, {
      duration: FOCUS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [focused, focus]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [{ scale: 0.85 + focus.value * 0.15 }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focus.value * 0.08 }],
  }));

  return (
    <View
      style={{
        width: PILL_SIZE,
        height: PILL_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: PILL_SIZE,
            height: PILL_SIZE,
            borderRadius: PILL_SIZE / 2,
            backgroundColor: PILL_TINT,
          },
          pillStyle,
        ]}
      />
      <Animated.View style={iconStyle}>
        <Ionicons name={name} size={size} color={color} />
      </Animated.View>
    </View>
  );
}
