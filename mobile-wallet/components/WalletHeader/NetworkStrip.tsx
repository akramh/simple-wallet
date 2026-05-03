/**
 * @fileoverview Full-bleed horizontally-scrollable network selector. Shows
 * every enabled+compatible network as an icon chip; the active chip gets a
 * purple-tinted pill + ring so the selection is unambiguous. Trailing "More"
 * affordance opens the existing /network-select screen for testnet toggle
 * and the long-tail picker.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ImageSourcePropType } from 'react-native';
import { NetworkChip } from './NetworkChip';

export interface NetworkStripPin {
  key: string;
  name: string;
  icon?: ImageSourcePropType;
}

export interface NetworkStripProps {
  pinned: ReadonlyArray<NetworkStripPin>;
  activeKey: string;
  pendingKey?: string | null;
  onSelect: (key: string) => void;
  onOverflow: () => void;
}

export function NetworkStrip({
  pinned,
  activeKey,
  pendingKey,
  onSelect,
  onOverflow,
}: NetworkStripProps) {
  const visualActive = pendingKey ?? activeKey;

  return (
    <View style={styles.strip}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {pinned.map((p) => (
          <NetworkChip
            key={p.key}
            networkKey={p.key}
            name={p.name}
            icon={p.icon}
            active={p.key === visualActive}
            loading={p.key === pendingKey}
            onPress={onSelect}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More networks"
          testID="network-strip-overflow"
          onPress={onOverflow}
          hitSlop={4}
          style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
        >
          <View style={styles.moreIcon}>
            <Ionicons name="ellipsis-horizontal" size={20} color="#9ca3af" />
          </View>
          <Text style={styles.moreLabel}>More</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  more: {
    width: 88,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 16,
  },
  morePressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  moreIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9ca3af',
    marginTop: 8,
  },
});
