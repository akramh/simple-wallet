import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAddress,
  menuChoice,
  getBlockExplorerUrl,
  showError,
  showPortfolioTotal,
  formatRelativeTime,
} from '../dist/ui-helpers.js';

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

function captureConsoleLog(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.map(stripAnsi).join('\n');
}

test('showError omits ℹ trailer when info is not provided', () => {
  const output = captureConsoleLog(() => {
    showError('Something went wrong', ['Try again']);
  });
  assert.ok(output.includes('Something went wrong'));
  assert.ok(output.includes('Try again'));
  assert.ok(!output.includes('ℹ'));
});

test('showError includes ℹ trailer when info is provided', () => {
  const output = captureConsoleLog(() => {
    showError(
      'Insufficient balance',
      ['Try a smaller amount'],
      'Your balance: 0.05 ETH · required: 0.10 ETH'
    );
  });
  assert.ok(output.includes('Insufficient balance'));
  assert.ok(output.includes('ℹ Your balance: 0.05 ETH · required: 0.10 ETH'));
});

test('showPortfolioTotal omits refresh hint when lastRefreshedAt is absent', () => {
  const output = captureConsoleLog(() => {
    showPortfolioTotal(1234.56);
  });
  assert.ok(output.includes('Total Portfolio Value:'));
  assert.ok(!output.includes('Last refreshed'));
});

test('showPortfolioTotal includes refresh hint when lastRefreshedAt is provided', () => {
  const output = captureConsoleLog(() => {
    showPortfolioTotal(1234.56, Date.now());
  });
  assert.ok(output.includes('Total Portfolio Value:'));
  assert.ok(output.includes('Last refreshed'));
  assert.ok(output.includes('Press r to refresh, q to return.'));
});

test('formatRelativeTime produces short past-time strings', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativeTime(now - 1_000, now), 'just now');
  assert.equal(formatRelativeTime(now - 30_000, now), '30s ago');
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatRelativeTime(now - 2 * 3_600_000, now), '2h ago');
  assert.equal(formatRelativeTime(now - 3 * 86_400_000, now), '3d ago');
  // Future timestamps clamp to "just now".
  assert.equal(formatRelativeTime(now + 10_000, now), 'just now');
});
