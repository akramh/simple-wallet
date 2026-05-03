/**
 * @fileoverview Pill chip showing wallet identity (account index + wallet
 * name + address tail + chevron). The leading "#N" badge anchors the chip's
 * meaning to "this is account N within the current wallet" — the signal that
 * actually differentiates one row of the picker from another.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface AccountChipProps {
  /** Wallet name (not account index). Truncates with ellipsis past 160px. */
  walletName: string;
  /** 1-based account number rendered inside the leading badge ("#1", "#2"). */
  accountNumber: number;
  /**
   * Full account address. The chip renders a `4…6` short form
   * (e.g. `2qj5…xTZ4Rj`) so the user can recognize the address on both ends.
   * Pass `null`/empty to omit the address segment entirely.
   */
  address: string | null;
  onPress: () => void;
}

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * Compact address form: first 4 + ellipsis + last 6. Returns an empty string
 * if the input is falsy or shorter than 12 chars (in which case the original
 * value is returned to avoid a misleading truncation).
 */
function formatChipAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function AccountChip({ walletName, accountNumber, address, onPress }: AccountChipProps) {
  const shortAddr = formatChipAddress(address);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Switch account, currently account ${accountNumber} on ${walletName} ${shortAddr}`}
      testID="account-chip"
      onPress={onPress}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
    >
      <View style={styles.row}>
        <View style={styles.indexBadge}>
          <Text style={styles.indexText}>#{accountNumber}</Text>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.name}>
          {walletName}
        </Text>
        {shortAddr ? (
          <>
            <Text style={styles.separator}>·</Text>
            <Text style={styles.tail}>{shortAddr}</Text>
          </>
        ) : null}
        <Ionicons name="chevron-down" size={14} color="#d1d5db" style={styles.chevron} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937',
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
  },
  chipPressed: {
    backgroundColor: '#374151',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indexBadge: {
    height: 22,
    minWidth: 28,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: 'rgba(168,85,247,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  indexText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d8b4fe',
    fontFamily: 'Menlo',
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    maxWidth: 160,
  },
  separator: {
    fontSize: 12,
    color: '#4b5563',
    marginHorizontal: 6,
  },
  tail: {
    fontSize: 12,
    color: '#9ca3af',
    fontFamily: 'Menlo',
  },
  chevron: {
    marginLeft: 6,
  },
});
