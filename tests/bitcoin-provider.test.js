/**
 * @fileoverview Tests for BitcoinProvider UTXO selection behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BitcoinProvider, deriveBitcoinAddress } from '../dist/bitcoin/index.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TESTNET_ADDRESS = deriveBitcoinAddress(TEST_MNEMONIC, 'testnet', 0, 0).address;
const MAINNET_ADDRESS = deriveBitcoinAddress(TEST_MNEMONIC, 'mainnet', 0, 0).address;

test('BitcoinProvider uses unconfirmed UTXOs for testnet fee estimates', async () => {
  const provider = new BitcoinProvider({ network: 'testnet', networkKey: 'bitcoin-testnet' });
  provider.getUTXOs = async () => [{
    txid: 'tx1',
    vout: 0,
    value: 100000,
    status: { confirmed: false },
  }];

  const estimate = await provider.estimateSendTransaction(
    TESTNET_ADDRESS,
    TESTNET_ADDRESS,
    '0.0005',
    5
  );

  assert.equal(estimate.fee.vbytes, 140);
  assert.equal(estimate.fee.feeSats, 700);
  assert.equal(estimate.fee.outputCount, 2);
});

test('BitcoinProvider requires confirmed UTXOs on mainnet', async () => {
  const provider = new BitcoinProvider({ network: 'mainnet', networkKey: 'bitcoin-mainnet' });
  provider.getUTXOs = async () => [{
    txid: 'tx2',
    vout: 0,
    value: 100000,
    status: { confirmed: false },
  }];

  await assert.rejects(
    () => provider.estimateSendTransaction(MAINNET_ADDRESS, MAINNET_ADDRESS, '0.0005', 5),
    /No spendable UTXOs available/
  );
});
