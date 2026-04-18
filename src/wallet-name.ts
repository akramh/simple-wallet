/**
 * @fileoverview Wallet name validation helpers shared across wallet UIs.
 *
 * @responsibilities
 * - Keep wallet-name validation consistent between UI preflight checks and service boundaries
 * - Bound wallet names used as storage keys and derived cache keys
 *
 * @security
 * - Wallet names are not secrets, but they are used in storage keys such as transaction history
 * - Validation intentionally allows only letters, numbers, and hyphens to avoid ambiguous key names
 */

/** Maximum number of characters allowed in a user-assigned wallet name. */
export const MAX_WALLET_NAME_LENGTH = 32;

/** Human-readable wallet-name requirements for form hints and validation errors. */
export const WALLET_NAME_REQUIREMENTS = `1-${MAX_WALLET_NAME_LENGTH} letters, numbers, or hyphens`;

const WALLET_NAME_PATTERN = new RegExp(`^[A-Za-z0-9-]{1,${MAX_WALLET_NAME_LENGTH}}$`);

/**
 * Validate a user-assigned wallet name for storage-key use.
 *
 * @param name - Candidate wallet name to validate.
 * @returns True when the name is 1-32 characters and contains only letters, numbers, or hyphens.
 */
export function isValidWalletName(name: unknown): name is string {
  return typeof name === 'string' && WALLET_NAME_PATTERN.test(name);
}

/**
 * Get the standard wallet-name validation error message.
 *
 * @returns User-facing validation message matching the shared wallet-name policy.
 */
export function getWalletNameValidationMessage(): string {
  return `Wallet name must be ${WALLET_NAME_REQUIREMENTS}`;
}
