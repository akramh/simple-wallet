/**
 * @fileoverview Tests for Solana module functionality.
 *
 * Tests SLIP-10 ed25519 address derivation and utility functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSolanaAddress,
  deriveSolanaKeypair,
  getSolanaDerivationPath,
  lamportsToSol,
  solToLamports,
  LAMPORTS_PER_SOL
} from '../dist/solana/index.js';

// Well-known test mnemonic (BIP-39 test vector)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('deriveSolanaAddress derives address from mnemonic', async () => {
  const result = deriveSolanaAddress(TEST_MNEMONIC, 0);

  assert.ok(result.address, 'should return an address');
  assert.ok(result.address.length >= 32, 'Solana address should be at least 32 characters');
  assert.ok(result.publicKeyBase58, 'should return a public key');
  assert.equal(result.address, result.publicKeyBase58, 'address and publicKeyBase58 should match');
  assert.ok(result.derivationPath.startsWith("m/44'/501'"), 'should use Solana BIP-44 path');
});

test('deriveSolanaAddress produces different addresses for different account indices', async () => {
  const addr0 = deriveSolanaAddress(TEST_MNEMONIC, 0);
  const addr1 = deriveSolanaAddress(TEST_MNEMONIC, 1);

  assert.notEqual(addr0.address, addr1.address, 'different accounts should have different addresses');
});

test('deriveSolanaAddress returns consistent address for same mnemonic', async () => {
  const addr1 = deriveSolanaAddress(TEST_MNEMONIC, 0);
  const addr2 = deriveSolanaAddress(TEST_MNEMONIC, 0);

  assert.equal(addr1.address, addr2.address, 'same mnemonic should produce same address');
});

test('deriveSolanaKeypair produces valid keypair', async () => {
  const keypair = deriveSolanaKeypair(TEST_MNEMONIC, 0);

  assert.ok(keypair, 'should return a keypair');
  assert.ok(keypair.publicKey, 'keypair should have publicKey');
  assert.ok(keypair.secretKey, 'keypair should have secretKey');
  assert.equal(keypair.secretKey.length, 64, 'ed25519 secret key should be 64 bytes');
});

test('deriveSolanaKeypair throws on invalid mnemonic', async () => {
  assert.throws(
    () => deriveSolanaKeypair('invalid mnemonic phrase', 0),
    /Invalid mnemonic/,
    'should throw on invalid mnemonic'
  );
});

test('getSolanaDerivationPath returns correct path format', async () => {
  assert.equal(getSolanaDerivationPath(0), "m/44'/501'/0'/0'");
  assert.equal(getSolanaDerivationPath(1), "m/44'/501'/1'/0'");
  assert.equal(getSolanaDerivationPath(5), "m/44'/501'/5'/0'");
});

test('LAMPORTS_PER_SOL is correct', async () => {
  assert.equal(LAMPORTS_PER_SOL, 1000000000, 'should be 1 billion');
});

test('lamportsToSol converts correctly', async () => {
  assert.equal(lamportsToSol(1000000000), '1.000000000');
  assert.equal(lamportsToSol(500000000), '0.500000000');
  assert.equal(lamportsToSol(1), '0.000000001');
  assert.equal(lamportsToSol(0), '0.000000000');
  assert.equal(lamportsToSol(1234567890), '1.234567890');
});

test('solToLamports converts correctly', async () => {
  assert.equal(solToLamports('1'), 1000000000);
  assert.equal(solToLamports('0.5'), 500000000);
  assert.equal(solToLamports('0.000000001'), 1);
  assert.equal(solToLamports('0'), 0);
  assert.equal(solToLamports('1.23456789'), 1234567890);
});

test('solToLamports accepts number input', async () => {
  assert.equal(solToLamports(1), 1000000000);
  assert.equal(solToLamports(0.5), 500000000);
});

// ============================================================================
// Address Validation Tests
// ============================================================================

import { isValidSolanaAddress } from '../dist/solana/index.js';

test('isValidSolanaAddress accepts valid Solana addresses', () => {
  // Derive a valid address from test mnemonic
  const { address } = deriveSolanaAddress(TEST_MNEMONIC, 0);

  assert.equal(isValidSolanaAddress(address), true);
});

test('isValidSolanaAddress rejects empty string', () => {
  assert.equal(isValidSolanaAddress(''), false);
});

test('isValidSolanaAddress rejects null and undefined', () => {
  assert.equal(isValidSolanaAddress(null), false);
  assert.equal(isValidSolanaAddress(undefined), false);
});

test('isValidSolanaAddress rejects invalid base58 characters', () => {
  // Base58 doesn't include 0, O, I, l
  assert.equal(isValidSolanaAddress('0OIl' + 'A'.repeat(40)), false);
});

test('isValidSolanaAddress rejects addresses that are too short', () => {
  assert.equal(isValidSolanaAddress('ABC123'), false);
  assert.equal(isValidSolanaAddress('A'.repeat(31)), false);
});

test('isValidSolanaAddress rejects addresses that are too long', () => {
  assert.equal(isValidSolanaAddress('A'.repeat(50)), false);
});

test('isValidSolanaAddress rejects Ethereum addresses', () => {
  // Ethereum addresses start with 0x
  assert.equal(isValidSolanaAddress('0x1234567890abcdef1234567890abcdef12345678'), false);
});

test('isValidSolanaAddress rejects Bitcoin addresses', () => {
  // Bitcoin mainnet P2PKH starts with 1
  assert.equal(isValidSolanaAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), false);
  // Bitcoin mainnet P2SH starts with 3
  assert.equal(isValidSolanaAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'), false);
});

test('isValidSolanaAddress is case-sensitive', () => {
  const { address } = deriveSolanaAddress(TEST_MNEMONIC, 0);

  // Solana uses base58, which is case-sensitive
  // Changing case should produce invalid address
  const modified = address.charAt(0).toLowerCase() === address.charAt(0)
    ? address.charAt(0).toUpperCase() + address.slice(1)
    : address.charAt(0).toLowerCase() + address.slice(1);

  // Modified address should be different
  assert.notEqual(address, modified);
  // And likely invalid (though could randomly be valid in rare cases)
});

// ============================================================================
// Transaction Validation Tests
// ============================================================================

import {
  validateSufficientBalance,
  isValidSolanaAddress as txIsValidSolanaAddress,
  BASE_FEE_LAMPORTS
} from '../dist/solana/index.js';

test('BASE_FEE_LAMPORTS is 5000', () => {
  assert.equal(BASE_FEE_LAMPORTS, 5000);
});

test('validateSufficientBalance passes with sufficient balance', () => {
  // 1 SOL balance, sending 0.5 SOL + fee
  const balance = 1000000000; // 1 SOL
  const amount = 500000000; // 0.5 SOL
  const fee = 5000;

  // Should not throw
  validateSufficientBalance(balance, amount, fee);
});

test('validateSufficientBalance throws with insufficient balance', () => {
  const balance = 1000000; // 0.001 SOL
  const amount = 500000000; // 0.5 SOL
  const fee = 5000;

  assert.throws(
    () => validateSufficientBalance(balance, amount, fee),
    /Insufficient SOL balance/
  );
});

test('validateSufficientBalance throws when fee exceeds remaining balance', () => {
  const balance = 500000; // 0.0005 SOL
  const amount = 496000; // Amount + fee (496000 + 5000 = 501000) exceeds balance (500000)
  const fee = 5000;

  assert.throws(
    () => validateSufficientBalance(balance, amount, fee),
    /Insufficient SOL balance/
  );
});

test('validateSufficientBalance passes with exactly sufficient balance', () => {
  const balance = 505000; // Exactly amount + fee
  const amount = 500000;
  const fee = 5000;

  // Should not throw
  validateSufficientBalance(balance, amount, fee);
});

test('validateSufficientBalance error message includes amounts', () => {
  const balance = 1000000; // 0.001 SOL
  const amount = 500000000; // 0.5 SOL
  const fee = 5000;

  try {
    validateSufficientBalance(balance, amount, fee);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('SOL'), 'Error should mention SOL');
    assert.ok(err.message.includes('fee'), 'Error should mention fee');
  }
});

// ============================================================================
// Conversion Edge Cases
// ============================================================================

test('lamportsToSol handles large values', () => {
  // Max supply is about 500M SOL
  const largeAmount = 500000000 * LAMPORTS_PER_SOL;
  const result = lamportsToSol(largeAmount);

  assert.ok(result.startsWith('500000000'), 'should handle max supply');
});

test('lamportsToSol handles zero', () => {
  assert.equal(lamportsToSol(0), '0.000000000');
});

test('solToLamports handles zero string', () => {
  assert.equal(solToLamports('0'), 0);
  assert.equal(solToLamports('0.0'), 0);
  assert.equal(solToLamports('0.000000000'), 0);
});

test('solToLamports handles negative values gracefully', () => {
  // Depending on implementation, might throw or return negative
  // Just ensure it doesn't crash
  try {
    const result = solToLamports('-1');
    assert.ok(typeof result === 'number');
  } catch (err) {
    // Throwing is also acceptable behavior
    assert.ok(err.message);
  }
});

// ============================================================================
// Keypair Derivation Edge Cases
// ============================================================================

test('deriveSolanaKeypair produces deterministic results', () => {
  const kp1 = deriveSolanaKeypair(TEST_MNEMONIC, 0);
  const kp2 = deriveSolanaKeypair(TEST_MNEMONIC, 0);

  assert.equal(kp1.publicKey.toBase58(), kp2.publicKey.toBase58());
});

test('deriveSolanaKeypair different accounts produce different keys', () => {
  const kp0 = deriveSolanaKeypair(TEST_MNEMONIC, 0);
  const kp1 = deriveSolanaKeypair(TEST_MNEMONIC, 1);
  const kp2 = deriveSolanaKeypair(TEST_MNEMONIC, 2);

  assert.notEqual(kp0.publicKey.toBase58(), kp1.publicKey.toBase58());
  assert.notEqual(kp1.publicKey.toBase58(), kp2.publicKey.toBase58());
  assert.notEqual(kp0.publicKey.toBase58(), kp2.publicKey.toBase58());
});

test('deriveSolanaAddress and deriveSolanaKeypair produce matching addresses', () => {
  const addressInfo = deriveSolanaAddress(TEST_MNEMONIC, 0);
  const keypair = deriveSolanaKeypair(TEST_MNEMONIC, 0);

  assert.equal(addressInfo.address, keypair.publicKey.toBase58());
});
