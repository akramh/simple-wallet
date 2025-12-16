/**
 * @fileoverview Hook for wallet operations and state.
 *
 * This hook is the recommended UI entry point for screens/components that need
 * wallet session state (unlocked/network/address) and high-level actions.
 *
 * @responsibilities
 * - Present a stable, UI-friendly interface over `useWalletStore`
 * - Derive common presentation values (e.g. truncated address)
 * - Provide safe convenience helpers (e.g. clipboard copy)
 *
 * @notes
 * - This hook does not store secrets; it delegates to the store/bridge.
 */

import { useCallback } from 'react';
import { useWalletStore } from '../store';

/**
 * Hook providing wallet state and actions.
 *
 * @returns Aggregated wallet state and store actions used across screens.
 */
export function useWallet() {
  const {
    isInitialized,
    isLoading,
    isUnlocked,
    hasWallet,
    address,
    network,
    networks,
    currentWalletName,
    error,
    initialize,
    createWallet,
    importWallet,
    unlock,
    lock,
    switchNetwork,
    clearError,
  } = useWalletStore();

  const networkConfig = networks[network];

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const copyAddress = useCallback(async () => {
    if (!address) return false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(address);
      return true;
    } catch {
      return false;
    }
  }, [address]);

  return {
    // State
    isInitialized,
    isLoading,
    isUnlocked,
    hasWallet,
    address,
    truncatedAddress,
    network,
    networkConfig,
    networks,
    currentWalletName,
    error,

    // Actions
    initialize,
    createWallet,
    importWallet,
    unlock,
    lock,
    switchNetwork,
    clearError,
    copyAddress,
  };
}
