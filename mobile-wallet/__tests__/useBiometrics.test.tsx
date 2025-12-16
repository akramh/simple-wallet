/**
 * @fileoverview Hook tests for biometric unlock.
 *
 * Uses renderHook to exercise the hook behavior with mocked
 * LocalAuthentication and SecureStore.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { useBiometrics } from '../hooks/useBiometrics';

test('enable stores password and sets enabled flag', async () => {
  const { result } = renderHook(() => useBiometrics());

  await waitFor(() => expect(result.current.isAvailable).toBe(true));

  await act(async () => {
    await result.current.enable('pw123');
  });

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_password', 'pw123');
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


