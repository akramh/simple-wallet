/**
 * @fileoverview Persistence for the user-entered Alchemy API key and the
 * onboarding-skip flag.
 *
 * @responsibilities
 * - Store/retrieve/clear the runtime Alchemy key in expo-secure-store
 *   (OS Keychain/Keystore — the key is a credential, not app state)
 * - Store the "setup dismissed" flag in AsyncStorage (not a secret)
 *
 * @security The key must never be written to AsyncStorage or logged. Reads
 * never throw — a broken secure store degrades to "no key" rather than
 * crashing startup.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALCHEMY_API_KEY_KEY } from '../utils/secureStoreKeys';

/** AsyncStorage flag: the user skipped the Alchemy onboarding step. */
const SETUP_DISMISSED_KEY = 'wallet_alchemy_setup_dismissed';

/**
 * Reads the stored Alchemy key.
 * @returns The key, or null when unset or the secure store is unavailable.
 * @async
 */
export async function getStoredAlchemyKey(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(ALCHEMY_API_KEY_KEY);
    return value && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Persists a key to the secure store.
 * @throws When the secure store write fails (caller surfaces the error).
 * @async
 */
export async function saveAlchemyKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ALCHEMY_API_KEY_KEY, key.trim());
}

/**
 * Removes the stored key. Never throws.
 * @async
 */
export async function clearAlchemyKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ALCHEMY_API_KEY_KEY);
  } catch {
    // Missing entry / unavailable store — nothing to clear.
  }
}

/**
 * Whether the user dismissed the onboarding step. Never throws.
 * @async
 */
export async function getSetupDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SETUP_DISMISSED_KEY)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists the onboarding-skip flag. Never throws.
 * @async
 */
export async function setSetupDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(SETUP_DISMISSED_KEY, 'true');
  } catch {
    // Non-critical — worst case the prompt shows again next launch.
  }
}
