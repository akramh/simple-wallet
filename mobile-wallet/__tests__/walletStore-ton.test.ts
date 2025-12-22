/**
 * @fileoverview Unit tests for walletStore TON transaction support.
 *
 * Tests that the store correctly passes TON comment parameter to WalletBridge.
 */

import { describe, test, beforeEach, afterEach, afterAll, expect, jest } from '@jest/globals';

const mockSendTransaction = jest.fn(async () => ({ hash: 'ton_hash_123', status: 'pending' }));

// Mock the services barrel used by walletStore.ts
jest.mock('../services', () => {
  const sendTxMock = jest.fn(async () => ({ hash: 'ton_hash_123', status: 'pending' }));
  return {
    __esModule: true,
    walletBridge: {
      initialize: jest.fn(async () => {}),
      getState: jest.fn(async () => ({
        isUnlocked: true,
        hasWallet: true,
        network: 'ton-mainnet',
        address: 'EQTestAddress123',
        currentWalletName: 'default',
      })),
      getNetworks: jest.fn(async () => ({
        'ton-mainnet': {
          name: 'TON Mainnet',
          type: 'ton',
          tonNetwork: 'mainnet',
          nativeSymbol: 'TON',
        },
        'ton-testnet': {
          name: 'TON Testnet',
          type: 'ton',
          tonNetwork: 'testnet',
          nativeSymbol: 'tTON',
        },
      })),
      getAllWallets: jest.fn(async () => ({ default: { address: 'EQTestAddress123' } })),
      lockWallet: jest.fn(async () => {}),
      onLock: jest.fn(() => () => {}),
      unlockWallet: jest.fn(async () => ({
        success: true,
        address: 'EQTestAddress123',
        walletName: 'default',
      })),
      getCachedBalances: jest.fn(() => null),
      getCachedPrices: jest.fn(() => null),
      getCachedAllNetworkHoldings: jest.fn(() => null),
      refreshBalances: jest.fn(async () => [
        {
          token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9 },
          balance: '10.5',
          lastUpdated: Date.now(),
          isLoading: false,
        },
      ]),
      getTokenPrices: jest.fn(async () => ({
        prices: { TON: 5.5 },
        totalValue: 57.75,
        formattedTotal: '$57.75',
      })),
      getTransactions: jest.fn(async () => []),
      switchNetwork: jest.fn(async () => ({ address: 'EQTestAddress123' })),
      getAccounts: jest.fn(async () => ({ accounts: {}, currentIndex: 0 })),
      switchAccount: jest.fn(async () => ({ address: 'EQTestAddress123' })),
      createAccount: jest.fn(async () => ({ address: 'EQNewAccount', accountIndex: 1 })),
      sendTransaction: sendTxMock,
      getGasEstimate: jest.fn(async () => ({
        gasLimit: '0',
        gasPrice: '0',
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        estimatedCostWei: '10000000',
        estimatedCostNative: '0.01',
        nativeSymbol: 'TON',
        supportsEIP1559: false,
        network: 'ton-mainnet',
      })),
      getShowTestnets: jest.fn(() => false),
      setShowTestnets: jest.fn(async () => {}),
      addCustomToken: jest.fn(async () => {}),
      toggleTokenVisibility: jest.fn(async () => {}),
    },
    // Export the mock for test access
    _mockSendTransaction: sendTxMock,
  };
});

import { useWalletStore } from '../store/walletStore';
// @ts-ignore - Mock export
import { _mockSendTransaction } from '../services';

// Get the mock for assertions
const mockSendTx = _mockSendTransaction as jest.Mock;

// Clean up fake timers after all tests
afterAll(() => {
  jest.useRealTimers();
  jest.clearAllTimers();
});

