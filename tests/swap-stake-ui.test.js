/**
 * @file swap-stake-ui.test.js
 * @description Regression tests for the extension swap/staking presentation rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  epochProgressPercent,
  estimateEpochBoundaryAt,
  isValidSolanaVoteAddress,
  quoteSecondsRemaining,
  stakingPositionAction,
  validateStakeAmount,
  validateSwapAmount,
} from '../extension/popup/utils/swapStake.js';

const popupCss = readFileSync(new URL('../extension/popup/popup.css', import.meta.url), 'utf8');

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

test('epoch timing estimates expose progress without claiming exact chain time', () => {
  assert.equal(epochProgressPercent(108_000, 432_000), 25);
  assert.equal(estimateEpochBoundaryAt(431_000, 432_000, 1_000, 400), 401_000);
});

test('epoch timing estimates reject incomplete or invalid epoch data', () => {
  assert.equal(epochProgressPercent(undefined, 432_000), null);
  assert.equal(estimateEpochBoundaryAt(432_000, 432_000, 1_000), null);
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

test('swap and stake takeovers keep a bounded scroll viewport with a fixed action footer', () => {
  assert.match(popupCss, /\.container\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
  assert.match(popupCss, /\.content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(popupCss, /\.swap-stake-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(popupCss, /\.swap-stake-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test('stake position cards inherit the wallet font while technical detail values stay scoped', () => {
  assert.match(popupCss, /\.staking-redesign-position\s*\{[^}]*font:\s*inherit;/s);
  assert.match(popupCss, /\.staking-redesign-position__footer > span\s*\{[^}]*font-family:\s*inherit;/s);
  assert.match(popupCss, /\.stake-detail-mono\s*\{[^}]*font-family:\s*var\(--font-family-mono\);/s);
});

test('staking cards use readable type and high-contrast amber lifecycle states', () => {
  assert.match(popupCss, /\.staking-redesign-position__identity strong\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(popupCss, /\.staking-redesign-position__value strong\s*\{[^}]*font-size:\s*17px;/s);
  assert.match(popupCss, /\.staking-redesign-position__hint\s*\{[^}]*font-size:\s*11\.5px;/s);
  assert.match(popupCss, /\.theme-dark \.swap-stake-status--deactivating\s*\{[^}]*color:\s*var\(--warning-mid\);/s);
  assert.match(popupCss, /\.theme-dark \.staking-redesign-position__hint\s*\{[^}]*color:\s*var\(--warning-mid\);/s);
});
