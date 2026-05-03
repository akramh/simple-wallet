/**
 * @fileoverview Deterministic gradient avatar for wallet/account identity.
 *
 * Matches the design hand-off's `Blockie` (mobile/components.jsx:127). Renders
 * a circle filled with a 135deg linear gradient picked from a 4-palette table
 * keyed off the first two character codes of the seed.
 *
 * Backed by `react-native-svg` (already a dependency) so we don't add a new
 * native module. The Svg is wrapped in a fixed-size `View` so it cannot grab
 * row width when used as a flex child (some RN versions let `<Svg>` flex-grow
 * which broke the parent chip's row layout).
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { BLOCKIE_PALETTES, paletteIndexForSeed } from './constants';

export interface BlockieProps {
  /** Seed string. Same seed → same gradient. */
  seed: string;
  /** Diameter in px. Defaults to 24. */
  size?: number;
}

/**
 * Renders a circular gradient avatar. Pure visual — no interaction.
 *
 * @param seed - Stable identifier (e.g. `walletName + ':' + accountIndex`).
 * @param size - Diameter in pixels (default 24).
 */
export function Blockie({ seed, size = 24 }: BlockieProps) {
  const idx = paletteIndexForSeed(seed);
  const [a, b] = BLOCKIE_PALETTES[idx];
  const gradId = `blockie-${idx}-${size}`;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        flexShrink: 0,
        flexGrow: 0,
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 1 1">
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} stopOpacity="1" />
            <Stop offset="1" stopColor={b} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${gradId})`} />
      </Svg>
    </View>
  );
}
