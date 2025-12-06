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
   * Create a new JsonRpcProvider.
   * @param rpcUrl - HTTP(S) URL of the JSON-RPC endpoint
   * @param chainId - Expected chain ID for the network
   * @returns New JsonRpcProvider instance
   */
  createProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(rpcUrl, chainId);
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
