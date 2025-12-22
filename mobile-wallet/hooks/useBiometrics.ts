/**
 * @fileoverview Hook for biometric authentication.
 *
 * @responsibilities
 * - Detect biometric capability + enrollment state on device
 * - Manage "biometric unlock enabled" setting
 * - Provide authenticate/enable/disable helpers used by the unlock screen
 *
 * @security
 * - Password is stored using SecureStore's `requireAuthentication: true` option,
 *   which enforces OS-level biometric verification before releasing the secret.
 * - On iOS, this uses Keychain with kSecAccessControlBiometryAny access control.
 * - On Android, this uses Android Keystore with biometric-gated keys (API 23+).
 * - Keys are invalidated when biometric settings change (new fingerprint, etc.).
 */

import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { BIOMETRIC_ENABLED_KEY, BIOMETRIC_PASSWORD_KEY } from '../utils/secureStoreKeys';

/** Secure storage options for biometric-protected password */
const BIOMETRIC_SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to unlock your wallet',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface BiometricState {
  isAvailable: boolean;
  isEnabled: boolean;
  biometricType: 'fingerprint' | 'facial' | 'iris' | null;
  isAuthenticating: boolean;
  error: string | null;
}

/**
 * Hook for managing biometric authentication.
 *
 * @returns Biometric state and helper actions for auth/enable/disable flows.
 */
export function useBiometrics() {
  const [state, setState] = useState<BiometricState>({
    isAvailable: false,
    isEnabled: false,
    biometricType: null,
    isAuthenticating: false,
    error: null,
  });

  /** Check biometric availability and enabled state on mount. */
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
   *
   * @returns Stored password string (if available) or null on failure/cancel.
   *
   * @security
   * - Uses OS-level biometric gating via SecureStore's `requireAuthentication`.
   * - The biometric prompt is handled by the OS (Keychain on iOS, Keystore on Android),
   *   not by LocalAuthentication, making it resistant to runtime bypass attacks.
   * - Never log the returned password.
   */
  const authenticate = useCallback(async (): Promise<string | null> => {
    if (!state.isAvailable || !state.isEnabled) {
      setState((prev) => ({ ...prev, error: 'Biometrics not available or enabled' }));
      return null;
    }

    try {
      setState((prev) => ({ ...prev, isAuthenticating: true, error: null }));

      // The biometric prompt is triggered automatically by SecureStore when
      // requireAuthentication: true. The OS handles the biometric verification
      // at the hardware/Secure Enclave level before releasing the secret.
      const password = await SecureStore.getItemAsync(
        BIOMETRIC_PASSWORD_KEY,
        BIOMETRIC_SECURE_OPTIONS
      );

      setState((prev) => ({ ...prev, isAuthenticating: false }));

      if (!password) {
        // Key may have been invalidated (e.g., biometric settings changed)
        setState((prev) => ({
          ...prev,
          error: 'Biometric key expired. Please re-enable biometrics.',
          isEnabled: false,
        }));
        // Clean up stale enabled flag
        await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'false');
        return null;
      }

      return password;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';

      // Handle user cancellation or authentication failure
      const isUserCancel = message.includes('cancel') || message.includes('Cancel');
      const displayMessage = isUserCancel ? 'Authentication cancelled' : message;

      setState((prev) => ({ ...prev, isAuthenticating: false, error: displayMessage }));
      return null;
    }
  }, [state.isAvailable, state.isEnabled]);

  /**
   * Enable biometric authentication and store password securely.
   *
   * @param password - Current wallet password to store for biometric unlock.
   * @returns True if enabled and stored successfully; false otherwise.
   *
   * @security
   * - Password is stored with `requireAuthentication: true`, binding it to
   *   OS-level biometric verification.
   * - On iOS, stored in Keychain with kSecAccessControlBiometryAny.
   * - On Android, uses biometric-gated Android Keystore keys.
   */
  const enable = useCallback(async (password: string): Promise<boolean> => {
    if (!state.isAvailable) {
      setState((prev) => ({ ...prev, error: 'Biometrics not available' }));
      return false;
    }

    try {
      // Store password with biometric protection.
      // On iOS, setting a new value doesn't require authentication (only reading does).
      // On Android, the biometric prompt appears during setItemAsync.
      await SecureStore.setItemAsync(
        BIOMETRIC_PASSWORD_KEY,
        password,
        BIOMETRIC_SECURE_OPTIONS
      );

      // Store enabled flag separately (not biometric-protected)
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
   *
   * Clears any stored password for biometric unlock.
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
   *
   * @returns Display name (Face ID / Touch ID / Iris Scan).
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
