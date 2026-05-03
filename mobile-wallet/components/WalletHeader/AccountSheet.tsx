/**
 * @fileoverview Top-anchored account-switch flyout. Triggered by the
 * AccountChip; renders as a translucent dropdown that appears just below the
 * top status-bar / network-strip area and extends downward. Uses RN's built-in
 * `Modal` with a fade animation; tap outside the panel dismisses.
 *
 * Wallet-level switching stays on the `/wallet-manage` route — this flyout is
 * the per-wallet account picker only.
 *
 * Scrolls when the wallet has many accounts (caps at ~70% of screen height
 * via `maxHeight`). The "+ Add account" affordance lives in the panel header
 * so it's always reachable without scrolling to the bottom.
 */

import React, { useCallback } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWalletStore } from '../../store';
import { useToast } from '../../contexts';

export interface AccountSheetProps {
  visible: boolean;
  onClose: () => void;
  walletName: string;
}

interface SheetSlice {
  accounts: Array<{ index: number; address: string }>;
  currentAccountIndex: number;
  importType?: 'mnemonic' | 'privateKey';
  isLoading: boolean;
  loadAccounts: () => Promise<void>;
  switchAccount: (index: number) => Promise<void>;
  createAccount: () => Promise<{ address: string; index: number }>;
}

export function AccountSheet({ visible, onClose, walletName }: AccountSheetProps) {
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const {
    accounts,
    currentAccountIndex,
    importType,
    isLoading,
    loadAccounts,
    switchAccount,
    createAccount,
  } = useWalletStore(
    useShallow(
      (state): SheetSlice => ({
        accounts: state.accounts,
        currentAccountIndex: state.currentAccountIndex,
        importType: state.importType,
        isLoading: state.isLoading,
        loadAccounts: state.loadAccounts,
        switchAccount: state.switchAccount,
        createAccount: state.createAccount,
      }),
    ),
  );

  React.useEffect(() => {
    if (visible) {
      void loadAccounts();
    }
  }, [visible, loadAccounts]);

  const handleSelect = useCallback(
    async (index: number) => {
      if (index === currentAccountIndex) {
        onClose();
        return;
      }
      try {
        await switchAccount(index);
      } catch {
        showToast('Failed to switch account', 'error');
      }
      onClose();
    },
    [currentAccountIndex, switchAccount, onClose, showToast],
  );

  const handleAdd = useCallback(async () => {
    if (importType !== 'mnemonic') return;
    try {
      const result = await createAccount();
      showToast(`Account #${result.index + 1} created`, 'success');
      await switchAccount(result.index);
      onClose();
    } catch {
      showToast('Failed to create account', 'error');
    }
  }, [importType, createAccount, switchAccount, onClose, showToast]);

  const canAdd = importType === 'mnemonic';

  // Anchor the panel below the top safe area + the network strip + the
  // account chip row. This is a fixed estimate; if the chip is moved we'd
  // want to switch to onLayout-based measurement.
  const TOP_OFFSET = insets.top + 120;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="account-sheet"
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* swallow taps inside the panel */
          }}
          style={[
            styles.panel,
            {
              top: TOP_OFFSET,
              maxHeight: '70%',
            },
          ]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Switch account</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {walletName}
              </Text>
            </View>
            <Pressable
              testID="account-sheet-add"
              accessibilityRole="button"
              accessibilityLabel="Add account"
              accessibilityState={{ disabled: !canAdd }}
              onPress={canAdd ? handleAdd : undefined}
              disabled={!canAdd || isLoading}
              style={({ pressed }) => [
                styles.addBtn,
                !canAdd && styles.addBtnDisabled,
                pressed && canAdd && styles.addBtnPressed,
              ]}
            >
              <Ionicons name="add" size={18} color={canAdd ? '#d8b4fe' : '#6b7280'} />
              <Text style={[styles.addText, !canAdd && styles.addTextDisabled]}>Add</Text>
            </Pressable>
          </View>

          {!canAdd ? (
            <Text style={styles.disabledHint}>
              Imported wallets only have one account.
            </Text>
          ) : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {accounts.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No accounts loaded</Text>
              </View>
            ) : (
              accounts.map((acc, i) => {
                const isActive = acc.index === currentAccountIndex;
                return (
                  <Pressable
                    key={acc.index}
                    testID={`account-row-${acc.index}`}
                    onPress={() => handleSelect(acc.index)}
                    style={({ pressed }) => [
                      styles.row,
                      i < accounts.length - 1 && styles.rowDivider,
                      isActive && styles.rowActive,
                      !isActive && pressed && styles.rowPressed,
                    ]}
                  >
                    <View style={[styles.rowBadge, isActive && styles.rowBadgeActive]}>
                      <Text style={[styles.rowBadgeText, isActive && styles.rowBadgeTextActive]}>
                        #{acc.index + 1}
                      </Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        Account #{acc.index + 1}
                      </Text>
                      <Text style={styles.rowAddr} numberOfLines={1}>
                        {acc.address.slice(0, 8)}…{acc.address.slice(-8)}
                      </Text>
                    </View>
                    {isActive ? (
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark" size={14} color="white" />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#0a0612',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
  subtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.15)',
    gap: 4,
  },
  addBtnPressed: {
    backgroundColor: 'rgba(168,85,247,0.25)',
  },
  addBtnDisabled: {
    backgroundColor: '#1f2937',
    opacity: 0.6,
  },
  addText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d8b4fe',
  },
  addTextDisabled: {
    color: '#6b7280',
  },
  disabledHint: {
    color: '#6b7280',
    fontSize: 11,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  list: {
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  rowDivider: {
    // No bottom border — instead we rely on the row's own padding.
  },
  rowActive: {
    backgroundColor: 'rgba(168,85,247,0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBadgeActive: {
    backgroundColor: 'rgba(168,85,247,0.20)',
  },
  rowBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9ca3af',
    fontFamily: 'Menlo',
  },
  rowBadgeTextActive: {
    color: '#d8b4fe',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  rowAddr: {
    fontSize: 11,
    color: '#9ca3af',
    fontFamily: 'Menlo',
    marginTop: 2,
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#a855f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 13,
  },
});
