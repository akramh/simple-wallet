/**
 * @fileoverview Price chart component for token detail screen.
 *
 * A lightweight SVG-based line chart that displays price history data.
 * Uses react-native-svg directly to avoid additional dependencies.
 *
 * @features
 * - Animated line drawing on mount
 * - Touch interaction to show price at specific point
 * - Dynamic color based on price trend (green/red)
 * - Gradient fill under the line
 * - Loading and empty states
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, Dimensions, ActivityIndicator } from 'react-native';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Circle,
  Line,
  G,
} from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import type { PricePoint } from '../services';

// ============================================================================
// Types
// ============================================================================

interface PriceChartProps {
  /** Price history data points */
  data: PricePoint[];
  /** Whether the overall trend is positive */
  isPositive: boolean;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Chart height in pixels */
  height?: number;
  /** Whether to show touch indicator */
  showTouch?: boolean;
  /** Callback when user touches a point */
  onTouchPoint?: (point: PricePoint | null) => void;
}

interface ChartDimensions {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_COLORS = {
  positive: '#22c55e', // green-500
  negative: '#ef4444', // red-500
  positiveGradient: 'rgba(34, 197, 94, 0.2)',
  negativeGradient: 'rgba(239, 68, 68, 0.2)',
  grid: '#374151', // gray-700
  text: '#9ca3af', // gray-400
  touchLine: '#a855f7', // purple-500
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate min and max values with padding
 */
function getMinMax(data: PricePoint[]): { min: number; max: number } {
  if (data.length === 0) return { min: 0, max: 0 };

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Add 5% padding
  const padding = (max - min) * 0.05;
  return {
    min: min - padding,
    max: max + padding,
  };
}

/**
 * Convert data point to SVG coordinates
 */
function dataToSvg(
  point: PricePoint,
  index: number,
  data: PricePoint[],
  dimensions: ChartDimensions,
  minMax: { min: number; max: number }
): { x: number; y: number } {
  const { width, height, paddingTop, paddingBottom, paddingLeft, paddingRight } = dimensions;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const x = paddingLeft + (index / (data.length - 1)) * chartWidth;
  const y =
    paddingTop +
    chartHeight -
    ((point.price - minMax.min) / (minMax.max - minMax.min)) * chartHeight;

  return { x, y };
}

/**
 * Generate SVG path string for the line
 */
function generateLinePath(
  data: PricePoint[],
  dimensions: ChartDimensions,
  minMax: { min: number; max: number }
): string {
  if (data.length < 2) return '';

  const points = data.map((point, index) =>
    dataToSvg(point, index, data, dimensions, minMax)
  );

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }

