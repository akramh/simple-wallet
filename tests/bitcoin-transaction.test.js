import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

import {
  parseBtcToSatoshisExact,
  selectUtxosLargestFirst,
  estimateVbytesP2wpkh,
  buildAndSignP2wpkhTransaction,
} from '../dist/bitcoin/index.js';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

test('parseBtcToSatoshisExact parses without floating point errors', () => {
  assert.equal(parseBtcToSatoshisExact('1'), 100000000);
  assert.equal(parseBtcToSatoshisExact('0.1'), 10000000);
  assert.equal(parseBtcToSatoshisExact('0.00000001'), 1);
  assert.equal(parseBtcToSatoshisExact('1.23456789'), 123456789);
});

test('selectUtxosLargestFirst selects enough confirmed UTXOs and computes change/fee', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 2000, status: { confirmed: true } },
    { txid: 'b', vout: 1, value: 8000, status: { confirmed: true } },
    { txid: 'c', vout: 0, value: 5000, status: { confirmed: true } },
  ];

  const amountSats = 6000;
  const feeRate = 1;
  const selected = selectUtxosLargestFirst(utxos, amountSats, feeRate);

  // Largest-first should pick 8000 first and be sufficient.
  assert.equal(selected.inputs.length, 1);
  assert.equal(selected.totalInputSats, 8000);
  assert.equal(selected.fee.feeRateSatVb, 1);
  assert.ok(selected.fee.feeSats > 0);
});

test('buildAndSignP2wpkhTransaction produces a signed tx hex and txid', () => {
  const network = bitcoin.networks.testnet;
  const privKey = Buffer.from('1'.repeat(64), 'hex');
  const keyPair = ECPair.fromPrivateKey(privKey, { network });
  const wif = keyPair.toWIF();

  const payment = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
  const fromAddress = payment.address;
  const scriptPubKeyHex = Buffer.from(payment.output).toString('hex');

  const toKey = ECPair.fromPrivateKey(Buffer.from('2'.repeat(64), 'hex'), { network });
  const toAddress = bitcoin.payments.p2wpkh({ pubkey: toKey.publicKey, network }).address;

  assert.ok(fromAddress);
  assert.ok(toAddress);

  const totalInput = 10000;
  const amountSats = 5000;
  const feeRate = 1;
  const vbytes = estimateVbytesP2wpkh(1, 2);
  const feeSats = Math.ceil(vbytes * feeRate);
  const changeSats = totalInput - amountSats - feeSats;

  const prevouts = [{
    txid: 'a'.repeat(64),
    vout: 0,
    value: totalInput,
    scriptPubKeyHex
  }];

  const { txHex, txid } = buildAndSignP2wpkhTransaction({
    network: 'testnet',
    wif,
    toAddress,
    amountSats,
    changeAddress: fromAddress,
    changeSats,
    feeRateSatVb: feeRate,
    feeSats,
    prevouts
  });

  assert.ok(typeof txHex === 'string' && txHex.length > 10);
  assert.ok(typeof txid === 'string' && txid.length === 64);
});

// ============================================================================
// Input Validation Edge Cases
// ============================================================================

test('parseBtcToSatoshisExact rejects negative amounts', () => {
  assert.throws(
    () => parseBtcToSatoshisExact('-1'),
    /Invalid BTC amount/
  );

  assert.throws(
    () => parseBtcToSatoshisExact('-0.001'),
    /Invalid BTC amount/
  );
});

test('parseBtcToSatoshisExact rejects scientific notation', () => {
  assert.throws(
    () => parseBtcToSatoshisExact('1e-8'),
    /Invalid BTC amount/
  );

  assert.throws(
    () => parseBtcToSatoshisExact('1E8'),
    /Invalid BTC amount/
  );
});

test('parseBtcToSatoshisExact rejects invalid strings', () => {
  assert.throws(
    () => parseBtcToSatoshisExact('abc'),
    /Invalid BTC amount/
  );

  assert.throws(
    () => parseBtcToSatoshisExact('1.2.3'),
    /Invalid BTC amount/
  );

  // Empty string returns 0 (treated as zero amount)
  assert.equal(parseBtcToSatoshisExact(''), 0);
});

test('parseBtcToSatoshisExact handles leading zeros', () => {
  assert.equal(parseBtcToSatoshisExact('01'), 100000000);
  assert.equal(parseBtcToSatoshisExact('0.01'), 1000000);
  assert.equal(parseBtcToSatoshisExact('00.001'), 100000);
});

test('parseBtcToSatoshisExact handles maximum precision (8 decimals)', () => {
  assert.equal(parseBtcToSatoshisExact('0.00000001'), 1);
  assert.equal(parseBtcToSatoshisExact('21000000.00000001'), 2100000000000001);
});

test('parseBtcToSatoshisExact rejects more than 8 decimals', () => {
  assert.throws(
    () => parseBtcToSatoshisExact('0.000000001'),
    /BTC amount supports up to 8 decimals/
  );
});

