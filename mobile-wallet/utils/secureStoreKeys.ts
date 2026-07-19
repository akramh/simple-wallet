/**
 * @fileoverview Secure store key constants shared across app layers.
 */

export const BIOMETRIC_ENABLED_KEY = 'wallet_biometric_enabled';
export const BIOMETRIC_PASSWORD_KEY = 'wallet_biometric_password';

export const INSTALL_ID_KEY = 'wallet_install_id';

/** SecureStore key holding a user-entered Alchemy API key (credential-like). */
export const ALCHEMY_API_KEY_KEY = 'wallet_alchemy_api_key';

export const BIOMETRIC_SECURE_KEYS = [BIOMETRIC_ENABLED_KEY, BIOMETRIC_PASSWORD_KEY];
