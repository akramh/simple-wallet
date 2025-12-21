/**
 * @fileoverview Tests for TON module functionality.
 *
 * Covers address derivation, address validation, and unit conversions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveTonAddress,
  getTonDerivationPath,
  isValidTonAddress,
  normalizeTonAddress,
  formatTonAddress,
  parseTonAddress,
  buildTonTransferMessage,
  resolveTonTransactionHash,
  getTonWalletSeqno,
  tonToNano,
  nanoToTon,
  NANO_TON,
} from '../dist/ton/index.js';

// Well-known test mnemonic (BIP-39 test vector)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// ============================================================================
// Address Derivation Tests
// ============================================================================

test('deriveTonAddress derives address from mnemonic', () => {
  const result = deriveTonAddress(TEST_MNEMONIC, 0);

  assert.ok(result.address, 'should return an address');
  assert.ok(result.address.startsWith('UQ'), 'TON address should be non-bounceable by default');
  assert.ok(result.publicKeyHex, 'should return a public key');
  assert.ok(result.derivationPath.includes("44'/607'"), 'should use TON BIP-44 path');
});

test('deriveTonAddress produces different addresses for different account indices', () => {
  const addr0 = deriveTonAddress(TEST_MNEMONIC, 0);
  const addr1 = deriveTonAddress(TEST_MNEMONIC, 1);

  assert.notEqual(addr0.address, addr1.address, 'different accounts should have different addresses');
});

test('deriveTonAddress returns consistent address for same mnemonic', () => {
  const addr1 = deriveTonAddress(TEST_MNEMONIC, 0);
  const addr2 = deriveTonAddress(TEST_MNEMONIC, 0);

  assert.equal(addr1.address, addr2.address, 'same mnemonic should produce same address');
});

test('getTonDerivationPath returns correct path format', () => {
  assert.equal(getTonDerivationPath(0), "m/44'/607'/0'/0/0");
  assert.equal(getTonDerivationPath(1), "m/44'/607'/1'/0/0");
});

// ============================================================================
// Address Validation Tests
// ============================================================================

test('isValidTonAddress accepts derived address', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  assert.equal(isValidTonAddress(address), true);
});

test('isValidTonAddress rejects empty string', () => {
  assert.equal(isValidTonAddress(''), false);
});

test('normalizeTonAddress returns non-bounceable format', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const normalized = normalizeTonAddress(address);

  assert.ok(normalized.startsWith('UQ'), 'normalized TON address should be non-bounceable');
  assert.equal(isValidTonAddress(normalized), true);
});

// ============================================================================
// Extended Address Validation Tests
// ============================================================================

test('isValidTonAddress accepts bounceable addresses (EQ prefix)', () => {
  // Valid bounceable address (burn address)
  const bounceable = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  assert.equal(isValidTonAddress(bounceable), true, 'should accept valid bounceable address');
});

test('isValidTonAddress accepts non-bounceable addresses (UQ prefix)', () => {
  // Valid non-bounceable address (burn address)
  const nonBounceable = 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ';
  assert.equal(isValidTonAddress(nonBounceable), true, 'should accept valid non-bounceable address');
});

test('isValidTonAddress accepts raw format addresses', () => {
  // Raw address format: workchain:64-char-hex
  const rawAddress = '0:0000000000000000000000000000000000000000000000000000000000000000';
  assert.equal(isValidTonAddress(rawAddress), true, 'should accept raw format address');
});

test('isValidTonAddress rejects invalid addresses', () => {
  // Too short
  assert.equal(isValidTonAddress('UQBshort'), false, 'should reject too short address');
  // Invalid characters
  assert.equal(isValidTonAddress('UQ!@#$%^&*()'), false, 'should reject invalid characters');
  // Ethereum address format
  assert.equal(isValidTonAddress('0x1234567890abcdef1234567890abcdef12345678'), false, 'should reject Ethereum addresses');
  // Bitcoin address format
  assert.equal(isValidTonAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'), false, 'should reject Bitcoin addresses');
  // Invalid checksum (wrong last chars)
  assert.equal(isValidTonAddress('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9d'), false, 'should reject invalid checksum');
});

test('isValidTonAddress handles null and undefined', () => {
  assert.equal(isValidTonAddress(null), false, 'should reject null');
  assert.equal(isValidTonAddress(undefined), false, 'should reject undefined');
});

test('isValidTonAddress handles whitespace', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  // Address with leading/trailing whitespace - validator should handle this
  // Note: the SDK validator may or may not trim, so we test that it doesn't crash
  const result = isValidTonAddress(`  ${address}  `);
  assert.equal(typeof result, 'boolean', 'should return boolean for whitespace input');
});

test('normalizeTonAddress converts bounceable to non-bounceable', () => {
  // Bounceable burn address
  const bounceable = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  const normalized = normalizeTonAddress(bounceable);

  assert.ok(normalized.startsWith('UQ'), 'should convert to non-bounceable');
  assert.equal(isValidTonAddress(normalized), true);
});

test('normalizeTonAddress handles raw format addresses', () => {
  const rawAddress = '0:0000000000000000000000000000000000000000000000000000000000000000';
  const normalized = normalizeTonAddress(rawAddress);

  assert.ok(normalized.startsWith('UQ'), 'should normalize raw address to non-bounceable friendly format');
  assert.equal(isValidTonAddress(normalized), true);
});

test('parseTonAddress throws for invalid addresses', () => {
  // parseTonAddress throws for invalid input - error message may vary
  assert.throws(() => parseTonAddress('invalid'));
  assert.throws(() => parseTonAddress(''));
});

test('formatTonAddress produces correct format based on options', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const parsed = parseTonAddress(address);

  const bounceable = formatTonAddress(parsed, { bounceable: true });
  const nonBounceable = formatTonAddress(parsed, { bounceable: false });

  assert.ok(bounceable.startsWith('EQ'), 'bounceable should start with EQ');
  assert.ok(nonBounceable.startsWith('UQ'), 'non-bounceable should start with UQ');
  assert.equal(bounceable.length, 48, 'friendly addresses should be 48 chars');
  assert.equal(nonBounceable.length, 48, 'friendly addresses should be 48 chars');
});

// ============================================================================
// Unit Conversion Tests
// ============================================================================

test('tonToNano converts TON to nanoTON', () => {
  assert.equal(tonToNano('1').toString(), NANO_TON.toString());
  assert.equal(tonToNano('0.000000001').toString(), '1');
  assert.equal(tonToNano('10.5').toString(), (10n * NANO_TON + 500_000_000n).toString());
});

test('nanoToTon converts nanoTON to TON', () => {
  assert.equal(nanoToTon(1n), '0.000000001');
  assert.equal(nanoToTon(NANO_TON), '1');
  assert.equal(nanoToTon(10n * NANO_TON + 500_000_000n), '10.5');
});

test('tonToNano rejects invalid input', () => {
  assert.throws(() => tonToNano('1.0000000001'), /too many decimal/i);
  assert.throws(() => tonToNano('abc'), /Invalid TON amount/i);
});

test('buildTonTransferMessage uses bounce flag from friendly address', () => {
  const derived = deriveTonAddress(TEST_MNEMONIC, 0);
  const parsed = parseTonAddress(derived.address);
  const bounceable = formatTonAddress(parsed, { bounceable: true });

  const nonBounceMessage = buildTonTransferMessage({
    toAddress: derived.address,
    amountTon: '1',
  });
  const bounceMessage = buildTonTransferMessage({
    toAddress: bounceable,
    amountTon: '1',
  });

  assert.equal(nonBounceMessage.info.bounce, false);
  assert.equal(bounceMessage.info.bounce, true);
});

test('resolveTonTransactionHash decodes base64 tx hash', () => {
  const tx = { transaction_id: { hash: 'j7r/Hh+E2L/LyFdLLeOsUeEBx5UnSXuPOuA1ikAN59Y=' } };
  const hash = resolveTonTransactionHash(tx);
  assert.equal(hash, '8fbaff1e1f84d8bfcbc8574b2de3ac51e101c79527497b8f3ae0358a400de7d6');
});

test('getTonWalletSeqno falls back to 0 when seqno is unavailable', async () => {
  const seqno = await getTonWalletSeqno({
    getSeqno: async () => {
      throw new Error('Contract is not deployed');
    }
  });
  assert.equal(seqno, 0);
});
