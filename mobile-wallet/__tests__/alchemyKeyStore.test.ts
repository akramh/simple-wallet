/**
 * @fileoverview Tests for the Alchemy key SecureStore wrapper and the
 * onboarding-dismissal flag. Uses the global expo-secure-store /
 * AsyncStorage mocks from jest.setup.js — no native or network access.
 */

import * as SecureStore from 'expo-secure-store';
import {
  getStoredAlchemyKey,
  saveAlchemyKey,
  clearAlchemyKey,
  getSetupDismissed,
  setSetupDismissed,
} from '../services/alchemyKeyStore';
import { ALCHEMY_API_KEY_KEY } from '../utils/secureStoreKeys';

describe('alchemyKeyStore', () => {
  beforeEach(async () => {
    await clearAlchemyKey();
  });

  it('returns null when no key is stored', async () => {
    expect(await getStoredAlchemyKey()).toBeNull();
  });

  it('round-trips a saved key through SecureStore', async () => {
    await saveAlchemyKey('test-alchemy-key-1234');
    expect(await getStoredAlchemyKey()).toBe('test-alchemy-key-1234');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      ALCHEMY_API_KEY_KEY,
      'test-alchemy-key-1234'
    );
  });

  it('trims whitespace on save and read', async () => {
    await saveAlchemyKey('  padded-key-123456  ');
    expect(await getStoredAlchemyKey()).toBe('padded-key-123456');
  });

  it('clearAlchemyKey removes the stored key', async () => {
    await saveAlchemyKey('key-to-remove-1234');
    await clearAlchemyKey();
    expect(await getStoredAlchemyKey()).toBeNull();
  });

  it('treats an empty stored value as no key', async () => {
    await (SecureStore.setItemAsync as jest.Mock)(ALCHEMY_API_KEY_KEY, '   ');
    expect(await getStoredAlchemyKey()).toBeNull();
  });

  it('returns null instead of throwing when SecureStore fails', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain down'));
    expect(await getStoredAlchemyKey()).toBeNull();
  });

  it('setup-dismissed flag defaults to false and persists once set', async () => {
    expect(await getSetupDismissed()).toBe(false);
    await setSetupDismissed();
    expect(await getSetupDismissed()).toBe(true);
  });
});
