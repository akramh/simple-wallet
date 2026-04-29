/**
 * @fileoverview Tab-bar press feedback: light haptic + brief press-down scale.
 *
 * Wired via `screenOptions.tabBarButton` in `app/(tabs)/_layout.tsx`. The
 * focus state animation (icon scale-up + tinted pill halo) lives in the
 * sibling `AnimatedTabIcon` component, so this button stays focused on the
 * press interaction itself and never touches navigation behavior — `onPress`
 * is forwarded unchanged to react-navigation.
 */

import { Pressable, type GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

const PRESS_DURATION_MS = 90;

export function AnimatedTabButton(props: BottomTabBarButtonProps) {
  const {
    children,
    onPress,
    accessibilityState,
    accessibilityLabel,
    accessibilityRole,
    accessibilityHint,
    testID,
    style,
  } = props;
  const press = useSharedValue(1);

  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  const handlePressIn = () => {
    press.value = withTiming(0.92, {
      duration: PRESS_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
    // selectionAsync is the lightest of the haptic options — a quiet "tick"
    // appropriate for navigation, vs heavier impact / notification kinds.
    Haptics.selectionAsync().catch(() => {
      /* haptics are best-effort; ignore unsupported devices */
    });
  };

  const handlePressOut = () => {
    press.value = withTiming(1, {
      duration: PRESS_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
  };

  return (
    <Pressable
      onPress={onPress as ((e: GestureResponderEvent) => void) | undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityHint={accessibilityHint}
      testID={testID}
      android_ripple={null}
      style={[
        style,
        {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Animated.View
        style={[
          {
            flex: 1,
            alignSelf: 'stretch',
            alignItems: 'center',
            justifyContent: 'center',
          },
          wrapperStyle,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
