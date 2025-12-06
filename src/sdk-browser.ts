/**
 * @file sdk-browser.ts
 * @description Browser-optimized SDK entry point with automatic WebCrypto setup.
 * 
 * This module is designed for browser and extension contexts where:
 * - WebCrypto API is available (via window.crypto or self.crypto)
 * - Buffer polyfill is needed (browsers don't have Node.js Buffer)
 * - Automatic crypto adapter initialization is desired
 * 
 * The module automatically:
 * 1. Installs Buffer polyfill for browser compatibility
 * 2. Sets up WebCrypto adapter using asmcrypto.js
 * 3. Silently falls back if in a Node.js test environment
 * 
 * @responsibilities
 * - Provide browser-compatible wallet SDK
 * - Auto-configure crypto adapter for browser environments
 * - Install Buffer polyfill for hex/base64 encoding
 * 
 * @usage
 * ```typescript
 * // In a browser extension or web app:
 * import {
 *   Wallet,
 *   WalletAppService,
 *   MemoryStorage,
 *   DefaultProviderFactory
 * } from 'simple-wallet/sdk-browser';
 * 
 * // Crypto is automatically configured
 * const storage = new MemoryStorage();
 * const wallet = new Wallet(config, storage);
 * ```
 * 
 * @see sdk.ts for Node.js environments with manual crypto setup
 */

// Install Buffer polyfill for browser environments
import './buffer-polyfill.js';

// Core imports
import { Wallet } from './wallet.js';
import { WalletAppService } from './app-service.js';
import { MemoryStorage, type StorageAdapter } from './storage.js';
import {
  createProviderFactory,
  DefaultProviderFactory,
  type ProviderFactory
} from './providers.js';
import { setCryptoAdapter } from './crypto-utils.js';
import { createWebCryptoAdapter } from './crypto-adapter.js';

// Re-export all types
export * from './types/index.js';

/**
 * Automatically configure WebCrypto adapter for browser environments.
 * Silently ignores errors (e.g., when running in Node.js test environment).
 */
try {
  setCryptoAdapter(createWebCryptoAdapter());
} catch {
  // Ignore - likely running in Node.js tests where asmcrypto may not be available
}

// Re-export core classes and factories
export {
  Wallet,
  WalletAppService,
  MemoryStorage,
  createProviderFactory,
  DefaultProviderFactory,
  type ProviderFactory,
  type StorageAdapter
};
