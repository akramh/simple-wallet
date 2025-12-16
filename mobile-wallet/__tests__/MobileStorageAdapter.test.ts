/**
 * @fileoverview Tests for MobileStorageAdapter persistence policy.
 *
 * Verifies that sensitive keys (wallets.json) are persisted to SecureStore and
 * non-sensitive keys are persisted to AsyncStorage.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { MobileStorageAdapter } from '../services/MobileStorageAdapter';

describe('MobileStorageAdapter', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear in-memory storage in mocks
    await (AsyncStorage as any).clear?.();
  });

  test('writeJSON wallets.json uses SecureStore', async () => {
    const adapter = new MobileStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('wallets.json', { default: { encryptedMnemonic: 'x' } });

    // persistAsync is fire-and-forget; wait a tick for the async work to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    const [key] = (SecureStore.setItemAsync as any).mock.calls[0];
    expect(key).toBe('wallet_wallets_json');
  });

  test('writeJSON config.json uses AsyncStorage', async () => {
    const adapter = new MobileStorageAdapter();
    await adapter.initialize();

    adapter.writeJSON('config.json', { network: 'sepolia' });
    await new Promise((r) => setTimeout(r, 0));

    expect(AsyncStorage.setItem).toHaveBeenCalled();
    const [key] = (AsyncStorage.setItem as any).mock.calls[0];
    expect(key).toBe('wallet_config_json');
  });
});


