/**
 * @fileoverview Tests for shared wallet-name validation.
 *
 * Verifies the Chrome extension wallet-name policy accepts longer names and
 * hyphens while keeping storage-key names bounded and simple.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getWalletNameValidationMessage,
  isValidWalletName,
  MAX_WALLET_NAME_LENGTH,
  WALLET_NAME_REQUIREMENTS
} from '../dist/wallet-name.js';

test('wallet-name validation accepts names with 20 or more characters', () => {
  assert.equal(isValidWalletName('abcdefghijklmnopqrst'), true);
  assert.equal(isValidWalletName('a'.repeat(MAX_WALLET_NAME_LENGTH)), true);
});

test('wallet-name validation accepts hyphenated names', () => {
  assert.equal(isValidWalletName('primary-wallet-2026'), true);
  assert.equal(isValidWalletName('wallet-name-with-32-characters'), true);
});

test('wallet-name validation rejects unsupported storage-key characters', () => {
  assert.equal(isValidWalletName(''), false);
  assert.equal(isValidWalletName('wallet name'), false);
  assert.equal(isValidWalletName('wallet_name'), false);
  assert.equal(isValidWalletName('wallet/name'), false);
  assert.equal(isValidWalletName('wallet.name'), false);
  assert.equal(isValidWalletName('wallet@name'), false);
});

test('wallet-name validation rejects over-limit and non-string values', () => {
  assert.equal(isValidWalletName('a'.repeat(MAX_WALLET_NAME_LENGTH + 1)), false);
  assert.equal(isValidWalletName(null), false);
  assert.equal(isValidWalletName(undefined), false);
  assert.equal(isValidWalletName(123), false);
});

test('wallet-name validation keeps generated wallet names valid', () => {
  assert.equal(isValidWalletName('wallet1'), true);
  assert.equal(WALLET_NAME_REQUIREMENTS, '1-32 letters, numbers, or hyphens');
  assert.match(getWalletNameValidationMessage(), /1-32 letters, numbers, or hyphens/);
});
