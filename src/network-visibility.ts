/**
 * @fileoverview Network visibility helpers for filtering testnets/devnets.
 *
 * Centralizes network filtering rules so CLI and extension stay consistent
 * when hiding test networks by default.
 *
 * @responsibilities
 * - Provide consistent network visibility rules across UIs
 *
 * @security
 * - Pure filtering logic; does not access secrets or storage
 */

import type { NetworkConfig } from './types/config.js';

/**
 * Options for filtering visible networks.
 */
export interface NetworkVisibilityOptions {
  /** Whether to include testnets/devnets in the visible list. */
  showTestnets: boolean;
  /** Current active network key; always included even if hidden. */
  currentNetwork?: string;
}

/**
 * Filter networks based on testnet visibility preference.
 *
 * Always includes the current network to avoid lockout scenarios.
 *
 * @param networks - Map of network keys to configs.
 * @param options - Filtering options for testnet visibility.
 * @returns Array of [key, config] entries that should be shown.
 */
export function getVisibleNetworkEntries(
  networks: Record<string, NetworkConfig>,
  options: NetworkVisibilityOptions
): Array<[string, NetworkConfig]> {
  const { showTestnets, currentNetwork } = options;
  return Object.entries(networks).filter(([key, config]) => {
    if (currentNetwork && key === currentNetwork) return true;
    return showTestnets || !config.isTestnet;
  });
}
