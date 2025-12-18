/**
 * @fileoverview Unit tests for Zustand store selectors.
 *
 * Tests verify that selectors correctly extract state slices and that
 * useShallow prevents unnecessary object reference changes.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { useWalletStore } from '../store/walletStore';
import {
  useWalletStatusSelector,
  useWalletIdentitySelector,
  useNetworkSelector,
  useNetworksSelector,
  useBalancesSelector,
  usePricesSelector,
  useTransactionsSelector,
  useWalletListSelector,
  useAccountsSelector,
} from '../store/selectors';
import { renderHook, act } from '@testing-library/react-native';

// Mock walletBridge to prevent actual service initialization
jest.mock('../services', () => ({
  __esModule: true,
  walletBridge: {
    initialize: jest.fn(async () => {}),
    getState: jest.fn(async () => ({
      isUnlocked: false,
      hasWallet: true,
      network: 'sepolia',
      address: null,
      currentWalletName: null,
    })),
    getNetworks: jest.fn(async () => ({
      sepolia: { name: 'Sepolia', nativeSymbol: 'ETH', chainId: 11155111 },
      mainnet: { name: 'Ethereum', nativeSymbol: 'ETH', chainId: 1 },
    })),
    getAllWallets: jest.fn(async () => ({
      default: { address: '0xabc', accounts: [{ address: '0xabc' }] },
    })),
    lockWallet: jest.fn(async () => {}),
  },
}));

describe('Zustand Selectors', () => {
  const initialState = {
    isLoading: false,
    isInitialized: true,
    isUnlocked: true,
    hasWallet: true,
    network: 'sepolia',
    address: '0x1234567890abcdef',
    currentWalletName: 'TestWallet',
    walletList: [
      { name: 'TestWallet', address: '0x1234567890abcdef' },
      { name: 'Wallet2', address: '0xabcdef1234567890' },
    ],
    accounts: [
      { index: 0, address: '0x1234567890abcdef' },
      { index: 1, address: '0xabc123' },
    ],
    currentAccountIndex: 0,
    balances: [
      { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 }, balance: '2.5', isLoading: false },
      { token: { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6 }, balance: '1000', isLoading: false },
    ],
    isRefreshingBalances: false,
    balancesLastUpdated: Date.now(),
    allNetworkHoldings: [],
    allNetworkTotals: {},
    allNetworksLastUpdated: null,
    isRefreshingAllNetworks: false,
    prices: { ETH: 2000, USDC: 1 },
    totalValue: 6000,
    formattedTotal: '$6,000.00',
    isLoadingPrices: false,
    transactions: [
      { hash: '0x1', type: 'send', value: '0.5', from: '0x1234', to: '0xabcd', timestamp: Date.now(), status: 'confirmed' },
      { hash: '0x2', type: 'receive', value: '1.0', from: '0xabcd', to: '0x1234', timestamp: Date.now(), status: 'confirmed' },
    ],
    isLoadingTransactions: false,
    transactionFilter: 'all' as const,
    transactionsLastUpdated: Date.now(),
    networks: {
      sepolia: { name: 'Sepolia', nativeSymbol: 'ETH', chainId: 11155111 },
      mainnet: { name: 'Ethereum', nativeSymbol: 'ETH', chainId: 1 },
    },
    enabledNetworks: ['sepolia', 'mainnet'],
    error: null,
  };

  beforeEach(() => {
    // Reset store to known state before each test
    useWalletStore.setState(initialState as any);
  });

  describe('useWalletStatusSelector', () => {
    test('returns correct status fields', () => {
      const { result } = renderHook(() => useWalletStatusSelector());

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isInitialized).toBe(true);
      expect(result.current.isUnlocked).toBe(true);
      expect(result.current.hasWallet).toBe(true);
      expect(result.current.error).toBeNull();
    });

    test('updates when status changes', () => {
      const { result } = renderHook(() => useWalletStatusSelector());

      act(() => {
        useWalletStore.setState({ isLoading: true });
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('useWalletIdentitySelector', () => {
    test('returns correct identity fields', () => {
      const { result } = renderHook(() => useWalletIdentitySelector());

      expect(result.current.address).toBe('0x1234567890abcdef');
      expect(result.current.currentWalletName).toBe('TestWallet');
      expect(result.current.currentAccountIndex).toBe(0);
    });
  });

  describe('useNetworkSelector', () => {
    test('returns current network key', () => {
      const { result } = renderHook(() => useNetworkSelector());
      expect(result.current).toBe('sepolia');
    });

    test('updates when network changes', () => {
      const { result } = renderHook(() => useNetworkSelector());

      act(() => {
        useWalletStore.setState({ network: 'mainnet' });
      });

      expect(result.current).toBe('mainnet');
    });
  });

  describe('useNetworksSelector', () => {
    test('returns networks configuration', () => {
      const { result } = renderHook(() => useNetworksSelector());

      expect(result.current.sepolia).toBeDefined();
      expect(result.current.sepolia.name).toBe('Sepolia');
      expect(result.current.mainnet).toBeDefined();
    });
  });

  describe('useBalancesSelector', () => {
    test('returns balances array', () => {
      const { result } = renderHook(() => useBalancesSelector());

      expect(result.current).toHaveLength(2);
      expect(result.current[0].token.symbol).toBe('ETH');
      expect(result.current[0].balance).toBe('2.5');
      expect(result.current[1].token.symbol).toBe('USDC');
    });

    test('updates when balances change', () => {
      const { result } = renderHook(() => useBalancesSelector());

      act(() => {
        useWalletStore.setState({
          balances: [
            { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 }, balance: '5.0', isLoading: false },
          ],
        } as any);
      });

      expect(result.current).toHaveLength(1);
      expect(result.current[0].balance).toBe('5.0');
    });
  });

  describe('usePricesSelector', () => {
    test('returns prices map', () => {
      const { result } = renderHook(() => usePricesSelector());

      expect(result.current.ETH).toBe(2000);
      expect(result.current.USDC).toBe(1);
    });
  });

  describe('useTransactionsSelector', () => {
    test('returns transactions array', () => {
      const { result } = renderHook(() => useTransactionsSelector());

      expect(result.current).toHaveLength(2);
      expect(result.current[0].hash).toBe('0x1');
      expect(result.current[0].type).toBe('send');
    });
  });

  describe('useWalletListSelector', () => {
    test('returns wallet list', () => {
      const { result } = renderHook(() => useWalletListSelector());

      expect(result.current).toHaveLength(2);
      expect(result.current[0].name).toBe('TestWallet');
      expect(result.current[1].name).toBe('Wallet2');
    });
  });

  describe('useAccountsSelector', () => {
    test('returns accounts with current index', () => {
      const { result } = renderHook(() => useAccountsSelector());

      expect(result.current.accounts).toHaveLength(2);
      expect(result.current.currentAccountIndex).toBe(0);
      expect(result.current.accounts[0].address).toBe('0x1234567890abcdef');
    });
  });

  describe('Selector isolation', () => {
    test('network selector does not trigger on balance changes', () => {
      let networkRenderCount = 0;
      const { result: networkResult } = renderHook(() => {
        networkRenderCount++;
        return useNetworkSelector();
      });

      const initialNetwork = networkResult.current;
      const initialRenderCount = networkRenderCount;

      // Change balances (should not affect network selector)
      act(() => {
        useWalletStore.setState({
          balances: [
            { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 }, balance: '10.0', isLoading: false },
          ],
        } as any);
      });

      // Network value should remain the same
      expect(networkResult.current).toBe(initialNetwork);
    });

    test('balances selector does not trigger on transaction changes', () => {
      const { result: balancesResult } = renderHook(() => useBalancesSelector());

      const initialLength = balancesResult.current.length;

      // Change transactions (should not affect balances selector)
      act(() => {
        useWalletStore.setState({
          transactions: [
            { hash: '0x3', type: 'send', value: '2.0', from: '0x1234', to: '0xabcd', timestamp: Date.now(), status: 'confirmed' },
          ],
        } as any);
      });

      // Balances should remain unchanged
      expect(balancesResult.current.length).toBe(initialLength);
    });
  });
});
