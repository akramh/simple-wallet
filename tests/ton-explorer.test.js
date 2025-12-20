/**
 * @fileoverview Tests for TON explorer transaction normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Address } from '@ton/core';
import { deriveTonAddress } from '../dist/ton/index.js';
import { normalizeTonTransaction } from '../dist/ton/explorer.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('normalizeTonTransaction prefers transaction_id.hash and classifies receive', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const other = deriveTonAddress(TEST_MNEMONIC, 1).address;

  const tx = {
    now: 1700000000,
    transaction_id: { hash: 'ton-tx-hash' },
    hash: () => Buffer.from('deadbeef', 'hex'),
    in_msg: {
      source: other,
      destination: address,
      value: '1000000000'
    },
    out_msgs: []
  };

  const normalized = normalizeTonTransaction(tx, address, 'ton-mainnet', false);

  assert.equal(normalized.hash, 'ton-tx-hash');
  assert.equal(normalized.type, 'receive');
  assert.equal(normalized.valueTon, '1');
});

test('normalizeTonTransaction handles TonClient message info format', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const other = deriveTonAddress(TEST_MNEMONIC, 1).address;

  const tx = {
    now: 1700000100,
    transaction_id: { hash: 'ton-info-hash' },
    inMessage: {
      info: {
        type: 'internal',
        src: Address.parse(other),
        dest: Address.parse(address),
        value: { coins: 2000000000n }
      }
    },
    outMessages: { values: () => [] }
  };

  const normalized = normalizeTonTransaction(tx, address, 'ton-mainnet', false);

  assert.equal(normalized.hash, 'ton-info-hash');
  assert.equal(normalized.type, 'receive');
  assert.equal(normalized.valueTon, '2');
});

test('normalizeTonTransaction marks failed when aborted or compute fails', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);

  const tx = {
    now: 1700000200,
    transaction_id: { hash: 'ton-failed-hash' },
    inMessage: {
      info: {
        type: 'internal',
        src: Address.parse(address),
        dest: Address.parse(address),
        value: { coins: 0n }
      }
    },
    outMessages: { values: () => [] },
    description: {
      type: 'generic',
      aborted: true,
      computePhase: { type: 'vm', success: false },
      actionPhase: { success: false }
    }
  };

  const normalized = normalizeTonTransaction(tx, address, 'ton-mainnet', false);

  assert.equal(normalized.status, 'failed');
});
