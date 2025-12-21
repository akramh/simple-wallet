/**
 * @fileoverview TON address validation utilities for mobile wallet.
 *
 * @responsibilities
 * - Provide TON address format validation for mobile UI
 * - Wrap shared SDK validation for React Native compatibility
 *
 * @module services/ton-utils
 */

/**
 * Validate a TON address string.
 *
 * TON addresses can be in two formats:
 * - Friendly: Base64url encoded (e.g., EQ... or UQ... for workchain 0)
 * - Raw: workchain:hex format (e.g., 0:abc123...)
 *
 * @param address - Address string to validate
 * @returns true if the address is a valid TON address
 *
 * @example
 * isValidTonAddress("UQBExample...") // true for valid non-bounceable
 * isValidTonAddress("EQBExample...") // true for valid bounceable
 * isValidTonAddress("0x123...") // false (Ethereum address)
 */
export function isValidTonAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Try to dynamically import and validate using the SDK
  // Use a try-catch since the SDK import might fail in some contexts
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isValidTonAddress: sdkValidate } = require('@wallet/ton/address.js');
    return sdkValidate(trimmed);
  } catch {
    // Fallback: basic format validation if SDK import fails
    // TON friendly addresses are 48 characters (base64url encoded)
    // and typically start with E (bounceable) or U (non-bounceable) for workchain 0

    // Raw format: workchain:64-char-hex
    if (/^-?\d+:[a-fA-F0-9]{64}$/.test(trimmed)) {
      return true;
    }

    // Friendly format: base64url, 48 chars for standard addresses
    // First char indicates bounceable (E) or non-bounceable (U) for workchain 0
    // Or other chars for different workchains
    if (/^[A-Za-z0-9_-]{48}$/.test(trimmed)) {
      // Additional check: should start with valid workchain prefix
      // E/U = workchain 0, k/0 = workchain -1 (masterchain)
      const firstChar = trimmed[0];
      return ['E', 'U', 'k', '0'].includes(firstChar) ||
             // Allow other base64 chars for edge cases
             /^[A-Za-z0-9]/.test(firstChar);
    }

    return false;
  }
}
