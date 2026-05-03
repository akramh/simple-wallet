/**
 * @fileoverview A single segment inside the WalletHeader's network strip.
 *
 * Selection indicator stack — designed to be unmistakable at a glance:
 *  1. Inactive chips render at reduced opacity so the active one pops.
 *  2. Active icon gains a thick `#a855f7` ring + subtle glow shadow.
 *  3. Active chip has a filled purple-tinted pill background.
 *  4. Active label is bold and white.
 *  5. A small purple dot below the active chip acts as a tab-bar-style
 *     selection mark.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import type { ImageSourcePropType } from 'react-native';
import { NetworkDot } from './NetworkDot';

export interface NetworkChipProps {
  networkKey: string;
  name: string;
  icon?: ImageSourcePropType;
  active: boolean;
  loading?: boolean;
  onPress: (key: string) => void;
}

function NetworkChipImpl({
  networkKey,
  name,
  icon,
  active,
  loading,
  onPress,
}: NetworkChipProps) {
  const handlePress = () => {
    if (active) return;
    // Fire-and-forget; the haptic backend is mocked under Jest and a no-op
    // when unavailable. The user feels the tap register instantly even if the
    // subsequent RPC takes a moment.
    Haptics.selectionAsync().catch(() => {});
    onPress(networkKey);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, busy: loading }}
      accessibilityLabel={`Switch to ${name}${active ? ' (active)' : ''}`}
      testID={`network-chip-${networkKey}`}
      onPress={handlePress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        !active && pressed && styles.chipPressed,
      ]}
    >
      <View style={[styles.iconWrap, active && styles.iconWrapActive, !active && styles.iconWrapInactive]}>
        {icon ? (
          <Image
            source={icon}
            style={styles.iconImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.iconFallback}>
            <NetworkDot networkKey={networkKey} size={12} />
          </View>
        )}
        {loading ? (
          <View style={styles.spinnerOverlay}>
            <ActivityIndicator size="small" color="#a78bfa" />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.label, active ? styles.labelActive : styles.labelInactive]}
      >
        {name}
      </Text>
      <View style={[styles.indicator, active && styles.indicatorActive]} />
    </Pressable>
  );
}

/**
 * Memoized so unrelated parent re-renders (balance ticks, price updates) skip
 * the chip's reconciliation. Props are primitives + a stable callback —
 * shallow equality is sufficient.
 */
export const NetworkChip = React.memo(NetworkChipImpl);

const ICON_SIZE = 40;
// Fixed chip width keeps the strip evenly spaced regardless of label length.
// Labels longer than the slot ellipsis-truncate; the only common offender is
// an active testnet name like "Solana Devnet" (testnets are otherwise hidden).
const CHIP_WIDTH = 88;

const styles = StyleSheet.create({
  chip: {
    width: CHIP_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 16,
  },
  chipActive: {
    backgroundColor: 'rgba(168,85,247,0.22)',
  },
  chipPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconWrapActive: {
    borderWidth: 3,
    borderColor: '#a855f7',
    // glow — subtle on Android (elevation) and iOS (shadow); harmless if no-op.
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 6,
  },
  iconWrapInactive: {
    opacity: 0.55,
  },
  iconImage: {
    width: '100%',
    height: '100%',
  },
  iconFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,7,18,0.55)',
  },
  label: {
    fontSize: 12,
    marginTop: 8,
    width: '100%',
    textAlign: 'center',
  },
  labelActive: {
    color: 'white',
    fontWeight: '700',
  },
  labelInactive: {
    color: '#6b7280',
    fontWeight: '500',
  },
  indicator: {
    width: 0,
    height: 3,
    borderRadius: 2,
    marginTop: 6,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    width: 18,
    backgroundColor: '#a855f7',
  },
});
