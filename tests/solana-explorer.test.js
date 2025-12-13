/**
 * @fileoverview Tests for SolanaExplorer RPC-based transaction history.
 *
 * The SolanaExplorer uses Solana RPC (getSignaturesForAddress + getParsedTransaction)
 * for fetching transaction history. Solscan is only used as an external block explorer
 * for viewing transactions in the browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SolanaExplorer } from '../dist/solana/explorer.js';

test('SolanaExplorer fetches transaction history via RPC', async () => {
  const address = '11111111111111111111111111111111';
  const counterparty = '4Nd1mK4uQmZ3bP3Wb2Z8vM7WfKq9v5o3GQ2o2bVvYz9x';

  const signatures = [
    { signature: 'sig_rpc', slot: 123, blockTime: 1700000000, err: null }
  ];

  const parsedTx = {
    transaction: {
      message: {
        accountKeys: [{ pubkey: address }, { pubkey: counterparty }],
        instructions: [
          { program: 'system', parsed: { type: 'transfer', info: { source: address, destination: counterparty, lamports: 1_000_000_000 } } }
        ]
      }
    },
    meta: {
      fee: 5_000,
      preBalances: [2_000_000_000, 0],
      postBalances: [999_995_000, 1_000_000_000],
      err: null
    }
  };

  const explorer = new SolanaExplorer({
    networkKey: 'solana-mainnet',
    rpcUrls: ['mock://rpc'],
    connectionFactory: () => ({
      getSignaturesForAddress: async () => signatures,
      getParsedTransaction: async () => parsedTx
    })
  });

  const history = await explorer.getTransactionHistory(address, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].signature, 'sig_rpc');
  assert.equal(history[0].type, 'send');
  assert.equal(history[0].to, counterparty);
  // Value should be delta minus fee (sender pays fee)
  assert.equal(history[0].valueLamports, 999_995_000);
});

test('SolanaExplorer RPC handles empty response from first endpoint and tries next', async () => {
  const address = '11111111111111111111111111111111';

  const signatures = [{ signature: 'sig1', slot: 123, blockTime: 1700000000, err: null }];

  let callCount = 0;
  const explorer = new SolanaExplorer({
    networkKey: 'solana-mainnet',
    rpcUrls: ['mock://empty', 'mock://ok'],
    connectionFactory: (url) => ({
      getSignaturesForAddress: async () => {
        callCount++;
        return url.includes('empty') ? [] : signatures;
      },
      getParsedTransaction: async () => null
    })
  });

  const history = await explorer.getTransactionHistory(address, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].signature, 'sig1');
  assert.equal(callCount, 2, 'Should have tried both endpoints');
});

test('SolanaExplorer handles empty transaction history', async () => {
  const address = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5';

  const explorer = new SolanaExplorer({
    networkKey: 'solana-mainnet',
    rpcUrls: ['mock://rpc'],
    connectionFactory: () => ({
      getSignaturesForAddress: async () => [],
      getParsedTransaction: async () => null
    })
  });

  const history = await explorer.getTransactionHistory(address, 10);
  assert.equal(history.length, 0);
});

test('SolanaExplorer handles receive transactions', async () => {
  const address = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5';
  const sender = '4Nd1mK4uQmZ3bP3Wb2Z8vM7WfKq9v5o3GQ2o2bVvYz9x';

  const signatures = [
    { signature: 'sig_receive', slot: 200, blockTime: 1700000100, err: null }
  ];

  const parsedTx = {
    transaction: {
      message: {
        accountKeys: [{ pubkey: sender }, { pubkey: address }],
        instructions: [
          { program: 'system', parsed: { type: 'transfer', info: { source: sender, destination: address, lamports: 500_000_000 } } }
        ]
      }
    },
    meta: {
      fee: 5_000,
      preBalances: [1_000_000_000, 100_000_000],
      postBalances: [499_995_000, 600_000_000],
      err: null
    }
  };

  const explorer = new SolanaExplorer({
    networkKey: 'solana-mainnet',
    rpcUrls: ['mock://rpc'],
    connectionFactory: () => ({
      getSignaturesForAddress: async () => signatures,
      getParsedTransaction: async () => parsedTx
    })
  });

  const history = await explorer.getTransactionHistory(address, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].signature, 'sig_receive');
  assert.equal(history[0].type, 'receive');
  assert.equal(history[0].from, sender);
  assert.equal(history[0].to, address);
  assert.equal(history[0].valueLamports, 500_000_000);
});

test('SolanaExplorer handles contract interactions', async () => {
  const address = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5';

  const signatures = [
    { signature: 'sig_contract', slot: 300, blockTime: 1700000200, err: null }
  ];

  // Transaction with no balance change for the address (contract call)
  const parsedTx = {
    transaction: {
      message: {
        accountKeys: [{ pubkey: address }],
        instructions: [
          { program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'approve', info: {} } }
        ]
      }
    },
    meta: {
      fee: 5_000,
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
      err: null
    }
  };

  const explorer = new SolanaExplorer({
    networkKey: 'solana-mainnet',
    rpcUrls: ['mock://rpc'],
    connectionFactory: () => ({
      getSignaturesForAddress: async () => signatures,
      getParsedTransaction: async () => parsedTx
    })
  });

  const history = await explorer.getTransactionHistory(address, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].signature, 'sig_contract');
  // Only fee was paid, no transfer - should be contract_interaction or send with 0 value
  assert.ok(['send', 'contract_interaction'].includes(history[0].type));
});