describe('walletStore TON sendTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Reset Zustand store between tests
    useWalletStore.setState({
      isLoading: false,
      isInitialized: true,
      isUnlocked: true,
      hasWallet: true,
      network: 'ton-mainnet',
      address: 'EQTestAddress123',
      currentWalletName: 'default',
      walletList: [{ name: 'default', address: 'EQTestAddress123' }],
      accounts: [],
      currentAccountIndex: 0,
      balances: [
        {
          token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: '' },
          balance: '10.5',
          lastUpdated: Date.now(),
          isLoading: false,
        },
      ],
      isRefreshingBalances: false,
      balancesLastUpdated: Date.now(),
      allNetworkHoldings: [],
      allNetworkTotals: {},
      allNetworksLastUpdated: null,
      isRefreshingAllNetworks: false,
      prices: { TON: 5.5 },
      totalValue: 57.75,
      formattedTotal: '$57.75',
      isLoadingPrices: false,
      transactions: [],
      isLoadingTransactions: false,
      transactionFilter: 'all',
      transactionsLastUpdated: null,
      networks: {
        'ton-mainnet': {
          name: 'TON Mainnet',
          type: 'ton',
          tonNetwork: 'mainnet',
          nativeSymbol: 'TON',
        },
      },
      enabledNetworks: ['ton-mainnet'],
      error: null,
    } as any);
  });

  afterEach(() => {
    // Clear any pending timers (e.g., refresh timers from sendTransaction)
    jest.clearAllTimers();
  });

  test('sendTransaction passes comment parameter to WalletBridge', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };

    const result = await useWalletStore.getState().sendTransaction(
      token,
      'EQRecipient456',
      '1.5',
      undefined, // no XRP destination tag
      'Test comment for TON' // TON comment
    );

    expect(result.hash).toBe('ton_hash_123');
    expect(mockSendTx).toHaveBeenCalledWith(
      token,
      'EQRecipient456',
      '1.5',
      undefined,
      'Test comment for TON'
    );
  });

  test('sendTransaction works without comment', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };

    await useWalletStore.getState().sendTransaction(token, 'EQRecipient456', '2.0');

    expect(mockSendTx).toHaveBeenCalledWith(
      token,
      'EQRecipient456',
      '2.0',
      undefined,
      undefined
    );
  });

  test('sendTransaction with empty comment passes empty string', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };

    await useWalletStore.getState().sendTransaction(token, 'EQRecipient456', '3.0', undefined, '');

    expect(mockSendTx).toHaveBeenCalledWith(
      token,
      'EQRecipient456',
      '3.0',
      undefined,
      ''
    );
  });

  test('sendTransaction schedules follow-up history refreshes for TON', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };
    const loadSpy = jest.spyOn(useWalletStore.getState(), 'loadTransactions');

    await useWalletStore.getState().sendTransaction(token, 'EQRecipient456', '1.0');

    expect(loadSpy).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(5000);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10000);
    expect(loadSpy).toHaveBeenCalledTimes(2);

    loadSpy.mockRestore();
  });

  test('sendTransaction can have both XRP tag and TON comment (only one used per network)', async () => {
    const token = { symbol: 'TON', name: 'Toncoin', type: 'native' as const, decimals: 9, address: '' };

    // In practice, only one will be used based on network type, but the store passes both
    await useWalletStore.getState().sendTransaction(
      token,
      'EQRecipient456',
      '1.0',
      12345, // XRP tag (ignored for TON)
      'TON comment'
    );

    expect(mockSendTx).toHaveBeenCalledWith(
      token,
      'EQRecipient456',
      '1.0',
      12345,
      'TON comment'
    );
  });
});

describe('walletStore TON network state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useWalletStore.setState({
      isLoading: true,
      isInitialized: false,
      isUnlocked: false,
      hasWallet: false,
      network: 'sepolia',
      address: null,
      currentWalletName: null,
      walletList: [],
      accounts: [],
      currentAccountIndex: 0,
      balances: [],
      isRefreshingBalances: false,
      balancesLastUpdated: null,
      allNetworkHoldings: [],
      allNetworkTotals: {},
      allNetworksLastUpdated: null,
      isRefreshingAllNetworks: false,
      prices: {},
      totalValue: 0,
      formattedTotal: '$0.00',
      isLoadingPrices: false,
      transactions: [],
      isLoadingTransactions: false,
      transactionFilter: 'all',
      transactionsLastUpdated: null,
      networks: {},
      enabledNetworks: [],
      error: null,
    } as any);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  test('initialize loads TON networks', async () => {
    await useWalletStore.getState().initialize();

    const state = useWalletStore.getState();
    expect(state.networks['ton-mainnet']).toBeDefined();
    expect(state.networks['ton-mainnet'].type).toBe('ton');
  });
});
