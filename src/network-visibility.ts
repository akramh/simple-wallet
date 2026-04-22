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

import type { NetworkConfig, NetworkType } from './types/config.js';

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

/**
 * Wallet-import discriminator.
 *
 * - `mnemonic`: Seed-phrase import; supports every network type.
 * - `privateKey`: Raw-key import; supports only networks matching `privateKeyType`.
 */
export type WalletImportType = 'mnemonic' | 'privateKey';

/**
 * Chain-type discriminator for a raw private-key import.
 */
export type PrivateKeyType = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';

/**
 * Context describing how the wallet was created/imported.
 */
export interface NetworkUsabilityContext {
  importType?: WalletImportType | null;
  privateKeyType?: PrivateKeyType | null;
}

/**
 * Resolve the network type for a given key, preferring the explicit
 * `config.type` and falling back to a key-prefix heuristic for legacy
 * configs where `type` is undefined (EVM).
 */
function resolveNetworkType(networkKey: string, config?: NetworkConfig): NetworkType {
  if (config && config.type) return config.type;
  if (networkKey.startsWith('bitcoin-')) return 'bitcoin';
  if (networkKey.startsWith('solana-')) return 'solana';
  if (networkKey.startsWith('xrp-')) return 'xrp';
  if (networkKey.startsWith('ton-')) return 'ton';
  return 'evm';
}

/**
 * Check whether a given network is usable by the current wallet.
 *
 * Mnemonic-imported wallets can use every network. Private-key-imported
 * wallets can only use networks matching the key's chain type — e.g. a
 * Bitcoin private-key import cannot sign EVM transactions.
 *
 * @param networkKey - Network key (e.g. `"mainnet"`, `"bitcoin-mainnet"`).
 * @param config - Optional network config used for the definitive `type` field.
 * @param context - Import metadata describing how the wallet was created.
 * @returns `true` when the network can be used by this wallet.
 */
export function isNetworkUsable(
  networkKey: string,
  config: NetworkConfig | undefined,
  context: NetworkUsabilityContext = {}
): boolean {
  const { importType, privateKeyType } = context;
  if (!importType || importType !== 'privateKey' || !privateKeyType) return true;
  return resolveNetworkType(networkKey, config) === privateKeyType;
}

/**
 * Whether a network's tokens should be priced against mainnet markets.
 *
 * Testnet tokens (sepolia ETH, bitcoin-testnet tBTC, solana-devnet SOL, etc.)
 * share a symbol with their mainnet counterparts but have no market value.
 * Pricing them via the mainnet ticker would inflate portfolio totals with
 * fake USD whenever the "show test networks" toggle is on — and would leave
 * stale mainnet-priced entries in the cache long after the user toggled
 * testnets back off.
 *
 * This predicate lives at the *data layer* so every price-resolver caller
 * (unified snapshot, single-network view, Portfolio API cache writes, Send
 * preview) gets the same answer. A missing/unknown config returns `false`
 * defensively — an unknown network shouldn't confidently quote a USD value.
 *
 * @param config - Network config entry (or `undefined` when key isn't registered).
 * @returns `true` when prices make sense for this network's tokens.
 */
export function pricesAvailableForNetwork(config: NetworkConfig | undefined): boolean {
  if (!config) return false;
  return !config.isTestnet;
}
