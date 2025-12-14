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
