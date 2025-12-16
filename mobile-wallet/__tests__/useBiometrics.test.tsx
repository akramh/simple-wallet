/**
 * @fileoverview Hook tests for biometric unlock.
 *
 * Uses a small test component to exercise the hook behavior with mocked
 * LocalAuthentication and SecureStore.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { useBiometrics } from '../hooks/useBiometrics';

function Harness({
  onReady,
}: {
  onReady: (api: ReturnType<typeof useBiometrics>) => void;
}) {
  const api = useBiometrics();
  useEffect(() => onReady(api), [api, onReady]);
  return <Text testID="ready">ready</Text>;
}

test('enable stores password and sets enabled flag', async () => {
  let api: any;
  render(<Harness onReady={(a) => { api = a; }} />);

  await waitFor(() => expect(api.isAvailable).toBe(true));

  await act(async () => {
    await api.enable('pw123');
  });

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_password', 'pw123');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_enabled', 'true');
});

test('disable clears stored password and disables flag', async () => {
  let api: any;
  render(<Harness onReady={(a) => { api = a; }} />);

  await act(async () => {
    await api.disable();
  });

  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('wallet_biometric_password');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wallet_biometric_enabled', 'false');
});


