/**
 * @fileoverview Tests for TON explorer transaction normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Address } from '@ton/core';
import { deriveTonAddress } from '../dist/ton/index.js';
import { normalizeTonTransaction, findTonTransaction } from '../dist/ton/explorer.js';

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

test('normalizeTonTransaction classifies external-in with outbound message as send', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const other = deriveTonAddress(TEST_MNEMONIC, 1).address;

  const tx = {
    now: 1700000150,
    transaction_id: { hash: 'ton-send-hash' },
    inMessage: {
      info: {
        type: 'external-in',
        dest: Address.parse(address)
      }
    },
    outMessages: {
      values: () => [
        {
          info: {
            type: 'internal',
            src: Address.parse(address),
            dest: Address.parse(other),
            value: { coins: 1000000000n }
          }
        }
      ]
    },
    description: {
      type: 'generic',
      aborted: true,
      computePhase: { type: 'vm', success: false },
      actionPhase: { success: false }
    }
  };

  const normalized = normalizeTonTransaction(tx, address, 'ton-mainnet', false);

  assert.equal(normalized.type, 'send');
  assert.equal(normalized.status, 'failed');
});

test('normalizeTonTransaction marks failed when a send aborts', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const other = deriveTonAddress(TEST_MNEMONIC, 1).address;

  const tx = {
    now: 1700000200,
    transaction_id: { hash: 'ton-failed-hash' },
    inMessage: {
      info: {
        type: 'internal',
        src: Address.parse(address),
        dest: Address.parse(other),
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

test('findTonTransaction matches by to address and amount', () => {
  const { address } = deriveTonAddress(TEST_MNEMONIC, 0);
  const other = deriveTonAddress(TEST_MNEMONIC, 1).address;

  const txs = [
    {
      hash: 'tx-1',
      from: other,
      to: address,
      valueNano: '1000000000',
      valueTon: '1',
      timestamp: 1700000000,
      status: 'confirmed',
      type: 'receive',
      network: 'ton-mainnet'
    },
    {
      hash: 'tx-2',
      from: address,
      to: other,
      valueNano: '250000000',
      valueTon: '0.25',
      timestamp: 1700000100,
      status: 'confirmed',
      type: 'send',
      network: 'ton-mainnet'
    }
  ];

  const match = findTonTransaction(txs, {
    toAddress: other,
    amountTon: '0.25',
    type: 'send'
  });

  assert.ok(match);
  assert.equal(match.hash, 'tx-2');
});
