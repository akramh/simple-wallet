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
  summarizeStakePositions,
  validateStakeAmount,
  validateSwapAmount,
} from '../extension/popup/utils/swapStake.js';

const popupCss = readFileSync(new URL('../extension/popup/popup.css', import.meta.url), 'utf8');
const swapViewSource = readFileSync(new URL('../extension/popup/components/SwapFlowView.tsx', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../extension/background/service-worker.ts', import.meta.url), 'utf8');
const mobileBridgeSource = readFileSync(new URL('../mobile-wallet/services/WalletBridge.ts', import.meta.url), 'utf8');

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
  assert.match(popupCss, /\.swap-stake-scroll > \*\s*\{[^}]*flex-shrink:\s*0;/s);
  assert.match(popupCss, /\.swap-stake-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test('swap provider keys are registered on extension and mobile startup', () => {
  assert.match(serviceWorkerSource, /setOneInchApiKey\(import\.meta\.env\.VITE_ONEINCH_API_KEY\)/);
  assert.match(serviceWorkerSource, /setJupiterApiKey\(import\.meta\.env\.VITE_JUPITER_API_KEY\)/);
  assert.match(mobileBridgeSource, /setOneInchApiKey\(oneInchApiKey\)/);
  assert.match(mobileBridgeSource, /setJupiterApiKey\(jupiterApiKey\)/);
});

test('partial swap availability still explains unavailable same-chain routes', () => {
  assert.match(swapViewSource, /capabilities\?\.unsupportedReason/);
  assert.match(swapViewSource, /Some routes unavailable/);
});

test('stake position cards inherit the wallet font while technical detail values stay scoped', () => {
  assert.match(popupCss, /\.staking-redesign-position\s*\{[^}]*font:\s*inherit;/s);
  assert.match(popupCss, /\.staking-redesign-position__footer > span\s*\{[^}]*font-family:\s*inherit;/s);
  assert.match(popupCss, /\.stake-detail-mono\s*\{[^}]*font-family:\s*var\(--font-family-mono\);/s);
});

test('staking cards use readable type and high-contrast amber lifecycle states', () => {
  assert.match(popupCss, /\.staking-redesign-position__identity strong\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(popupCss, /\.staking-redesign-position__value strong\s*\{[^}]*font-size:\s*17px;/s);
  assert.match(popupCss, /\.theme-dark \.swap-stake-status--deactivating\s*\{[^}]*color:\s*var\(--warning-mid\);/s);
  assert.doesNotMatch(popupCss, /\.staking-redesign-position__hint/);
});

test('staking summary excludes deactivating and withdrawable balances from total staked', () => {
  const summary = summarizeStakePositions([
    { state: 'active', amountFormatted: '10', totalFormatted: '10.1', usdValue: 1010, lastRewardFormatted: '0.1', validator: { apyPercent: 5 } },
    { state: 'deactivating', amountFormatted: '2', totalFormatted: '2.1', usdValue: 210, lastRewardFormatted: '0.2', validator: { apyPercent: 9 } },
    { state: 'withdrawable', amountFormatted: '3', totalFormatted: '3.1', usdValue: 310, lastRewardFormatted: '0.3', validator: { apyPercent: 12 } },
  ], 100);

  assert.equal(summary.total, 10);
  assert.equal(summary.usd, 1000);
  assert.equal(summary.apy, 5);
  assert.equal(summary.rewards, 0.1);
  assert.equal(summary.deactivatingTotal, 2);
  assert.equal(summary.withdrawableTotal, 3);
});

test('staking summary includes activating stake but never invents unavailable USD value', () => {
  const summary = summarizeStakePositions([
    { state: 'activating', amountFormatted: '4', validator: { apyPercent: 6 } },
  ], null);

  assert.equal(summary.total, 4);
  assert.equal(summary.apy, 6);
  assert.equal(summary.usd, null);
  assert.equal(summary.deactivatingTotal, 0);
  assert.equal(summary.withdrawableTotal, 0);
});