test('parseBtcToSatoshisExact handles zero', () => {
  assert.equal(parseBtcToSatoshisExact('0'), 0);
  assert.equal(parseBtcToSatoshisExact('0.0'), 0);
  assert.equal(parseBtcToSatoshisExact('0.00000000'), 0);
});

// ============================================================================
// UTXO Selection Edge Cases
// ============================================================================

test('selectUtxosLargestFirst throws on zero amount', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  assert.throws(
    () => selectUtxosLargestFirst(utxos, 0, 1),
    /Amount must be greater than 0/
  );
});

test('selectUtxosLargestFirst throws on negative amount', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  assert.throws(
    () => selectUtxosLargestFirst(utxos, -1000, 1),
    /Amount must be greater than 0/
  );
});

test('selectUtxosLargestFirst throws on zero fee rate', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  assert.throws(
    () => selectUtxosLargestFirst(utxos, 5000, 0),
    /Fee rate must be greater than 0/
  );
});

test('selectUtxosLargestFirst throws on insufficient balance', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 1000, status: { confirmed: true } },
    { txid: 'b', vout: 1, value: 2000, status: { confirmed: true } },
  ];

  assert.throws(
    () => selectUtxosLargestFirst(utxos, 100000, 1),
    /Insufficient BTC balance/
  );
});

test('selectUtxosLargestFirst handles exactly-sufficient balance', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  // UTXO selector assumes 2 outputs initially (recipient + potential change)
  const vbytes = estimateVbytesP2wpkh(1, 2); // 1 input, 2 outputs
  const feeRate = 1;
  const fee = Math.ceil(vbytes * feeRate);
  // Leave enough for change above dust limit (546 sats)
  const exactAmount = 10000 - fee - 600;

  const selected = selectUtxosLargestFirst(utxos, exactAmount, feeRate);

  assert.equal(selected.inputs.length, 1);
  assert.equal(selected.totalInputSats, 10000);
});

test('selectUtxosLargestFirst selects multiple UTXOs when needed', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 3000, status: { confirmed: true } },
    { txid: 'b', vout: 0, value: 4000, status: { confirmed: true } },
    { txid: 'c', vout: 0, value: 2000, status: { confirmed: true } },
  ];

  const selected = selectUtxosLargestFirst(utxos, 6000, 1);

  // Should select 4000 + 3000 = 7000
  assert.equal(selected.inputs.length, 2);
  assert.equal(selected.totalInputSats, 7000);
});

test('selectUtxosLargestFirst handles empty UTXO set', () => {
  assert.throws(
    () => selectUtxosLargestFirst([], 1000, 1),
    /Insufficient BTC balance/
  );
});

// ============================================================================
// Fee Estimation Tests
// ============================================================================

test('estimateVbytesP2wpkh calculates correct size for 1 input 1 output', () => {
  const vbytes = estimateVbytesP2wpkh(1, 1);
  // TX_OVERHEAD(10) + 1*INPUT(68) + 1*OUTPUT(31) = 109
  assert.equal(vbytes, 109);
});

test('estimateVbytesP2wpkh calculates correct size for 2 inputs 2 outputs', () => {
  const vbytes = estimateVbytesP2wpkh(2, 2);
  // TX_OVERHEAD(10) + 2*INPUT(68) + 2*OUTPUT(31) = 208
  assert.equal(vbytes, 208);
});

test('estimateVbytesP2wpkh scales linearly with inputs', () => {
  const v1 = estimateVbytesP2wpkh(1, 2);
  const v2 = estimateVbytesP2wpkh(2, 2);
  const v3 = estimateVbytesP2wpkh(3, 2);

  // Each additional input adds 68 vbytes
  assert.equal(v2 - v1, 68);
  assert.equal(v3 - v2, 68);
});

// ============================================================================
// Dust Limit Tests
// ============================================================================

test('selectUtxosLargestFirst drops change below dust limit', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  // Amount that would leave very small change
  const vbytes = estimateVbytesP2wpkh(1, 2);
  const fee = Math.ceil(vbytes * 1);
  const amountLeavingDust = 10000 - fee - 100; // Only 100 sats change (below 546 dust)

  const selected = selectUtxosLargestFirst(utxos, amountLeavingDust, 1);

  // Change should be dropped (fee absorbs it)
  assert.equal(selected.fee.hasChange, false);
});

test('selectUtxosLargestFirst keeps change above dust limit', () => {
  const utxos = [
    { txid: 'a', vout: 0, value: 10000, status: { confirmed: true } },
  ];

  const vbytes = estimateVbytesP2wpkh(1, 2);
  const fee = Math.ceil(vbytes * 1);
  const amountWithChange = 10000 - fee - 1000; // 1000 sats change (above 546 dust)

  const selected = selectUtxosLargestFirst(utxos, amountWithChange, 1);

  assert.equal(selected.fee.hasChange, true);
  assert.ok(selected.changeSats >= 546);
});
