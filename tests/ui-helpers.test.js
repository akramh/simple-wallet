import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAddress, menuChoice, getBlockExplorerUrl } from '../dist/ui-helpers.js';

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

test('formatAddress preserves address casing (Solana base58)', () => {
  const address = 'fdNZeYv2gRahWhEcoK4brXwgz5aBKVemNcuxucG5wQW';
  const formatted = formatAddress(address);
  assert.ok(
    formatted.includes(address),
    'formatAddress should not change casing for case-sensitive address formats'
  );
});

test('menuChoice does not exceed a safe terminal width', () => {
  const columns = typeof process.stdout?.columns === 'number' ? process.stdout.columns : 80;
  const safeWidth = Math.max(40, columns - 10);

  const choice = menuChoice(
    'metamask-long-wallet-name-that-would-wrap',
    '0x37c11fe495... (123 accounts)'
  );

  assert.equal(typeof choice.name, 'string');
  assert.ok(stripAnsi(choice.name).length <= safeWidth);
});

test('getBlockExplorerUrl resolves EVM mainnets', () => {
  const hash = '0xabc123';
  assert.equal(getBlockExplorerUrl(hash, 'mainnet'), `https://etherscan.io/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'polygon'), `https://polygonscan.com/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'arbitrum'), `https://arbiscan.io/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'optimism'), `https://optimistic.etherscan.io/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'bsc'), `https://bscscan.com/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'base'), `https://basescan.org/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'linea'), `https://lineascan.build/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'avalanche'), `https://snowtrace.io/tx/${hash}`);
});

test('getBlockExplorerUrl resolves EVM testnets', () => {
  const hash = '0xdef456';
  assert.equal(getBlockExplorerUrl(hash, 'sepolia'), `https://sepolia.etherscan.io/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'goerli'), `https://goerli.etherscan.io/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'mumbai'), `https://mumbai.polygonscan.com/tx/${hash}`);
  assert.equal(getBlockExplorerUrl(hash, 'bscTestnet'), `https://testnet.bscscan.com/tx/${hash}`);
});

test('getBlockExplorerUrl resolves Solana clusters', () => {
  const hash = '5xYz';
  assert.equal(
    getBlockExplorerUrl(hash, 'solana-mainnet'),
    `https://solscan.io/tx/${hash}`
  );
  assert.equal(
    getBlockExplorerUrl(hash, 'solana-devnet'),
    `https://solscan.io/tx/${hash}?cluster=devnet`
  );
});

test('getBlockExplorerUrl resolves Bitcoin networks', () => {
  const hash = 'a1b2c3';
  assert.equal(
    getBlockExplorerUrl(hash, 'bitcoin-mainnet'),
    `https://mempool.space/tx/${hash}`
  );
  assert.equal(
    getBlockExplorerUrl(hash, 'bitcoin-testnet'),
    `https://mempool.space/testnet/tx/${hash}`
  );
});

test('getBlockExplorerUrl resolves XRP Ledger networks', () => {
  const hash = 'ABCDEF';
  assert.equal(
    getBlockExplorerUrl(hash, 'xrp-mainnet'),
    `https://livenet.xrpl.org/transactions/${hash}`
  );
  assert.equal(
    getBlockExplorerUrl(hash, 'xrp-testnet'),
    `https://testnet.xrpl.org/transactions/${hash}`
  );
});

test('getBlockExplorerUrl resolves TON networks', () => {
  const hash = 'tonhash';
  assert.equal(
    getBlockExplorerUrl(hash, 'ton-mainnet'),
    `https://tonscan.org/tx/${hash}`
  );
  assert.equal(
    getBlockExplorerUrl(hash, 'ton-testnet'),
    `https://testnet.tonscan.org/tx/${hash}`
  );
});

test('getBlockExplorerUrl returns null for unknown networks', () => {
  assert.equal(getBlockExplorerUrl('0xabc', 'unknown'), null);
  assert.equal(getBlockExplorerUrl('0xabc', ''), null);
});
