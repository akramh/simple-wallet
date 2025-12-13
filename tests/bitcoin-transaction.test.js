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
