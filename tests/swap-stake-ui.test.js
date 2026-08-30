/**
 * @file swap-stake-ui.test.js
 * @description Regression tests for the extension swap/staking presentation rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSolanaVoteAddress,
  quoteSecondsRemaining,
  stakingPositionAction,
  validateStakeAmount,
  validateSwapAmount,
} from '../extension/popup/utils/swapStake.js';

test('swap amounts accept a positive decimal within the available balance', () => {
  assert.equal(validateSwapAmount('1.25', '2'), null);
});

test('swap amounts reject malformed, zero, and over-balance inputs', () => {
  assert.match(validateSwapAmount('1e3', '2000'), /valid amount/i);
  assert.match(validateSwapAmount('0', '2'), /greater than 0/i);
  assert.match(validateSwapAmount('3', '2'), /insufficient balance/i);
});

test('stake validation enforces the network minimum without inventing a balance', () => {
  assert.match(validateStakeAmount('0.001', '0.01', undefined, 'SOL'), /Minimum 0\.01 SOL/);
  assert.equal(validateStakeAmount('0.5', '0.01', undefined, 'SOL'), null);
});

test('quote countdown rounds up and never becomes negative', () => {
  assert.equal(quoteSecondsRemaining(30_001, 1), 30);
  assert.equal(quoteSecondsRemaining(1_001, 1), 1);
  assert.equal(quoteSecondsRemaining(1, 2), 0);
});

test('staking position actions remain capability-gated', () => {
  assert.equal(stakingPositionAction('active', { canUnstake: true, canWithdraw: true }), 'unstake');
  assert.equal(stakingPositionAction('activating', { canUnstake: false, canWithdraw: true }), null);
  assert.equal(stakingPositionAction('withdrawable', { canUnstake: true, canWithdraw: true }), 'withdraw');
  assert.equal(stakingPositionAction('deactivating', { canUnstake: true, canWithdraw: true }), null);
});

test('manual validator entry preserves Solana base58 constraints', () => {
  assert.equal(isValidSolanaVoteAddress('11111111111111111111111111111111'), true);
  assert.equal(isValidSolanaVoteAddress('0OIl1111111111111111111111111111'), false);
});
