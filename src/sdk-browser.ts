// Browser/extension-friendly SDK entry that installs the WebCrypto adapter when available.
import './buffer-polyfill.js'; // Install Buffer polyfill for browser
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
export * from './types/index.js';

// Try to set WebCrypto adapter; fall back silently if unavailable (e.g., Node tests)
try {
  setCryptoAdapter(createWebCryptoAdapter());
} catch {
  // ignore
}

export {
  Wallet,
  WalletAppService,
  MemoryStorage,
  createProviderFactory,
  DefaultProviderFactory,
  type ProviderFactory,
  type StorageAdapter
};
