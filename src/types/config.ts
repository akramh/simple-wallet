/**
 * @fileoverview Configuration type definitions for network and token settings.
 * 
 * This module defines the core configuration structures used to manage
 * blockchain network connections, RPC endpoints, and token registries.
 * These types are shared between the CLI and browser extension.
 * 
 * @module types/config
 */

import type { Token } from './token.js';
export type { Token };

/**
 * Network type discriminator.
 * - 'evm': Ethereum and EVM-compatible chains (Polygon, BSC, etc.)
 * - 'bitcoin': Bitcoin mainnet and testnet
 * - 'solana': Solana mainnet and devnet
 * - 'xrp': XRP Ledger mainnet and testnet
 * - 'ton': TON mainnet and testnet
 */
export type NetworkType = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';

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
 * Configuration for Solana networks.
 */
export interface SolanaNetworkConfig extends BaseNetworkConfig {
  /** Network type discriminator */
  type: 'solana';
  /** Solana RPC URL */
  rpcUrl: string | string[];
  /** Solana cluster identifier (optional, informational) */
  solanaCluster?: 'mainnet-beta' | 'devnet' | 'testnet' | string;
}

/**
 * Configuration for XRP Ledger networks.
 */
export interface XRPNetworkConfig extends BaseNetworkConfig {
  /** Network type discriminator */
  type: 'xrp';
  /** XRP network variant */
  xrpNetwork: 'mainnet' | 'testnet' | 'devnet';
  /** JSON-RPC URL(s) for XRP Ledger */
  rpcUrl?: string | string[];
  /** WebSocket URL(s) for XRP Ledger */
  wsUrl?: string | string[];
}

/**
 * Configuration for TON networks.
 */
export interface TonNetworkConfig extends BaseNetworkConfig {
  /** Network type discriminator */
  type: 'ton';
  /** TON network variant */
  tonNetwork: 'mainnet' | 'testnet';
  /** Toncenter-compatible HTTP endpoint(s) */
  rpcUrl: string | string[];
  /** Optional API key for Toncenter */
  rpcApiKey?: string;
}

/**
 * Configuration for a single blockchain network.
 * Union type supporting EVM, Bitcoin, Solana, and XRP networks.
 */
export type NetworkConfig = EVMNetworkConfig | BitcoinNetworkConfig | SolanaNetworkConfig | XRPNetworkConfig | TonNetworkConfig;

/**
 * Type guard to check if a network config is for Bitcoin.
 */
export function isBitcoinNetworkConfig(config: NetworkConfig): config is BitcoinNetworkConfig {
  return config.type === 'bitcoin';
}

/**
 * Type guard to check if a network config is for Solana.
 */
export function isSolanaNetworkConfig(config: NetworkConfig): config is SolanaNetworkConfig {
  return config.type === 'solana';
}

/**
 * Type guard to check if a network config is for XRP.
 */
export function isXRPNetworkConfig(config: NetworkConfig): config is XRPNetworkConfig {
  return config.type === 'xrp';
}

/**
 * Type guard to check if a network config is for TON.
 */
export function isTonNetworkConfig(config: NetworkConfig): config is TonNetworkConfig {
  return config.type === 'ton';
}

/**
 * Type guard to check if a network config is for EVM.
 */
export function isEVMNetworkConfig(config: NetworkConfig): config is EVMNetworkConfig {
  return config.type !== 'bitcoin' && config.type !== 'solana' && config.type !== 'xrp' && config.type !== 'ton';
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
 * Registry mapping network keys to arrays of tokens.
 * Used for both built-in and user-added custom tokens.
 */
export type TokenRegistry = Record<string, Token[]>;
