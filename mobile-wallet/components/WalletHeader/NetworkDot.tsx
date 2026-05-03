/**
 * @fileoverview Small colored circle that prefixes a network's name in the
 * WalletHeader strip. Color comes from {@link networkDotColor}.
 */

import React from 'react';
import { View } from 'react-native';
import { networkDotColor } from './constants';

export interface NetworkDotProps {
  networkKey: string;
  size?: number;
}

export function NetworkDot({ networkKey, size = 8 }: NetworkDotProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: networkDotColor(networkKey),
        flexShrink: 0,
      }}
    />
  );
}
