/**
 * @fileoverview Integration tests for the `recentNetworks` slice of the
 * wallet store: hydration on init, write-through on switchNetwork, dedupe,
 * and cap behavior.
 */

import { describe, test, beforeEach, expect, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../services', () => {
  const walletBridge = {
    initialize: jest.fn(async () => {}),
    getState: jest.fn(async () => ({
      isUnlocked: false,
      hasWallet: false,
      network: 'ethereum',
      address: null,
      currentWalletName: null,
    })),
    getNetworks: jest.fn(async () => ({
      ethereum: { name: 'Ethereum', nativeSymbol: 'ETH' },
      polygon: { name: 'Polygon', nativeSymbol: 'POL' },
      arbitrum: { name: 'Arbitrum', nativeSymbol: 'ETH' },
      base: { name: 'Base', nativeSymbol: 'ETH' },
    })),
    getAllWallets: jest.fn(async () => ({})),
    onLock: jest.fn(() => () => {}),
    getCachedBalances: jest.fn(() => null),
    getCachedPrices: jest.fn(() => null),
    refreshBalances: jest.fn(async () => []),
    getTokenPrices: jest.fn(async () => ({ prices: {}, totalValue: 0, formattedTotal: '$0.00' })),
    getTransactions: jest.fn(async () => []),
    switchNetwork: jest.fn(async (k: string) => ({ address: `0x${k}` })),
    getShowTestnets: jest.fn(() => false),
    setAutoLockTimeout: jest.fn(() => {}),
    getCachedAllNetworkHoldings: jest.fn(() => null),
  };
  return { __esModule: true, walletBridge };
});

import { useWalletStore } from '../store/walletStore';

const RECENT_KEY = 'mobile_recent_networks';

const resetState = () =>
  useWalletStore.setState({
    isLoading: false,
    isInitialized: true,
    isUnlocked: true,
    network: 'ethereum',
    networks: {
      ethereum: { name: 'Ethereum' },
      polygon: { name: 'Polygon' },
      arbitrum: { name: 'Arbitrum' },
      base: { name: 'Base' },
    },
    enabledNetworks: ['ethereum', 'polygon', 'arbitrum', 'base'],
    recentNetworks: [],
    error: null,
  } as any);

describe('recentNetworks slice', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetState();
    jest.clearAllMocks();
  });

  test('switchNetwork prepends the new network to recentNetworks', async () => {
    await useWalletStore.getState().switchNetwork('polygon');
    expect(useWalletStore.getState().recentNetworks).toEqual(['polygon']);

    await useWalletStore.getState().switchNetwork('arbitrum');
    expect(useWalletStore.getState().recentNetworks).toEqual(['arbitrum', 'polygon']);
  });

  test('switchNetwork dedupes — re-selecting an existing network moves it to the front', async () => {
    useWalletStore.setState({ recentNetworks: ['polygon', 'arbitrum'] } as any);

    await useWalletStore.getState().switchNetwork('arbitrum');
    expect(useWalletStore.getState().recentNetworks).toEqual(['arbitrum', 'polygon']);
  });

  test('switchNetwork persists to AsyncStorage under the documented key', async () => {
    await useWalletStore.getState().switchNetwork('polygon');
    const stored = await AsyncStorage.getItem(RECENT_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(['polygon']);
  });

  test('switchNetwork caps at 5 entries', async () => {
    useWalletStore.setState({
      recentNetworks: ['n1', 'n2', 'n3', 'n4', 'n5'],
    } as any);

    await useWalletStore.getState().switchNetwork('arbitrum');

    const state = useWalletStore.getState();
    expect(state.recentNetworks.length).toBe(5);
    expect(state.recentNetworks[0]).toBe('arbitrum');
    expect(state.recentNetworks).not.toContain('n5');
  });

  test('initialize hydrates recentNetworks from AsyncStorage', async () => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(['polygon', 'base']));

    // Force re-initialization — reset the isInitialized flag.
    useWalletStore.setState({
      isInitialized: false,
      networks: {},
      recentNetworks: [],
    } as any);

    await useWalletStore.getState().initialize();
    expect(useWalletStore.getState().recentNetworks).toEqual(['polygon', 'base']);
  });

  test('initialize ignores a non-array stored value', async () => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify({ not: 'an array' }));

    useWalletStore.setState({
      isInitialized: false,
      networks: {},
      recentNetworks: [],
    } as any);

    await useWalletStore.getState().initialize();
    expect(useWalletStore.getState().recentNetworks).toEqual([]);
  });
});
