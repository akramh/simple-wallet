/**
 * @fileoverview Unit tests for WalletBridge TON network support.
 *
 * Tests TON-specific routing for transactions, history, and pricing.
 */

import { describe, test, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';

// Mock bundled config with TON networks
jest.mock('../config/bundled-config', () => ({
  __esModule: true,
  getBundledConfig: () => ({
    network: 'ton-mainnet',
    networks: {
      'ton-mainnet': {
        name: 'TON Mainnet',
        type: 'ton',
        tonNetwork: 'mainnet',
        nativeSymbol: 'TON',
        rpcUrl: 'https://toncenter.com/api/v2/jsonRPC',
      },
      'ton-testnet': {
        name: 'TON Testnet',
        type: 'ton',
        tonNetwork: 'testnet',
        nativeSymbol: 'tTON',
        rpcUrl: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      },
      sepolia: {
        name: 'Sepolia',
        chainId: 11155111,
        nativeSymbol: 'ETH',
      },
    },
  }),
  getBundledTokens: () => ({}),
}));

// Mock mobile adapters
jest.mock('../services/MobileStorageAdapter', () => ({
  __esModule: true,
  mobileStorage: {
    initialize: jest.fn(async () => {}),
    readJSON: jest.fn(() => ({})),
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

// Mock shared SDK modules
let mockLoadWalletAsyncResult = { address: 'EQTestAddress123' };
const mockSendTonTransaction = jest.fn(async () => ({ hash: 'ton_tx_hash_123' }));
const mockGetTonTransactionHistory = jest.fn(async () => [
  {
    hash: 'ton_tx_1',
    from: 'EQSender123',
    to: 'EQRecipient456',
    valueTon: '1.5',
    status: 'confirmed',
    type: 'send',
    timestamp: Date.now(),
    feeTon: '0.01',
  },
  {
    hash: 'ton_tx_2',
    from: 'EQOther789',
    to: 'EQSender123',
    valueTon: '2.0',
    status: 'confirmed',
    type: 'receive',
    timestamp: Date.now() - 1000,
    feeTon: '0.005',
  },
]);

jest.mock('@wallet/wallet', () => ({
  __esModule: true,
  Wallet: class {
    constructor() {}
    createNewWallet() {
      return { address: 'EQTestAddress123', mnemonic: 'test mnemonic words' };
    }
    importWallet() {
      return { address: 'EQTestAddress123' };
    }
    get mnemonic() {
      return 'test mnemonic words';
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
      return { address: 'EQTestAddress123' };
    }
    async loadWalletAsync() {
      return mockLoadWalletAsyncResult;
    }
    getAddress() {
      return 'EQTestAddress123';
    }
    async setNetwork() {}
    switchAccount() {
      return { address: '0xevmaddress', accountIndex: 2 };
    }
    sendTonTransaction = mockSendTonTransaction;
    getTonTransactionHistory = mockGetTonTransactionHistory;
    getTokensForNetwork() {
      return [{ symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9 }];
    }
    getCurrentAccountIndex() {
      return 0;
    }
  },
}));

jest.mock('@wallet/crypto-utils', () => ({
  __esModule: true,
  setCryptoAdapter: jest.fn(() => {}),
}));

// Mock price service
jest.mock('../services/price-service', () => ({
  __esModule: true,
  getTonPrice: jest.fn(async () => 5.5),
  getTokenPrices: jest.fn(async () => new Map()),
  calculateTotalValue: jest.fn(() => 0),
  getBitcoinPrice: jest.fn(async () => null),
  getSolanaPrice: jest.fn(async () => null),
  getXRPPrice: jest.fn(async () => null),
}));

// Mock cache service
jest.mock('../services/CacheService', () => ({
  __esModule: true,
  cacheService: {
    get: jest.fn(() => null),
    getStale: jest.fn(() => null),
    set: jest.fn(() => {}),
  },
}));

import { walletBridge } from '../services/WalletBridge';

// Clean up timers after all tests
afterAll(async () => {
  jest.useRealTimers();
  await walletBridge.lockWallet();
});

describe('WalletBridge TON network support', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await walletBridge.initialize();
  });

  afterEach(async () => {
    // Lock wallet to clear auto-lock timer
    await walletBridge.lockWallet();
  });

  test('getNetworks includes TON mainnet and testnet', async () => {
    const networks = await walletBridge.getNetworks();

    expect(networks['ton-mainnet']).toBeDefined();
    expect(networks['ton-mainnet'].type).toBe('ton');
    expect(networks['ton-mainnet'].nativeSymbol).toBe('TON');

    expect(networks['ton-testnet']).toBeDefined();
    expect(networks['ton-testnet'].type).toBe('ton');
    expect(networks['ton-testnet'].nativeSymbol).toBe('tTON');
  });

  test('getState returns TON as default network', async () => {
    const state = await walletBridge.getState();
    expect(state.network).toBe('ton-mainnet');
  });
});

describe('WalletBridge TON transactions', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockLoadWalletAsyncResult = { address: 'EQTestAddress123' };
    await walletBridge.initialize();
    // Simulate unlocked state by creating a wallet
    await walletBridge.createWallet('testpassword', 'test');
  });

  afterEach(async () => {
    // Lock wallet to clear auto-lock timer
    await walletBridge.lockWallet();
  });

  test('sendTransaction routes to sendTonTransaction for TON network', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };
    const result = await walletBridge.sendTransaction(
      token,
      'EQRecipient123',
      '1.5',
      undefined, // no XRP destination tag
      'Hello TON!' // TON comment
    );

    expect(result.hash).toBe('ton_tx_hash_123');
    expect(result.status).toBe('pending');
    expect(mockSendTonTransaction).toHaveBeenCalledWith(
      'EQRecipient123',
      '1.5',
      'testpassword',
      'Hello TON!'
    );
  });

  test('unlockWallet returns network-specific address from WalletAppService', async () => {
    mockLoadWalletAsyncResult = { address: '0xevmaddress' };

    const result = await walletBridge.unlockWallet('testpassword', 'default');

    expect(result.address).toBe('EQTestAddress123');
  });

  test('switchAccount returns network-specific address from WalletAppService', async () => {
    const result = await walletBridge.switchAccount(2);

    expect(result.address).toBe('EQTestAddress123');
  });

  test('sendTransaction passes undefined comment when not provided', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };
    await walletBridge.sendTransaction(token, 'EQRecipient123', '2.0');

    expect(mockSendTonTransaction).toHaveBeenCalledWith(
      'EQRecipient123',
      '2.0',
      'testpassword',
      undefined
    );
  });

  test('getTransactions routes to getTonTransactionHistory for TON network', async () => {
    const txs = await walletBridge.getTransactions(10);

    expect(mockGetTonTransactionHistory).toHaveBeenCalledWith(10);
    expect(txs).toHaveLength(2);

    // Verify first transaction (send)
    expect(txs[0].hash).toBe('ton_tx_1');
    expect(txs[0].from).toBe('EQSender123');
    expect(txs[0].to).toBe('EQRecipient456');
    expect(txs[0].value).toBe('1.5');
    expect(txs[0].tokenSymbol).toBe('TON');
    expect(txs[0].type).toBe('send');
    expect(txs[0].fee).toBe('0.01');

    // Verify second transaction (receive)
    expect(txs[1].hash).toBe('ton_tx_2');
    expect(txs[1].type).toBe('receive');
    expect(txs[1].value).toBe('2.0');
  });

  test('getTransactions normalizes transaction type "other" to "contract_interaction"', async () => {
    mockGetTonTransactionHistory.mockResolvedValueOnce([
      {
        hash: 'ton_contract_tx',
        from: 'EQSender',
        to: 'EQContract',
        valueTon: '0',
        status: 'confirmed',
        type: 'other',
        timestamp: Date.now(),
        feeTon: '0.02',
      },
    ]);

    const txs = await walletBridge.getTransactions();
    expect(txs[0].type).toBe('contract_interaction');
  });
});

describe('WalletBridge TON NetworkConfig type', () => {
  test('NetworkConfig interface supports TON-specific fields', async () => {
    const networks = await walletBridge.getNetworks();
    const tonMainnet = networks['ton-mainnet'];

    // TypeScript compile-time check - these fields should exist
    expect(tonMainnet.type).toBe('ton');
    expect(tonMainnet.tonNetwork).toBe('mainnet');
    expect(tonMainnet.rpcUrl).toBeDefined();
  });
});
