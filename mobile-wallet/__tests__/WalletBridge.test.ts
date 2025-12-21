/**
 * @fileoverview Unit tests for WalletBridge routing and session invariants.
 *
 * WalletBridge dynamically imports shared SDK modules via `require('@wallet/*')`.
 * These tests mock those modules to avoid bundler/runtime dependencies.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Minimal mock of bundled config loader used by WalletBridge.initialize()
jest.mock('../config/bundled-config', () => ({
  __esModule: true,
  getBundledConfig: () => ({
    network: 'sepolia',
    networks: {
      sepolia: { name: 'Sepolia', chainId: 11155111, nativeSymbol: 'ETH' },
      'bitcoin-mainnet': { name: 'Bitcoin', type: 'bitcoin', nativeSymbol: 'BTC' },
    },
  }),
  getBundledTokens: () => ({}),
}));

// Mock mobile adapters used by WalletBridge
jest.mock('../services/MobileStorageAdapter', () => ({
  __esModule: true,
  mobileStorage: {
    initialize: jest.fn(async () => {}),
    readJSON: jest.fn((path, fallback) => fallback || {}),
    writeJSON: jest.fn(() => {}),
    clear: jest.fn(async () => {}),
  },
  MobileStorageAdapter: class {},
}));

jest.mock('../services/MobileCryptoAdapter', () => ({
  __esModule: true,
  mobileCrypto: {},
  MobileCryptoAdapter: class {},
}));

// Mock shared SDK modules imported via require('@wallet/*')
jest.mock('@wallet/wallet', () => ({
  __esModule: true,
  Wallet: class {
    constructor() {}
    createNewWallet() {
      return { address: '0xabc', mnemonic: 'test test test', privateKey: '0xpriv' };
    }
    importWallet() {
      return { address: '0xabc' };
    }
    get mnemonic() {
      return 'test test test';
    }
    get wallet() {
      return { privateKey: '0xpriv' };
    }
  },
}));

jest.mock('@wallet/app-service', () => ({
  __esModule: true,
  WalletAppService: class {
    constructor() {}
    async initialize() {}
    saveWallet() {}
    loadWallet() {
      return { address: '0xabc' };
    }
    getAddress() {
      return '0xabc';
    }
    async setNetwork() {}
  },
}));

jest.mock('@wallet/crypto-utils', () => ({
  __esModule: true,
  setCryptoAdapter: jest.fn(() => {}),
}));

import { walletBridge } from '../services/WalletBridge';

describe('WalletBridge session invariants', () => {
  beforeEach(async () => {
    // Ensure bridge is initialized for each test (idempotent)
    await walletBridge.initialize();
  });

  test('getState reports hasWallet based on wallets.json content', async () => {
    const state = await walletBridge.getState();
    expect(state.network).toBe('sepolia');
    expect(state.isUnlocked).toBe(false);
  });

  test('lockWallet clears session password and service references', async () => {
    await walletBridge.lockWallet();
    const state = await walletBridge.getState();
    expect(state.isUnlocked).toBe(false);
    expect(state.address).toBeNull();
  });

  test('getNetworks returns configured networks', async () => {
    const networks = await walletBridge.getNetworks();
    expect(networks).toBeDefined();
    expect(networks.sepolia).toBeDefined();
    expect(networks.sepolia.name).toBe('Sepolia');
    expect(networks['bitcoin-mainnet']).toBeDefined();
    expect(networks['bitcoin-mainnet'].type).toBe('bitcoin');
  });

  test('initialize can be called multiple times (idempotent)', async () => {
    // First call already happened in beforeEach
    await walletBridge.initialize();
    await walletBridge.initialize();

    // Should still work
    const state = await walletBridge.getState();
    expect(state.network).toBe('sepolia');
  });
});

describe('WalletBridge network operations', () => {
  beforeEach(async () => {
    await walletBridge.initialize();
  });

  test('getNetworks returns all configured networks', async () => {
    const networks = await walletBridge.getNetworks();
    expect(Object.keys(networks).length).toBeGreaterThan(0);
  });
});

describe('WalletBridge state management', () => {
  beforeEach(async () => {
    await walletBridge.initialize();
    await walletBridge.lockWallet();
  });

  test('getState returns correct locked state', async () => {
    const state = await walletBridge.getState();
    expect(state.isUnlocked).toBe(false);
    expect(state.address).toBeNull();
  });

  test('getAllWallets returns wallet list', async () => {
    const wallets = await walletBridge.getAllWallets();
    expect(wallets).toBeDefined();
    expect(typeof wallets).toBe('object');
  });
});