  return path;
}

/**
 * Generate SVG path string for the gradient fill area
 */
function generateAreaPath(
  data: PricePoint[],
  dimensions: ChartDimensions,
  minMax: { min: number; max: number }
): string {
  if (data.length < 2) return '';

  const { height, paddingBottom, paddingLeft, paddingRight, width } = dimensions;
  const chartBottom = height - paddingBottom;

  const points = data.map((point, index) =>
    dataToSvg(point, index, data, dimensions, minMax)
  );

  let path = `M ${paddingLeft} ${chartBottom}`;
  path += ` L ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }

  path += ` L ${width - paddingRight} ${chartBottom}`;
  path += ' Z';

  return path;
}

/**
 * Find the closest data point to a touch position
 */
function findClosestPoint(
  touchX: number,
  data: PricePoint[],
  dimensions: ChartDimensions
): { point: PricePoint; index: number; x: number; y: number } | null {
  if (data.length === 0) return null;

  const { width, paddingLeft, paddingRight } = dimensions;
  const chartWidth = width - paddingLeft - paddingRight;

  // Calculate which index the touch corresponds to
  const relativeX = touchX - paddingLeft;
  const index = Math.round((relativeX / chartWidth) * (data.length - 1));
  const clampedIndex = Math.max(0, Math.min(data.length - 1, index));

  const point = data[clampedIndex];
  const minMax = getMinMax(data);
  const { x, y } = dataToSvg(point, clampedIndex, data, dimensions, minMax);

  return { point, index: clampedIndex, x, y };
}

// ============================================================================
// Main Component
// ============================================================================

export function PriceChart({
  data,
  isPositive,
  isLoading = false,
  height = 180,
  showTouch = true,
  onTouchPoint,
}: PriceChartProps) {
  const screenWidth = Dimensions.get('window').width;
  const [touchData, setTouchData] = useState<{
    point: PricePoint;
    x: number;
    y: number;
  } | null>(null);

  const dimensions: ChartDimensions = {
    width: screenWidth - 32, // Account for mx-4 padding
    height,
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 8,
    paddingRight: 8,
  };

  const lineColor = isPositive ? CHART_COLORS.positive : CHART_COLORS.negative;
  const gradientId = isPositive ? 'positiveGradient' : 'negativeGradient';

  // Animation
  const animationProgress = useSharedValue(0);

  useEffect(() => {
    if (data.length > 0) {
      animationProgress.value = 0;
      animationProgress.value = withTiming(1, {
        duration: 800,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [data]);

  // Memoized calculations
  const minMax = useMemo(() => getMinMax(data), [data]);
  const linePath = useMemo(
    () => generateLinePath(data, dimensions, minMax),
    [data, dimensions, minMax]
  );
  const areaPath = useMemo(
    () => generateAreaPath(data, dimensions, minMax),
    [data, dimensions, minMax]
  );

  // Touch gesture
  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (!showTouch || data.length === 0) return;
      const result = findClosestPoint(e.x, data, dimensions);
      if (result) {
        setTouchData({ point: result.point, x: result.x, y: result.y });
        onTouchPoint?.(result.point);
      }
    })
    .onUpdate((e) => {
      if (!showTouch || data.length === 0) return;
      const result = findClosestPoint(e.x, data, dimensions);
      if (result) {
        setTouchData({ point: result.point, x: result.x, y: result.y });
        onTouchPoint?.(result.point);
      }
    })
    .onEnd(() => {
      setTouchData(null);
      onTouchPoint?.(null);
    });

  // Loading state
  if (isLoading) {
    return (
      <View
        style={{ height }}
        className="items-center justify-center bg-gray-900 rounded-xl"
      >
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  // Empty state
  if (data.length < 2) {
    return (
      <View
        style={{ height }}
        className="items-center justify-center bg-gray-900 rounded-xl"
      >
        <Text className="text-gray-500">No chart data available</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={panGesture}>
        <View className="bg-gray-900 rounded-xl overflow-hidden">
          <Svg width={dimensions.width} height={dimensions.height}>
            <Defs>
              <LinearGradient id="positiveGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={CHART_COLORS.positive} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={CHART_COLORS.positive} stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={CHART_COLORS.negative} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={CHART_COLORS.negative} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* Gradient fill */}
            <Path d={areaPath} fill={`url(#${gradientId})`} />

            {/* Line */}
            <Path
              d={linePath}
              stroke={lineColor}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Touch indicator */}
            {touchData && showTouch && (
              <G>
                {/* Vertical line */}
                <Line
                  x1={touchData.x}
                  y1={dimensions.paddingTop}
                  x2={touchData.x}
                  y2={dimensions.height - dimensions.paddingBottom}
                  stroke={CHART_COLORS.touchLine}
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
                {/* Point circle */}
                <Circle
                  cx={touchData.x}
                  cy={touchData.y}
                  r={6}
                  fill={lineColor}
                  stroke="white"
                  strokeWidth={2}
                />
              </G>
            )}
          </Svg>

          {/* Touch price display */}
          {touchData && showTouch && (
            <View className="absolute top-2 left-0 right-0 items-center">
              <View className="bg-gray-800 px-3 py-1 rounded-full">
                <Text className="text-white text-sm font-medium">
                  ${touchData.point.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>
            </View>
          )}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

export default PriceChart;
