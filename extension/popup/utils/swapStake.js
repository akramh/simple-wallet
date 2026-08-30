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
 * Estimate the next epoch boundary from the current slot offset.
 *
 * Solana targets roughly 400ms slots, so this is presentation guidance rather
 * than a chain guarantee. Invalid or complete epoch data returns null.
 *
 * @param {number | undefined} slotIndex - Current slot offset within the epoch.
 * @param {number | undefined} slotsInEpoch - Total slots in the current epoch.
 * @param {number} now - Current Unix timestamp in milliseconds.
 * @param {number} averageSlotMs - Display estimate per remaining slot.
 * @returns {number | null} Estimated boundary timestamp in milliseconds.
 */
export function estimateEpochBoundaryAt(
  slotIndex,
  slotsInEpoch,
  now,
  averageSlotMs = 400,
) {
  if (!Number.isFinite(slotIndex) || !Number.isFinite(slotsInEpoch) ||
      !Number.isFinite(now) || !Number.isFinite(averageSlotMs) ||
      slotIndex < 0 || slotsInEpoch <= 0 || slotIndex >= slotsInEpoch || averageSlotMs <= 0) {
    return null;
  }
  return now + (slotsInEpoch - slotIndex) * averageSlotMs;
}

/**
 * Calculate bounded epoch progress for display.
 *
 * @param {number | undefined} slotIndex - Current slot offset within the epoch.
 * @param {number | undefined} slotsInEpoch - Total slots in the current epoch.
 * @returns {number | null} Progress percentage from 0 through 100.
 */
export function epochProgressPercent(slotIndex, slotsInEpoch) {
  if (!Number.isFinite(slotIndex) || !Number.isFinite(slotsInEpoch) || slotsInEpoch <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, slotIndex / slotsInEpoch * 100));
}

/**
 * Build state-aware totals for the staking portfolio hero.
 *
 * Active, activating, and pending positions contribute to the staked balance.
 * Deactivating and withdrawable balances are reported separately so funds
 * leaving the staking lifecycle never inflate APY, rewards, or USD totals.
 *
 * @param {Array<{
 *   state: string,
 *   amountFormatted: string,
 *   totalFormatted?: string,
 *   usdValue?: number,
 *   lastRewardFormatted?: string,
 *   validator: { apyPercent: number | null }
 * }>} positions - Current wallet staking positions.
 * @param {number | null | undefined} nativePriceUsd - Current native-token price.
 * @returns {{
 *   total: number,
 *   usd: number | null,
 *   rewards: number,
 *   apy: number,
 *   deactivatingTotal: number,
 *   deactivatingCount: number,
 *   withdrawableTotal: number,
 *   withdrawableCount: number
 * }} State-aware portfolio totals.
 */
export function summarizeStakePositions(positions, nativePriceUsd) {
  const staked = positions.filter((position) =>
    position.state === 'active' || position.state === 'activating' || position.state === 'pending'
  );
  const deactivating = positions.filter((position) => position.state === 'deactivating');
  const withdrawable = positions.filter((position) => position.state === 'withdrawable');
  const amountOf = (position) => Number(position.amountFormatted) || 0;
  const total = staked.reduce((sum, position) => sum + amountOf(position), 0);
  const rewards = staked.reduce(
    (sum, position) => sum + (Number(position.lastRewardFormatted) || 0),
    0,
  );
  const weightedYield = staked.reduce(
    (sum, position) => sum + amountOf(position) * (position.validator.apyPercent ?? 0),
    0,
  );
  const hasNativePrice = typeof nativePriceUsd === 'number' && Number.isFinite(nativePriceUsd);
  const allStakedUsdKnown = staked.length > 0 && staked.every((position) =>
    typeof position.usdValue === 'number' && Number.isFinite(position.usdValue)
  );
  const reportedUsd = allStakedUsdKnown
    ? staked.reduce((sum, position) => {
        const delegated = amountOf(position);
        const accountTotal = Number(position.totalFormatted) || delegated;
        const delegatedShare = accountTotal > 0 ? delegated / accountTotal : 0;
        return sum + position.usdValue * delegatedShare;
      }, 0)
    : null;

  return {
    total,
    rewards,
    apy: total > 0 ? weightedYield / total : 0,
    usd: hasNativePrice ? total * nativePriceUsd : reportedUsd,
    deactivatingTotal: deactivating.reduce((sum, position) => sum + amountOf(position), 0),
    deactivatingCount: deactivating.length,
    withdrawableTotal: withdrawable.reduce((sum, position) => sum + amountOf(position), 0),
    withdrawableCount: withdrawable.length,
  };
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
