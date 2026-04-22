/**
 * @fileoverview Provider factory abstraction for ethers.js JSON-RPC providers.
 * 
 * This module provides a factory pattern for creating ethers JsonRpcProvider instances.
 * The factory abstraction enables:
 * - Dependency injection for testing (mock providers)
 * - Consistent provider configuration across the application
 * - Future extensibility for different provider types
 * 
 * @module providers
 */

import { ethers } from 'ethers';
import type { Config } from './types/index.js';

/**
 * Name of the plugin ethers v6 auto-attaches to Polygon mainnet/testnet
 * Network instances. When present, `provider.getFeeData()` short-circuits
 * to a hosted gas-station URL (gasstation.polygon.technology/v2) instead of
 * going through the standard JSON-RPC path.
 *
 * Problems this causes for us:
 *  - Our service-worker network guard blocks every egress that isn't on the
 *    allowlist, so the fetch throws a `SERVER_ERROR` and surfaces as a
 *    confusing "polygon gas station" error on any tx involving Polygon.
 *  - Even without the guard, the gas-station URL is an extra third-party
 *    dependency with its own uptime and rate limits — for a JSON-RPC client
 *    already pointed at Alchemy, it's strictly worse than `eth_gasPrice`.
 *
 * Stripping the plugin on provider construction means getFeeData() always
 * uses the standard RPC methods on whatever endpoint the user has configured.
 *
 * See: node_modules/ethers/lib.esm/providers/network.js `registerEth("matic", 137, …)`
 */
const FETCH_URL_FEE_DATA_PLUGIN = 'org.ethers.plugins.network.FetchUrlFeeDataPlugin';

/**
 * Clone the ethers-registered Network for a chainId, stripping the
 * FetchUrlFeeData plugin if present. Unknown chain IDs return a plain
 * Network with no plugins (same as ethers' default for unknown networks).
 *
 * @param chainId - EIP-155 chain ID
 * @returns A Network suitable to pass as `staticNetwork` on construction
 */
function buildStaticNetwork(chainId: number): ethers.Network {
  const base = ethers.Network.from(chainId);
  // Fast-path: most chains don't have this plugin, so return the default.
  if (!base.getPlugin(FETCH_URL_FEE_DATA_PLUGIN)) return base;
  const cleaned = new ethers.Network(base.name, base.chainId);
  for (const plugin of base.plugins) {
    // Plugin names can carry a `#suffix` for variants — strip before compare.
    if (plugin.name.split('#')[0] === FETCH_URL_FEE_DATA_PLUGIN) continue;
    cleaned.attachPlugin(plugin);
  }
  return cleaned;
}

/**
 * Factory interface for creating blockchain RPC providers.
 * Implementations can provide mock providers for testing or
 * custom-configured providers for production use.
 */
export interface ProviderFactory {
  /**
   * Create a JSON-RPC provider for blockchain interaction.
   * @param rpcUrl - RPC endpoint URL (e.g., 'https://mainnet.infura.io/v3/...')
   * @param chainId - EIP-155 chain ID for network validation
   * @returns Configured ethers JsonRpcProvider instance
   */
  createProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider;
}

/**
 * Default provider factory using ethers.js JsonRpcProvider.
 * Creates standard providers with the specified RPC URL and chain ID.
 */
export class DefaultProviderFactory implements ProviderFactory {
  /**
   * Create a new JsonRpcProvider pinned to a plugin-stripped Network for the
   * given chainId. Passing a `staticNetwork` avoids ethers' eth_chainId
   * bootstrap round-trip and — critically for Polygon — disables the
   * built-in `gasstation.polygon.technology` fetch that would otherwise fire
   * on every `getFeeData()` call (see `buildStaticNetwork` above).
   *
   * @param rpcUrl - HTTP(S) URL of the JSON-RPC endpoint
   * @param chainId - Expected chain ID for the network
   * @returns New JsonRpcProvider instance
   */
  createProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider {
    const staticNetwork = buildStaticNetwork(chainId);
    return new ethers.JsonRpcProvider(rpcUrl, staticNetwork, { staticNetwork });
  }
}

/**
 * Factory function to create the default provider factory.
 * @returns New DefaultProviderFactory instance
 * 
 * @example
 * ```typescript
 * const factory = createProviderFactory();
 * const provider = factory.createProvider('https://rpc.example.com', 1);
 * ```
 */
export function createProviderFactory(): ProviderFactory {
  return new DefaultProviderFactory();
}
