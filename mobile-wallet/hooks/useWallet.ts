/**
 * @fileoverview Hook for wallet operations and state.
 */

import { useCallback } from 'react';
import { useWalletStore } from '../store';

/**
 * Hook providing wallet state and actions.
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
