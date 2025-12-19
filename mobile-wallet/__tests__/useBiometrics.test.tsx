/**
 * @fileoverview Hook tests for biometric unlock.
 *
 * Uses renderHook to exercise the hook behavior with mocked
 * LocalAuthentication and SecureStore.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { useBiometrics } from '../hooks/useBiometrics';

/** Expected secure options for biometric-protected storage */
const EXPECTED_SECURE_OPTIONS = {
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to unlock your wallet',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

test('enable stores password with biometric protection', async () => {
  const { result } = renderHook(() => useBiometrics());

  await waitFor(() => expect(result.current.isAvailable).toBe(true));

  await act(async () => {
    await result.current.enable('pw123');
  });

  // Password stored with requireAuthentication (OS-level biometric gating)
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'wallet_biometric_password',
    'pw123',
    EXPECTED_SECURE_OPTIONS
  );
  // Enabled flag stored separately (no auth required to read)
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_enabled', 'true');
});

test('disable clears stored password and disables flag', async () => {
  const { result } = renderHook(() => useBiometrics());

  await act(async () => {
    await result.current.disable();
  });

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('wallet_biometric_password');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_enabled', 'false');
});

test('authenticate retrieves password with biometric verification', async () => {
  // Setup: mock enabled state and stored password
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    if (key === 'wallet_biometric_enabled') return 'true';
    if (key === 'wallet_biometric_password') return 'storedPw';
    return null;
  });

  const { result } = renderHook(() => useBiometrics());

  await waitFor(() => expect(result.current.isAvailable).toBe(true));
  await waitFor(() => expect(result.current.isEnabled).toBe(true));

  let password: string | null = null;
  await act(async () => {
    password = await result.current.authenticate();
  });

  expect(password).toBe('storedPw');
  // Password retrieval should use biometric protection options
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith(
    'wallet_biometric_password',
    EXPECTED_SECURE_OPTIONS
  );
});

test('authenticate handles key invalidation gracefully', async () => {
  // Simulate key invalidated (biometric settings changed)
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    if (key === 'wallet_biometric_enabled') return 'true';
    if (key === 'wallet_biometric_password') return null; // Key was invalidated
    return null;
  });

  const { result } = renderHook(() => useBiometrics());

  await waitFor(() => expect(result.current.isEnabled).toBe(true));

  let password: string | null = 'initial';
  await act(async () => {
    password = await result.current.authenticate();
  });

  expect(password).toBeNull();
  expect(result.current.error).toContain('expired');
  // Should disable biometrics since key is invalid
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_enabled', 'false');
});
