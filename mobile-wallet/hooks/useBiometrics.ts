/**
 * @fileoverview Hook for biometric authentication.
 */

import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'wallet_biometric_enabled';
const BIOMETRIC_PASSWORD_KEY = 'wallet_biometric_password';

interface BiometricState {
  isAvailable: boolean;
  isEnabled: boolean;
  biometricType: 'fingerprint' | 'facial' | 'iris' | null;
  isAuthenticating: boolean;
  error: string | null;
}

/**
 * Hook for managing biometric authentication.
 */
export function useBiometrics() {
  const [state, setState] = useState<BiometricState>({
    isAvailable: false,
    isEnabled: false,
    biometricType: null,
    isAuthenticating: false,
    error: null,
  });

  // Check biometric availability on mount
  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      let biometricType: 'fingerprint' | 'facial' | 'iris' | null = null;
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricType = 'facial';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricType = 'fingerprint';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricType = 'iris';
      }

      const enabledString = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      const isEnabled = enabledString === 'true';

      setState((prev) => ({
        ...prev,
        isAvailable: hasHardware && isEnrolled,
        isEnabled,
        biometricType,
      }));
    } catch (error) {
      console.error('Failed to check biometrics:', error);
      setState((prev) => ({ ...prev, isAvailable: false }));
    }
  }, []);

  /**
   * Authenticate using biometrics.
   * Returns the stored password if successful, null otherwise.
   */
  const authenticate = useCallback(async (): Promise<string | null> => {
    if (!state.isAvailable || !state.isEnabled) {
      setState((prev) => ({ ...prev, error: 'Biometrics not available or enabled' }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, isAuthenticating: true, error: null }));

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock your wallet',
        fallbackLabel: 'Use password',
        disableDeviceFallback: false,
      });

      if (result.success) {
        const password = await SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY);
        setState((prev) => ({ ...prev, isAuthenticating: false }));
        return password;
      } else {
        const errorMessage =
          result.error === 'user_cancel'
            ? 'Authentication cancelled'
            : result.error === 'user_fallback'
            ? 'Use password instead'
            : 'Authentication failed';

        setState((prev) => ({
          ...prev,
          isAuthenticating: false,
          error: errorMessage,
        }));
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setState((prev) => ({ ...prev, isAuthenticating: false, error: message }));
      return null;
    }
  }, [state.isAvailable, state.isEnabled]);

  /**
   * Enable biometric authentication and store password securely.
   */
  const enable = useCallback(async (password: string): Promise<boolean> => {
    if (!state.isAvailable) {
      setState((prev) => ({ ...prev, error: 'Biometrics not available' }));
      return false;
    }

    try {
      // Verify user can authenticate first
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable biometric unlock',
        fallbackLabel: 'Cancel',
      });

      if (!result.success) {
        return false;
      }

      // Store password securely
      await SecureStore.setItemAsync(BIOMETRIC_PASSWORD_KEY, password);
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');

      setState((prev) => ({ ...prev, isEnabled: true }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable biometrics';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, [state.isAvailable]);

  /**
   * Disable biometric authentication.
   */
  const disable = useCallback(async (): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_PASSWORD_KEY);
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'false');
      setState((prev) => ({ ...prev, isEnabled: false }));
    } catch (error) {
      console.error('Failed to disable biometrics:', error);
    }
  }, []);

  /**
   * Clear error state.
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Get human-readable biometric type name.
   */
  const getBiometricName = useCallback(() => {
    switch (state.biometricType) {
      case 'facial':
        return 'Face ID';
      case 'fingerprint':
        return 'Touch ID';
      case 'iris':
        return 'Iris Scan';
      default:
        return 'Biometrics';
    }
  }, [state.biometricType]);

  return {
    ...state,
    authenticate,
    enable,
    disable,
    clearError,
    getBiometricName,
  };
}
