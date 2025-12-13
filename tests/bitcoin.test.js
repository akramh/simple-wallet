/**
 * @fileoverview Tests for Bitcoin module functionality.
 *
 * Tests BIP-84 address derivation, address validation, and utility functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveBitcoinAddress,
  deriveBitcoinAddresses,
  isValidBitcoinAddress,
  getNetworkFromAddress,
  satoshisToBtc,
  btcToSatoshis,
  formatBtcAmount,
  SATOSHIS_PER_BTC
} from '../dist/bitcoin/index.js';

// Well-known test mnemonic (BIP-39 test vector)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('deriveBitcoinAddress derives mainnet Native SegWit address from mnemonic', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0);

  assert.ok(result.address, 'should return an address');
  assert.ok(result.address.startsWith('bc1q'), 'mainnet address should start with bc1q');
  assert.ok(result.publicKey, 'should return a public key');
  assert.equal(result.network, 'mainnet');
  assert.ok(result.derivationPath.startsWith("m/84'/0'"), 'should use BIP-84 path for mainnet');
});

test('deriveBitcoinAddress derives testnet Native SegWit address from mnemonic', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'testnet', 0, 0);

  assert.ok(result.address, 'should return an address');
  assert.ok(result.address.startsWith('tb1q'), 'testnet address should start with tb1q');
  assert.ok(result.publicKey, 'should return a public key');
  assert.equal(result.network, 'testnet');
  assert.ok(result.derivationPath.startsWith("m/84'/1'"), 'should use BIP-84 path for testnet');
});

test('deriveBitcoinAddress produces different addresses for different account indices', async () => {
  const addr0 = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0);
  const addr1 = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 1, 0);

  assert.notEqual(addr0.address, addr1.address, 'different accounts should have different addresses');
});

test('deriveBitcoinAddress produces different addresses for different address indices', async () => {
  const addr0 = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0);
  const addr1 = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 1);

  assert.notEqual(addr0.address, addr1.address, 'different address indices should have different addresses');
});

test('deriveBitcoinAddress throws on invalid mnemonic', async () => {
  assert.throws(
    () => deriveBitcoinAddress('invalid mnemonic phrase', 'mainnet'),
    /Invalid mnemonic/,
    'should throw on invalid mnemonic'
  );
});

test('deriveBitcoinAddresses derives multiple addresses', async () => {
  const addresses = deriveBitcoinAddresses(TEST_MNEMONIC, 'mainnet', 0, 0, 5);

  assert.equal(addresses.length, 5, 'should return 5 addresses');

  // All addresses should be unique
  const uniqueAddresses = new Set(addresses.map(a => a.address));
  assert.equal(uniqueAddresses.size, 5, 'all addresses should be unique');

  // All should be mainnet
  addresses.forEach(addr => {
    assert.ok(addr.address.startsWith('bc1q'), 'all should be mainnet addresses');
  });
});

test('isValidBitcoinAddress validates mainnet addresses', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0);

  assert.ok(isValidBitcoinAddress(result.address), 'should validate derived mainnet address');
  assert.ok(isValidBitcoinAddress(result.address, 'mainnet'), 'should validate with network specified');
  assert.equal(isValidBitcoinAddress(result.address, 'testnet'), false, 'should reject when wrong network specified');
});

test('isValidBitcoinAddress validates testnet addresses', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'testnet', 0, 0);

  assert.ok(isValidBitcoinAddress(result.address), 'should validate derived testnet address');
  assert.ok(isValidBitcoinAddress(result.address, 'testnet'), 'should validate with network specified');
  assert.equal(isValidBitcoinAddress(result.address, 'mainnet'), false, 'should reject when wrong network specified');
});

test('isValidBitcoinAddress rejects invalid addresses', async () => {
  assert.equal(isValidBitcoinAddress('invalid'), false);
  assert.equal(isValidBitcoinAddress('0x1234567890123456789012345678901234567890'), false);
  assert.equal(isValidBitcoinAddress('bc1invalid'), false);
  assert.equal(isValidBitcoinAddress(''), false);
});

test('getNetworkFromAddress detects mainnet addresses', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0);
  assert.equal(getNetworkFromAddress(result.address), 'mainnet');
});

test('getNetworkFromAddress detects testnet addresses', async () => {
  const result = deriveBitcoinAddress(TEST_MNEMONIC, 'testnet', 0, 0);
  assert.equal(getNetworkFromAddress(result.address), 'testnet');
});

test('getNetworkFromAddress returns null for invalid addresses', async () => {
  assert.equal(getNetworkFromAddress('invalid'), null);
  assert.equal(getNetworkFromAddress('0x1234567890123456789012345678901234567890'), null);
});

test('SATOSHIS_PER_BTC is correct', async () => {
  assert.equal(SATOSHIS_PER_BTC, 100000000, 'should be 100 million');
});

test('satoshisToBtc converts correctly', async () => {
  assert.equal(satoshisToBtc(100000000), '1.00000000');
  assert.equal(satoshisToBtc(50000000), '0.50000000');
  assert.equal(satoshisToBtc(1), '0.00000001');
  assert.equal(satoshisToBtc(0), '0.00000000');
  assert.equal(satoshisToBtc(123456789), '1.23456789');
});

test('btcToSatoshis converts correctly', async () => {
  assert.equal(btcToSatoshis('1'), 100000000);
  assert.equal(btcToSatoshis('0.5'), 50000000);
  assert.equal(btcToSatoshis('0.00000001'), 1);
  assert.equal(btcToSatoshis('0'), 0);
  assert.equal(btcToSatoshis('1.23456789'), 123456789);
});

test('formatBtcAmount formats with appropriate precision', async () => {
  // formatBtcAmount takes satoshis as input
  assert.equal(formatBtcAmount(100000000), '1.00 BTC');
  assert.equal(formatBtcAmount(150000000), '1.50 BTC');
  assert.equal(formatBtcAmount(1000), '0.00001 BTC');
  assert.equal(formatBtcAmount(1), '0.00000001 BTC');
  assert.equal(formatBtcAmount(0), '0.00 BTC');
});
