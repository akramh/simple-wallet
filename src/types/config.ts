/**
 * @fileoverview Configuration type definitions for network and token settings.
 * 
 * This module defines the core configuration structures used to manage
 * blockchain network connections, RPC endpoints, and token registries.
 * These types are shared between the CLI and browser extension.
 * 
 * @module types/config
 */

/**
 * Network type discriminator.
 * - 'evm': Ethereum and EVM-compatible chains (Polygon, BSC, etc.)
 * - 'bitcoin': Bitcoin mainnet and testnet
 */
export type NetworkType = 'evm' | 'bitcoin';

/**
 * Base configuration shared by all network types.
 */
interface BaseNetworkConfig {
  /** Network type discriminator (defaults to 'evm' if not specified) */
  type?: NetworkType;
  /** Symbol for the native currency (e.g., 'ETH', 'BTC') */
  nativeSymbol: string;
  /** Human-readable name for the native currency */
  nativeName: string;
  /** Base URL for the block explorer */
  blockExplorer?: string;
  /** API endpoint for the block explorer */
  explorerApiUrl?: string;
  /** API key for rate-limited explorer API access */
  explorerApiKey?: string;
  /** Human-readable network name for display */
  name?: string;
}

/**
 * Configuration for EVM-compatible networks.
 * Supports multiple RPC endpoints for failover redundancy.
 */
export interface EVMNetworkConfig extends BaseNetworkConfig {
  /** Network type (optional, defaults to 'evm') */
  type?: 'evm';
  /** Primary RPC URL or array of fallback URLs for load balancing/failover */
  rpcUrl: string | string[];
  /** EIP-155 chain ID (e.g., 1 for Ethereum Mainnet, 11155111 for Sepolia) */
  chainId: number;
}

/**
 * Configuration for Bitcoin networks.
 */
export interface BitcoinNetworkConfig extends BaseNetworkConfig {
  /** Network type discriminator */
  type: 'bitcoin';
  /** Bitcoin network variant */
  bitcoinNetwork: 'mainnet' | 'testnet' | 'signet';
}

/**
 * Configuration for a single blockchain network.
 * Union type supporting both EVM and Bitcoin networks.
 */
export type NetworkConfig = EVMNetworkConfig | BitcoinNetworkConfig;

/**
 * Type guard to check if a network config is for Bitcoin.
 */
export function isBitcoinNetworkConfig(config: NetworkConfig): config is BitcoinNetworkConfig {
  return config.type === 'bitcoin';
}

/**
 * Type guard to check if a network config is for EVM.
 */
export function isEVMNetworkConfig(config: NetworkConfig): config is EVMNetworkConfig {
  return config.type !== 'bitcoin';
}

/**
 * Top-level application configuration.
 * Manages network selection and available network definitions.
 */
export interface Config {
  /** Default network to use on first launch */
  defaultNetwork: string;
  /** Currently selected network key */
  network: string;
  /** Map of network keys to their configurations */
  networks: Record<string, NetworkConfig>;
}

/**
 * Represents an ERC-20 token or native currency.
 * Used for portfolio display and transaction operations.
 */
export interface Token {
  /** Token ticker symbol (e.g., 'USDC', 'ETH') */
  symbol: string;
  /** Contract address (empty string for native tokens) */
  address: string;
  /** Number of decimal places for display formatting */
  decimals: number;
 /** Human-readable token name */
  name: string;
  /** Distinguishes native currency from ERC-20 tokens */
  type?: 'native' | 'erc20';
  /** Optional icon file name for UI display (e.g., 'eth_logo.svg') */
  icon?: string;
}

/**
 * Registry mapping network keys to arrays of tokens.
 * Used for both built-in and user-added custom tokens.
 */
export type TokenRegistry = Record<string, Token[]>;
