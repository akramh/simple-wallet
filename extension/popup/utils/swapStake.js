/**
 * @fileoverview Pure presentation rules shared by the extension swap and
 * staking screens.
 *
 * @responsibilities
 * - Validate human-unit amount inputs without rounding base units
 * - Derive quote countdown and staking-position action state
 * - Validate Solana vote addresses used by manual validator entry
 *
 * @security
 * - These helpers never receive or retain signing material.
 * - Amounts remain display strings; signing code performs base-unit parsing.
 */

/**
 * Validate a human-unit swap amount.
 *
 * @param {string} value - Decimal amount entered by the user.
 * @param {string | number | null | undefined} balance - Optional available balance in human units.
 * @returns {string | null} A user-facing error, or null when valid.
 */
export function validateSwapAmount(value, balance) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return 'Enter a valid amount';
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0) return 'Amount must be greater than 0';
  const available = balance === null || balance === undefined || balance === ''
    ? null
    : Number(balance);
  if (available !== null && Number.isFinite(available) && amount > available) {
    return 'Insufficient balance';
  }
  return null;
}

/**
 * Validate a human-unit stake amount against the network minimum and balance.
 *
 * @param {string} value - Decimal amount entered by the user.
 * @param {string | number} minimum - Network minimum in human units.
 * @param {string | number | null | undefined} balance - Optional available balance in human units.
 * @param {string} symbol - Native asset symbol used in error copy.
 * @returns {string | null} A user-facing error, or null when valid.
 */
export function validateStakeAmount(value, minimum, balance, symbol) {
  const basicError = validateSwapAmount(value, balance);
  if (basicError) return basicError;
  const amount = Number(value);
  const min = Number(minimum);
  if (Number.isFinite(min) && amount < min) return `Minimum ${minimum} ${symbol}`;
  return null;
}

/**
 * Return whole seconds remaining before a quote expires.
 *
 * @param {number} expiresAt - Quote expiry timestamp in epoch milliseconds.
 * @param {number} now - Current epoch timestamp in milliseconds.
 * @returns {number} Non-negative whole seconds, rounded up.
 */
export function quoteSecondsRemaining(expiresAt, now) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * Resolve the permitted primary action for a staking position.
 *
 * @param {string} state - Chain-neutral staking lifecycle state.
 * @param {{ canUnstake: boolean, canWithdraw: boolean }} capabilities - Network capability gates.
 * @returns {'unstake' | 'withdraw' | null} Permitted action, or null.
 */
export function stakingPositionAction(state, capabilities) {
  if ((state === 'active' || state === 'activating') && capabilities.canUnstake) return 'unstake';
  if (state === 'withdrawable' && capabilities.canWithdraw) return 'withdraw';
  return null;
}

/**
 * Validate a Solana base58 vote address without normalizing case.
 *
 * @param {string} value - Candidate validator vote address.
 * @returns {boolean} True when the address has a valid base58 shape and length.
 */
export function isValidSolanaVoteAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}
