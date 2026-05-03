/**
 * @fileoverview Top-of-screen wallet header — orchestrates the network strip
 * and the account chip. Exposes:
 *
 *  - {@link WalletHeader}: the strip + chip section to render at the top of
 *    the Wallet screen.
 *  - {@link WalletHeaderAccountSheet}: the account-switch bottom sheet.
 *    Render this at the screen root (NOT inside a FlatList header) so RN's
 *    Modal portals correctly.
 *
 * Both pieces share state via {@link useWalletHeaderController} which the
 * host screen calls once and threads to both children.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useHeaderIdentitySelector } from '../../store';
import { isNetworkCompatible } from '../../utils/networkCompatibility';
import { getNetworkIcon } from '../../utils/tokenIcons';
import { NetworkStrip, NetworkStripPin } from './NetworkStrip';
import { AccountChip } from './AccountChip';
import { AccountSheet } from './AccountSheet';
import { stripLabelForNetwork } from './constants';

// ============================================================================
// Controller — shared state between the header and the bottom sheet.
// ============================================================================

interface WalletHeaderController {
  pinned: NetworkStripPin[];
  activeKey: string;
  pendingKey: string | null;
  walletName: string;
  /** 1-based account number (currentAccountIndex + 1) for the chip badge. */
  accountNumber: number;
  /** Full address; the chip formats it as `4…6` for display. */
  address: string | null;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  selectNetwork: (key: string) => void;
  openOverflow: () => void;
}

/**
 * Hook the wallet screen calls once per render. Exposes everything both
 * `WalletHeader` and `WalletHeaderAccountSheet` need so the screen can mount
 * the sheet at its top level without prop drilling.
 */
export function useWalletHeaderController(): WalletHeaderController {
  const router = useRouter();
  const {
    currentWalletName,
    currentAccountIndex,
    address,
    network,
    networks,
    enabledNetworks,
    recentNetworks,
    importType,
    privateKeyType,
    switchNetwork,
  } = useHeaderIdentitySelector();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const navInFlight = useRef(false);

  // The strip shows enabled+compatible **mainnet** networks only — testnets
  // are reachable via the "More" overflow which routes to /network-select
  // (where the user can flip the testnet toggle). Order: current → recents →
  // config order.
  //
  // Special case: if the current network IS a testnet, we still show it as
  // the active chip so the user always sees which network they're on. Other
  // testnets remain hidden.
  const pinned: NetworkStripPin[] = useMemo(() => {
    const enabledSet = new Set(enabledNetworks);
    const compat = (key: string): boolean => {
      const cfg = networks[key];
      if (!cfg) return false;
      if (!enabledSet.has(key)) return false;
      return isNetworkCompatible(cfg, importType, privateKeyType);
    };
    const isTestnet = (key: string): boolean => Boolean(networks[key]?.isTestnet);

    const ordered: string[] = [];
    if (network && networks[network]) {
      ordered.push(network); // active chip always present, even if testnet
    }
    for (const key of recentNetworks) {
      if (!compat(key)) continue;
      if (isTestnet(key) && key !== network) continue;
      if (ordered.includes(key)) continue;
      ordered.push(key);
    }
    for (const key of Object.keys(networks)) {
      if (!compat(key)) continue;
      if (isTestnet(key) && key !== network) continue;
      if (ordered.includes(key)) continue;
      ordered.push(key);
    }

    return ordered.map((key) => ({
      key,
      name: stripLabelForNetwork(key, networks[key]?.name ?? key),
      icon: getNetworkIcon(key),
    }));
  }, [network, recentNetworks, networks, enabledNetworks, importType, privateKeyType]);

  // Clear the optimistic pending highlight once the store catches up.
  useEffect(() => {
    if (pendingKey && pendingKey === network) {
      setPendingKey(null);
    }
  }, [pendingKey, network]);

  const selectNetwork = useCallback(
    (key: string) => {
      if (key === network) return;
      setPendingKey(key);
      switchNetwork(key).catch(() => {
        // Roll back the optimistic highlight on failure; the store also
        // surfaces the error via toast/banner.
        setPendingKey(null);
      });
    },
    [network, switchNetwork],
  );

  const openOverflow = useCallback(() => {
    if (navInFlight.current) return;
    navInFlight.current = true;
    router.push('/network-select');
    setTimeout(() => {
      navInFlight.current = false;
    }, 600);
  }, [router]);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const walletName = currentWalletName ?? 'Wallet';
  const accountNumber = currentAccountIndex + 1;
  const addressValue = address ?? null;

  // Stable controller object — only changes when one of its inputs changes,
  // so `React.memo` on WalletHeader can short-circuit unrelated parent ticks.
  return useMemo<WalletHeaderController>(
    () => ({
      pinned,
      activeKey: network,
      pendingKey,
      walletName,
      accountNumber,
      address: addressValue,
      sheetOpen,
      openSheet,
      closeSheet,
      selectNetwork,
      openOverflow,
    }),
    [
      pinned,
      network,
      pendingKey,
      walletName,
      accountNumber,
      addressValue,
      sheetOpen,
      openSheet,
      closeSheet,
      selectNetwork,
      openOverflow,
    ],
  );
}

// ============================================================================
// Strip + chip (renders inside the screen's header / FlatList header).
// ============================================================================

export interface WalletHeaderProps {
  controller: WalletHeaderController;
}

function WalletHeaderImpl({ controller }: WalletHeaderProps) {
  return (
    <View>
      <NetworkStrip
        pinned={controller.pinned}
        activeKey={controller.activeKey}
        pendingKey={controller.pendingKey}
        onSelect={controller.selectNetwork}
        onOverflow={controller.openOverflow}
      />
      <View style={styles.chipWrap}>
        <AccountChip
          walletName={controller.walletName}
          accountNumber={controller.accountNumber}
          address={controller.address}
          onPress={controller.openSheet}
        />
      </View>
    </View>
  );
}

/**
 * Memoized — only re-renders when the controller object changes (which it
 * does only when the user taps a chip or the store-backed identity changes).
 * Parent ticks unrelated to the header pass through without reconciling the
 * chip subtree.
 */
export const WalletHeader = React.memo(WalletHeaderImpl);

// ============================================================================
// Bottom sheet — render at the SCREEN ROOT, not inside a FlatList header.
// RN's Modal can lose its portal if it remounts inside a list's header
// re-render, which made taps appear to do nothing.
// ============================================================================

export interface WalletHeaderAccountSheetProps {
  controller: WalletHeaderController;
}

export function WalletHeaderAccountSheet({ controller }: WalletHeaderAccountSheetProps) {
  return (
    <AccountSheet
      visible={controller.sheetOpen}
      onClose={controller.closeSheet}
      walletName={controller.walletName}
    />
  );
}

// ============================================================================
// Backwards-compat default — a self-contained version that doesn't need a
// controller from the host. Kept for non-FlatList screens. Not used by
// `app/(tabs)/wallet.tsx` (that screen mounts the sheet at the root).
// ============================================================================

export function WalletHeaderStandalone() {
  const controller = useWalletHeaderController();
  return (
    <>
      <WalletHeader controller={controller} />
      <WalletHeaderAccountSheet controller={controller} />
    </>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
});
