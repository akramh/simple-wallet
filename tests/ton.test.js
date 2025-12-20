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
