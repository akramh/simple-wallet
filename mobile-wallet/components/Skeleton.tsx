import React, { useEffect, useRef } from 'react';
import { View, Animated, ViewStyle } from 'react-native';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: ViewStyle;
  className?: string;
}

export function Skeleton({ 
  width = '100%', 
  height = 20, 
  borderRadius = 8,
  style,
  className 
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      className={`bg-surface-highlight ${className}`}
      style={[
        {
          width: width as any,
          height: height as any,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}
