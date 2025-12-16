/**
 * @fileoverview Unit tests for the Zustand wallet store state machine.
 *
 * These tests focus on invariants and state transitions (lock/unlock/reset)
 * without invoking the real shared SDK. WalletBridge is mocked.
 */

import { describe, test, beforeEach, expect, jest } from '@jest/globals';

// Mock the services barrel used by walletStore.ts
jest.mock('../services', () => {
  const walletBridge = {
    initialize: jest.fn(async () => {}),
    getState: jest.fn(async () => ({
      isUnlocked: false,
      hasWallet: false,
      network: 'sepolia',
      address: null,
      currentWalletName: null,
    })),
    getNetworks: jest.fn(async () => ({ sepolia: { name: 'Sepolia', nativeSymbol: 'ETH' } })),
    getAllWallets: jest.fn(async () => ({})),
    lockWallet: jest.fn(async () => {}),
    unlockWallet: jest.fn(async () => ({ success: true, address: '0xabc', walletName: 'default' })),
    refreshBalances: jest.fn(async () => []),
    getTokenPrices: jest.fn(async () => ({ prices: {}, totalValue: 0, formattedTotal: '$0.00' })),
    getTransactions: jest.fn(async () => []),
    switchNetwork: jest.fn(async () => ({ address: '0xabc' })),
    getAccounts: jest.fn(async () => ({ accounts: {}, currentIndex: 0 })),
    switchAccount: jest.fn(async () => ({ address: '0xabc' })),
    createAccount: jest.fn(async () => ({ address: '0xdef', accountIndex: 1 })),
    sendTransaction: jest.fn(async () => ({ hash: '0xhash', status: 'confirmed' })),
    getGasEstimate: jest.fn(async () => ({
      gasLimit: '21000',
      gasPrice: '1',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '21000',
      estimatedCostNative: '0.000021',
      nativeSymbol: 'ETH',
      supportsEIP1559: false,
      network: 'sepolia',
    })),
  };

  return {
    __esModule: true,
    walletBridge,
  };
});

import { useWalletStore } from '../store/walletStore';

describe('useWalletStore invariants', () => {
  beforeEach(() => {
    // Reset Zustand store between tests
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
      prices: {},
      totalValue: 0,
      formattedTotal: '$0.00',
      isLoadingPrices: false,
      transactions: [],
      isLoadingTransactions: false,
      transactionFilter: 'all',
      transactionsLastUpdated: null,
      networks: {},
      error: null,
    } as any);
  });

  test('initialize populates base state and does not throw', async () => {
    await useWalletStore.getState().initialize();
    const s = useWalletStore.getState();
    expect(s.isInitialized).toBe(true);
    expect(s.isLoading).toBe(false);
    expect(s.network).toBe('sepolia');
  });

  test('lock clears derived state (address, balances, txs, prices, accounts)', async () => {
    useWalletStore.setState({
      isUnlocked: true,
      address: '0xabc',
      currentWalletName: 'default',
      balances: [{ token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 }, balance: '1', lastUpdated: Date.now(), isLoading: false }],
      transactions: [{ hash: '0x1', from: '0x', to: '0x', value: '1', network: 'sepolia', status: 'confirmed', type: 'send', timestamp: Date.now() }],
      prices: { ETH: 1000 },
      totalValue: 1000,
      formattedTotal: '$1000.00',
      accounts: [{ index: 0, address: '0xabc' }],
      currentAccountIndex: 1,
    } as any);

    await useWalletStore.getState().lock();
    const s = useWalletStore.getState();
    expect(s.isUnlocked).toBe(false);
    expect(s.address).toBeNull();
    expect(s.currentWalletName).toBeNull();
    expect(s.balances).toEqual([]);
    expect(s.transactions).toEqual([]);
    expect(s.prices).toEqual({});
    expect(s.totalValue).toBe(0);
    expect(s.accounts).toEqual([]);
    expect(s.currentAccountIndex).toBe(0);
  });
});


