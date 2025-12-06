/**
 * @file sdk.ts
 * @description Main SDK entry point for non-CLI consumers.
 * 
 * Exports all core wallet functionality for use in browser extensions,
 * mobile apps, and other integrations. This is the primary import for
 * Node.js environments that need full control over initialization.
 * 
 * @responsibilities
 * - Re-export core wallet classes and types
 * - Provide storage and provider factory interfaces
 * - Export crypto adapter utilities for environment-specific setup
 * 
 * @usage
 * ```typescript
 * import {
 *   Wallet,
 *   WalletAppService,
 *   FileStorage,
 *   DefaultProviderFactory,
 *   setCryptoAdapter,
 *   createNodeCryptoAdapter
 * } from 'simple-wallet/sdk';
 * 
 * // Set up Node.js crypto
 * setCryptoAdapter(createNodeCryptoAdapter());
 * 
 * // Initialize wallet
 * const storage = new FileStorage();
 * const wallet = new Wallet(config, storage);
 * ```
 * 
 * @see sdk-browser.ts for browser-specific initialization
 */

// Core wallet exports
export { Wallet } from './wallet.js';
export { WalletAppService } from './app-service.js';

// Storage adapters
export { FileStorage, MemoryStorage, type StorageAdapter } from './storage.js';

// Provider factories
export {
  createProviderFactory,
  DefaultProviderFactory,
  type ProviderFactory
} from './providers.js';

// Crypto utilities
export { setCryptoAdapter } from './crypto-utils.js';
export { createNodeCryptoAdapter, createWebCryptoAdapter, type CryptoAdapter } from './crypto-adapter.js';

// Type definitions
export * from './types/index.js';
