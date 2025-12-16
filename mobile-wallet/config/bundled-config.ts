/**
 * @fileoverview Bundled configuration for the mobile app.
 * 
 * This file imports the main config.json and tokens.json from the parent
 * directory so they're available at runtime in React Native.
 *
 * @responsibilities
 * - Provide a typed, Metro-friendly way to access shared `config.json` and `tokens.json`
 * - Establish the canonical “network key” strings used across mobile (e.g. `sepolia`, `bitcoin-mainnet`)
 *
 * @notes
 * - Network keys here must match the keys expected by `WalletBridge.switchNetwork()` and
 *   the shared SDK's provider routing.
 * - Certain features (tx history, explorer links, price lookup) depend on specific
 *   config fields (e.g. `chainId` for EVM pricing, `type` for routing).
 */

// Import main configuration (networks)
import mainConfig from '../../config.json';

// Import token lists
import tokenList from '../../tokens.json';

// Type definitions
export interface NetworkConfig {
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp';
  name: string;
  rpcUrl?: string | string[];
  wsUrl?: string | string[];
  chainId?: number;
  nativeSymbol: string;
  nativeName?: string;
  blockExplorer?: string;
  explorerApiUrl?: string;
  explorerApiKey?: string;
  bitcoinNetwork?: 'mainnet' | 'testnet';
  solanaCluster?: 'mainnet-beta' | 'devnet' | 'testnet';
  xrpNetwork?: 'mainnet' | 'testnet' | 'devnet';
}

export interface Config {
  network: string;
  networks: Record<string, NetworkConfig>;
}

export interface Token {
  symbol: string;
  name: string;
  type?: 'native' | 'erc20';
  address?: string;
  decimals: number;
  icon?: string;
}

export type TokenRegistry = Record<string, Token[]>;

/**
 * Get the bundled network configuration.
 *
 * @returns The parsed `config.json` content (networks + default network).
 */
export function getBundledConfig(): Config {
  return mainConfig as Config;
}

/**
 * Get the bundled token list.
 *
 * @returns Token registry keyed by network (each value is a token array).
 */
export function getBundledTokens(): TokenRegistry {
  return tokenList as TokenRegistry;
}

/**
 * Get list of all available network keys.
 *
 * @returns Array of network keys in `config.json`.
 */
export function getNetworkKeys(): string[] {
  return Object.keys(mainConfig.networks);
}

/**
 * Get a specific network config.
 *
 * @param networkKey - Network identifier key (e.g. `sepolia`).
 * @returns Network configuration or undefined if unknown.
 */
export function getNetworkConfig(networkKey: string): NetworkConfig | undefined {
  return (mainConfig.networks as Record<string, NetworkConfig>)[networkKey];
}

/**
 * Get tokens for a specific network.
 *
 * @param networkKey - Network identifier key (e.g. `sepolia`).
 * @returns Token list for that network (empty if none).
 */
export function getTokensForNetwork(networkKey: string): Token[] {
  return (tokenList as TokenRegistry)[networkKey] || [];
}
