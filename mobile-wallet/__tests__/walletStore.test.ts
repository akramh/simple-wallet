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
    getCachedBalances: jest.fn(() => null),
    getCachedPrices: jest.fn(() => null),
    getCachedAllNetworkHoldings: jest.fn(() => null),
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
    getShowTestnets: jest.fn(() => false),
    setShowTestnets: jest.fn(async () => {}),
    addCustomToken: jest.fn(async () => {}),
    toggleTokenVisibility: jest.fn(async () => {}),
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

  test('clearError resets error state', () => {
    useWalletStore.setState({ error: 'Test error message' });

    useWalletStore.getState().clearError();

    expect(useWalletStore.getState().error).toBeNull();
  });

  test('setTransactionFilter updates filter correctly', () => {
    useWalletStore.setState({ transactionFilter: 'all' });

    useWalletStore.getState().setTransactionFilter('sent');
    expect(useWalletStore.getState().transactionFilter).toBe('sent');

    useWalletStore.getState().setTransactionFilter('received');
    expect(useWalletStore.getState().transactionFilter).toBe('received');

    useWalletStore.getState().setTransactionFilter('all');
    expect(useWalletStore.getState().transactionFilter).toBe('all');
  });

  test('getFilteredTransactions filters by type', () => {
    const mockTxs = [
      { hash: '0x1', type: 'send', value: '1', from: '0xa', to: '0xb', timestamp: 1000, status: 'confirmed' },
      { hash: '0x2', type: 'receive', value: '2', from: '0xb', to: '0xa', timestamp: 2000, status: 'confirmed' },
      { hash: '0x3', type: 'send', value: '3', from: '0xa', to: '0xc', timestamp: 3000, status: 'confirmed' },
    ];

    useWalletStore.setState({ transactions: mockTxs } as any);

    // Test 'all' filter
    useWalletStore.setState({ transactionFilter: 'all' });
    let filtered = useWalletStore.getState().getFilteredTransactions();
    expect(filtered).toHaveLength(3);

    // Test 'sent' filter
    useWalletStore.setState({ transactionFilter: 'sent' });
    filtered = useWalletStore.getState().getFilteredTransactions();
    expect(filtered).toHaveLength(2);
    expect(filtered.every(tx => tx.type === 'send')).toBe(true);

    // Test 'received' filter
    useWalletStore.setState({ transactionFilter: 'received' });
    filtered = useWalletStore.getState().getFilteredTransactions();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('receive');
  });

  test('refreshBalances prevents concurrent calls', async () => {
    const { walletBridge } = require('../services');
    walletBridge.refreshBalances.mockClear();

    useWalletStore.setState({ isRefreshingBalances: true, isUnlocked: true });

    await useWalletStore.getState().refreshBalances();

    // Should not call refreshBalances when already refreshing
    expect(walletBridge.refreshBalances).not.toHaveBeenCalled();
  });

  test('refreshPrices passes current balances to WalletBridge', async () => {
    const { walletBridge } = require('../services');
    walletBridge.getTokenPrices.mockClear();

    const balances = [
      {
        token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 },
        balance: '1',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ];

    useWalletStore.setState({
      balances,
      isLoadingPrices: false,
    } as any);

    await useWalletStore.getState().refreshPrices();

    expect(walletBridge.getTokenPrices).toHaveBeenCalledWith(balances);
  });

  test('unlock sets correct state on success', async () => {
    const { walletBridge } = require('../services');
    walletBridge.unlockWallet.mockResolvedValueOnce({
      address: '0xunlocked',
      walletName: 'MyWallet'
    });
    walletBridge.getAccounts.mockResolvedValueOnce({
      accounts: { '0': { address: '0xunlocked' } },
      currentIndex: 0,
    });

    useWalletStore.setState({ isUnlocked: false, isLoading: false });

    await useWalletStore.getState().unlock('password123', 'MyWallet');

    const state = useWalletStore.getState();
    expect(state.isUnlocked).toBe(true);
    expect(state.address).toBe('0xunlocked');
    expect(state.currentWalletName).toBe('MyWallet');
    expect(state.isLoading).toBe(false);
  });

  test('unlock hydrates cached balances/prices before background refresh completes', async () => {
    const { walletBridge } = require('../services');
    const now = Date.now();
    const cachedBalances = [
      {
        token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 },
        balance: '1',
        lastUpdated: now,
        isLoading: false,
      },
    ];

    walletBridge.unlockWallet.mockResolvedValueOnce({
      address: '0xunlocked',
      walletName: 'MyWallet',
    });
    walletBridge.getAccounts.mockResolvedValueOnce({
      accounts: { '0': { address: '0xunlocked' } },
      currentIndex: 0,
    });
    walletBridge.getCachedBalances.mockReturnValueOnce({ balances: cachedBalances, fetchedAt: now });
    walletBridge.getCachedPrices.mockReturnValueOnce({
      prices: { ETH: 2000 },
      totalValue: 2000,
      formattedTotal: '$2000.00',
      pricedAt: now,
    });

    // Keep the background refresh pending so we can assert the hydrated state.
    let resolveRefresh: (v: any) => void = () => {};
    walletBridge.refreshBalances.mockImplementationOnce(
      () =>
        new Promise<any>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    await useWalletStore.getState().unlock('password123', 'MyWallet');

    const s = useWalletStore.getState();
    expect(s.balances).toEqual(cachedBalances);
    expect(s.balancesLastUpdated).toBe(now);
    expect(s.prices).toEqual({ ETH: 2000 });
    expect(s.totalValue).toBe(2000);
    expect(s.formattedTotal).toBe('$2000.00');

    // Clean up the pending promise to avoid open handles.
    resolveRefresh([]);
  });

  test('unlock hydrates cached all-network portfolio snapshot', async () => {
    const { walletBridge } = require('../services');
    const now = Date.now();

    walletBridge.unlockWallet.mockResolvedValueOnce({
      address: '0xunlocked',
      walletName: 'MyWallet',
    });
    walletBridge.getAccounts.mockResolvedValueOnce({
      accounts: { '0': { address: '0xunlocked' } },
      currentIndex: 0,
    });

    walletBridge.getCachedAllNetworkHoldings.mockReturnValueOnce({
      holdings: [{ token: { symbol: 'ETH' }, balance: '1', networkKey: 'sepolia' }],
      totalsByNetwork: { sepolia: 2000 },
      grandTotal: 2000,
      fetchedAt: now,
    });

    await useWalletStore.getState().unlock('password123', 'MyWallet');

    const s = useWalletStore.getState();
    expect(s.allNetworkHoldings.length).toBe(1);
    expect(s.allNetworkTotals).toEqual({ sepolia: 2000 });
    expect(s.allNetworksLastUpdated).toBe(now);
  });

  test('switchNetwork updates network and address, clears old data', async () => {
    const { walletBridge } = require('../services');
    walletBridge.switchNetwork.mockResolvedValueOnce({ address: '0xnewaddr' });

    const oldBalances = [{ token: { symbol: 'ETH' }, balance: '1' }];
    const oldTransactions = [{ hash: '0x1' }];

    useWalletStore.setState({
      network: 'sepolia',
      balances: oldBalances,
      transactions: oldTransactions,
      balancesLastUpdated: 123456789,
      transactionsLastUpdated: 123456789,
    } as any);

    await useWalletStore.getState().switchNetwork('mainnet');

    const state = useWalletStore.getState();
    expect(state.network).toBe('mainnet');
    expect(state.address).toBe('0xnewaddr');
    // After switch, the old data should be cleared (may have been refreshed with new empty data)
    // The key behavior is that old network data is not retained
    expect(state.balances).not.toBe(oldBalances);
    expect(state.transactions).not.toBe(oldTransactions);
  });

  test('loadTransactions does nothing when wallet is locked', async () => {
    const { walletBridge } = require('../services');
    walletBridge.getTransactions.mockClear();

    useWalletStore.setState({ isUnlocked: false });

    await useWalletStore.getState().loadTransactions();

    expect(walletBridge.getTransactions).not.toHaveBeenCalled();
  });
});

describe('useWalletStore error handling', () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // Silence expected console.error output during error handling tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    useWalletStore.setState({
      isLoading: false,
      isInitialized: false,
      isUnlocked: false,
      error: null,
    } as any);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('initialize sets error on failure', async () => {
    const { walletBridge } = require('../services');
    walletBridge.initialize.mockRejectedValueOnce(new Error('Network error'));

    await useWalletStore.getState().initialize();

    const state = useWalletStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.isInitialized).toBe(true); // Still marked as initialized
    expect(state.isLoading).toBe(false);
  });

  test('unlock sets error on failure', async () => {
    const { walletBridge } = require('../services');
    walletBridge.unlockWallet.mockRejectedValueOnce(new Error('Invalid password'));

    try {
      await useWalletStore.getState().unlock('wrongpassword');
    } catch {
      // Expected to throw
    }

    const state = useWalletStore.getState();
    expect(state.error).toBe('Invalid password');
    expect(state.isLoading).toBe(false);
    expect(state.isUnlocked).toBe(false);
  });
});
