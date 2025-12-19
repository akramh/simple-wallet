/**
 * @fileoverview Unit tests for useWallet hook.
 */

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock the store
const mockStore = {
  isInitialized: true,
  isLoading: false,
  isUnlocked: true,
  hasWallet: true,
  address: '0x1234567890abcdef1234567890abcdef12345678',
  network: 'sepolia',
  networks: {
    sepolia: { name: 'Sepolia', nativeSymbol: 'ETH', chainId: 11155111 },
    mainnet: { name: 'Ethereum', nativeSymbol: 'ETH', chainId: 1 },
  },
  currentWalletName: 'TestWallet',
  error: null,
  initialize: jest.fn(),
  createWallet: jest.fn(),
  importWallet: jest.fn(),
  unlock: jest.fn(),
  lock: jest.fn(),
  switchNetwork: jest.fn(),
  clearError: jest.fn(),
};

jest.mock('../store', () => ({
  __esModule: true,
  useWalletStore: () => mockStore,
}));

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => {}),
}));

import { useWallet } from '../hooks/useWallet';

describe('useWallet hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns wallet state', () => {
    const { result } = renderHook(() => useWallet());

    expect(result.current.isInitialized).toBe(true);
    expect(result.current.isUnlocked).toBe(true);
    expect(result.current.hasWallet).toBe(true);
    expect(result.current.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.current.network).toBe('sepolia');
    expect(result.current.currentWalletName).toBe('TestWallet');
  });

  test('returns network config for current network', () => {
    const { result } = renderHook(() => useWallet());

    expect(result.current.networkConfig).toEqual({
      name: 'Sepolia',
      nativeSymbol: 'ETH',
      chainId: 11155111,
    });
  });

  test('returns truncated address', () => {
    const { result } = renderHook(() => useWallet());

    expect(result.current.truncatedAddress).toBe('0x1234...5678');
  });

  test('returns null truncated address when no address', () => {
    mockStore.address = null as any;
    const { result } = renderHook(() => useWallet());

    expect(result.current.truncatedAddress).toBeNull();

    // Restore
    mockStore.address = '0x1234567890abcdef1234567890abcdef12345678';
  });

  test('copyAddress copies address to clipboard', async () => {
    const Clipboard = require('expo-clipboard');
    const { result } = renderHook(() => useWallet());

    let success: boolean;
    await act(async () => {
      success = await result.current.copyAddress();
    });

    expect(success!).toBe(true);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      '0x1234567890abcdef1234567890abcdef12345678'
    );
  });

  test('copyAddress returns false when no address', async () => {
    mockStore.address = null as any;
    const { result } = renderHook(() => useWallet());

    let success: boolean;
    await act(async () => {
      success = await result.current.copyAddress();
    });

    expect(success!).toBe(false);

    // Restore
    mockStore.address = '0x1234567890abcdef1234567890abcdef12345678';
  });

  test('returns all action functions', () => {
    const { result } = renderHook(() => useWallet());

    expect(typeof result.current.initialize).toBe('function');
    expect(typeof result.current.createWallet).toBe('function');
    expect(typeof result.current.importWallet).toBe('function');
    expect(typeof result.current.unlock).toBe('function');
    expect(typeof result.current.lock).toBe('function');
    expect(typeof result.current.switchNetwork).toBe('function');
    expect(typeof result.current.clearError).toBe('function');
    expect(typeof result.current.copyAddress).toBe('function');
  });
});
