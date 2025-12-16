/**
 * @fileoverview Bundled configuration for the mobile app.
 * 
 * This file imports the main config.json and tokens.json from the parent
 * directory so they're available at runtime in React Native.
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
 */
export function getBundledConfig(): Config {
  return mainConfig as Config;
}

/**
 * Get the bundled token list.
 */
export function getBundledTokens(): TokenRegistry {
  return tokenList as TokenRegistry;
}

/**
 * Get list of all available network keys.
 */
export function getNetworkKeys(): string[] {
  return Object.keys(mainConfig.networks);
}

/**
 * Get a specific network config.
 */
export function getNetworkConfig(networkKey: string): NetworkConfig | undefined {
  return (mainConfig.networks as Record<string, NetworkConfig>)[networkKey];
}

/**
 * Get tokens for a specific network.
 */
export function getTokensForNetwork(networkKey: string): Token[] {
  return (tokenList as TokenRegistry)[networkKey] || [];
}
