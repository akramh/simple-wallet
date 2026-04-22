import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnifiedPortfolio,
  formatUsd,
  getTokenKey,
} from '../dist/unified-portfolio.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000; // fixed time for deterministic staleness
const FIVE_MIN = 5 * 60 * 1000;

const NATIVE_ETH = { symbol: 'ETH', name: 'Ethereum', type: 'native', address: 'native', decimals: 18 };
const NATIVE_SOL = { symbol: 'SOL', name: 'Solana',   type: 'native', address: 'native', decimals: 9 };
const NATIVE_BTC = { symbol: 'BTC', name: 'Bitcoin',  type: 'native', address: 'native', decimals: 8 };
const NATIVE_XRP = { symbol: 'XRP', name: 'XRP',      type: 'native', address: 'native', decimals: 6 };
const NATIVE_TON = { symbol: 'TON', name: 'Toncoin',  type: 'native', address: 'native', decimals: 9 };

const USDC_MAINNET = {
  symbol: 'USDC', name: 'USD Coin', type: 'erc20',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6
};
const USDC_BASE = {
  symbol: 'USDC', name: 'USD Coin', type: 'erc20',
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6
};

function entry(token, balance, priceUsd, opts = {}) {
  return {
    token,
    balance,
    lastUpdated: opts.lastUpdated ?? NOW,
    priceUsd,
    error: opts.error,
  };
}

const MAINNET_INPUT = {
  networkKey: 'mainnet',
  networkLabel: 'Ethereum',
  chainBadgeIcon: 'eth.svg',
  balances: [
    entry(NATIVE_ETH, '0.5760', 3645.83),   // ~$2,100
    entry(USDC_MAINNET, '0.0', 1.0),        // zero non-native → should hide by default
  ],
};

const BASE_INPUT = {
  networkKey: 'base',
  networkLabel: 'Base',
  chainBadgeIcon: 'base.svg',
  balances: [
    entry(NATIVE_ETH, '2.3104', 3645.83),   // ~$8,420
    entry(USDC_BASE, '1250.00', 1.0),        // $1,250
  ],
};

const SOLANA_INPUT = {
  networkKey: 'solana-mainnet',
  networkLabel: 'Solana',
  chainBadgeIcon: 'solana-logo.svg',
  balances: [
    entry(NATIVE_SOL, '3.1704', 150.0),      // $475.56
  ],
};

const BITCOIN_INPUT = {
  networkKey: 'bitcoin-mainnet',
  networkLabel: 'Bitcoin',
  chainBadgeIcon: 'bitcoin-logo.svg',
  balances: [
    entry(NATIVE_BTC, '0.00123', 60000.0, { lastUpdated: NOW - (10 * 60 * 1000) }), // stale (10 min old)
  ],
};

const TON_INPUT_UNPRICED = {
  networkKey: 'ton-mainnet',
  networkLabel: 'TON',
  chainBadgeIcon: 'ton_symbol.svg',
  balances: [
    entry(NATIVE_TON, '12.5', null),         // price unavailable
  ],
};

const XRP_ZERO = {
  networkKey: 'xrp-mainnet',
  networkLabel: 'XRP',
  chainBadgeIcon: 'xrp-logo.svg',
  balances: [
    entry(NATIVE_XRP, '0', 0.5),             // zero native — hidden by default (matches MetaMask/Phantom)
  ],
};

const ALL_INPUTS = [MAINNET_INPUT, BASE_INPUT, SOLANA_INPUT, BITCOIN_INPUT, TON_INPUT_UNPRICED, XRP_ZERO];

// ---------------------------------------------------------------------------
// getTokenKey
// ---------------------------------------------------------------------------

test('getTokenKey: native tokens return "native"', () => {
  assert.equal(getTokenKey(NATIVE_ETH), 'native');
  assert.equal(getTokenKey(NATIVE_BTC), 'native');
});

test('getTokenKey: non-native tokens return lowercased address', () => {
  assert.equal(getTokenKey(USDC_MAINNET), '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  assert.equal(getTokenKey(USDC_BASE), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
});

// ---------------------------------------------------------------------------
// formatUsd
// ---------------------------------------------------------------------------

test('formatUsd: null and zero', () => {
  assert.equal(formatUsd(null), '—');
  assert.equal(formatUsd(undefined), '—');
  assert.equal(formatUsd(0), '$0.00');
});

test('formatUsd: sub-cent values', () => {
  assert.equal(formatUsd(0.003), '<$0.01');
  assert.equal(formatUsd(0.009), '<$0.01');
});

test('formatUsd: locale grouping for large values', () => {
  assert.equal(formatUsd(1234.56), '$1,234.56');
  assert.equal(formatUsd(1_000_000), '$1,000,000.00');
});

// ---------------------------------------------------------------------------
// buildUnifiedPortfolio — core aggregation
// ---------------------------------------------------------------------------

test('aggregates across EVM + Solana + BTC + XRP + TON fixtures', () => {
  const snap = buildUnifiedPortfolio(ALL_INPUTS, { now: NOW });

  // All zero balances hidden — including natives — under the default filter.
  const rowKeys = snap.rows.map(r => r.rowKey);
  assert.ok(rowKeys.includes('base:native'),   'ETH on Base present');
  assert.ok(rowKeys.includes('mainnet:native'),'ETH on mainnet present');
  assert.ok(rowKeys.includes('base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), 'USDC on Base present');
  assert.ok(rowKeys.includes('solana-mainnet:native'), 'SOL present');
  assert.ok(rowKeys.includes('bitcoin-mainnet:native'), 'BTC present (non-zero balance)');
  assert.ok(rowKeys.includes('ton-mainnet:native'),     'TON (unpriced but non-zero) present');
  assert.ok(!rowKeys.includes('xrp-mainnet:native'),    'zero-balance native XRP hidden by default');
  assert.ok(!rowKeys.includes('mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'), 'zero-balance USDC on mainnet hidden');
});

test('totalUsd sums only rows with a known price', () => {
  const snap = buildUnifiedPortfolio(ALL_INPUTS, { now: NOW });
  // Compute the expected total from the same inputs the aggregator saw,
  // so the test doesn't hard-code a value that can drift with float rounding.
  const priced = ALL_INPUTS.flatMap(n => n.balances)
    .filter(e => e.priceUsd !== null)
    .reduce((sum, e) => sum + parseFloat(e.balance) * e.priceUsd, 0);
  assert.ok(Math.abs(snap.totalUsd - priced) < 1e-6, `unexpected totalUsd ${snap.totalUsd}`);
  assert.equal(typeof snap.totalUsdFormatted, 'string');
  assert.ok(snap.totalUsdFormatted.startsWith('$'));
});

test('default sort is USD descending with null-USD rows last', () => {
  const snap = buildUnifiedPortfolio(ALL_INPUTS, { now: NOW });
  // First row is the highest USD (ETH on base ≈ $8,420)
  assert.equal(snap.rows[0].rowKey, 'base:native');
  // TON has a non-zero balance but null price — should end up last.
  const tonIdx = snap.rows.findIndex(r => r.rowKey === 'ton-mainnet:native');
  assert.equal(tonIdx, snap.rows.length - 1, `TON should be last, got index ${tonIdx}`);
});

test('separates USDC-on-mainnet from USDC-on-base as distinct rows', () => {
  // use a non-zero mainnet USDC balance so both survive the zero filter
  const inputs = [
    { ...MAINNET_INPUT, balances: [entry(USDC_MAINNET, '500', 1.0)] },
    { ...BASE_INPUT,    balances: [entry(USDC_BASE,    '1250', 1.0)] },
  ];
  const snap = buildUnifiedPortfolio(inputs, { now: NOW });
  assert.equal(snap.rows.length, 2);
  const rowKeys = snap.rows.map(r => r.rowKey).sort();
  assert.deepEqual(rowKeys, [
    'base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    'mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ]);
  // Base (1250) > Mainnet (500) under fiat sort
  assert.equal(snap.rows[0].networkKey, 'base');
});

// ---------------------------------------------------------------------------
// Zero-balance filter
// ---------------------------------------------------------------------------

test('showZeroBalances=false hides every zero-balance row, natives included', () => {
  const input = {
    networkKey: 'mainnet',
    networkLabel: 'Ethereum',
    balances: [
      entry(NATIVE_ETH, '0', 3000),
      entry(USDC_MAINNET, '0', 1),
    ],
  };
  const snap = buildUnifiedPortfolio([input], { now: NOW });
  assert.equal(snap.rows.length, 0, 'all zero rows are hidden by default');
});

test('showZeroBalances=true keeps everything', () => {
  const input = {
    networkKey: 'mainnet',
    networkLabel: 'Ethereum',
    balances: [
      entry(NATIVE_ETH, '0', 3000),
      entry(USDC_MAINNET, '0', 1),
    ],
  };
  const snap = buildUnifiedPortfolio([input], { now: NOW, showZeroBalances: true });
  assert.equal(snap.rows.length, 2);
});

// ---------------------------------------------------------------------------
// Single-chain wallet (simulates `privateKey/bitcoin` import — only BTC input)
// ---------------------------------------------------------------------------

test('single-chain input renders only that chain', () => {
  const snap = buildUnifiedPortfolio([BITCOIN_INPUT], { now: NOW });
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.rows[0].networkKey, 'bitcoin-mainnet');
  assert.equal(snap.rows[0].token.symbol, 'BTC');
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

test('stale flag set when balance older than balanceCacheTtlMs', () => {
  const snap = buildUnifiedPortfolio([BITCOIN_INPUT], { now: NOW, balanceCacheTtlMs: FIVE_MIN });
  assert.equal(snap.rows[0].stale, true);
  assert.ok(snap.networkStaleness['bitcoin-mainnet'] >= 10 * 60 * 1000);
});

test('stale flag cleared when balance fresh', () => {
  const fresh = { ...BITCOIN_INPUT, balances: [entry(NATIVE_BTC, '0.00123', 60000.0, { lastUpdated: NOW - 1000 })] };
  const snap = buildUnifiedPortfolio([fresh], { now: NOW });
  assert.equal(snap.rows[0].stale, false);
});

// ---------------------------------------------------------------------------
// Alternative sort modes
// ---------------------------------------------------------------------------

test('alpha sort: A→Z by token name with network tie-break', () => {
  const inputs = [
    { networkKey: 'base',    networkLabel: 'Base',     balances: [entry(NATIVE_ETH, '1', 3000)] },
    { networkKey: 'mainnet', networkLabel: 'Ethereum', balances: [entry(NATIVE_ETH, '1', 3000)] },
    { networkKey: 'xrp-mainnet', networkLabel: 'XRP',  balances: [entry(NATIVE_XRP, '10', 0.5)] },
    { networkKey: 'bitcoin-mainnet', networkLabel: 'Bitcoin', balances: [entry(NATIVE_BTC, '0.01', 60000)] },
  ];
  const snap = buildUnifiedPortfolio(inputs, { now: NOW, sort: 'alpha' });
  const names = snap.rows.map(r => r.token.name);
  assert.deepEqual(names, ['Bitcoin', 'Ethereum', 'Ethereum', 'XRP']);
  // tie within Ethereum goes base → mainnet (alphabetical by networkKey)
  const ethIdx = snap.rows.findIndex(r => r.token.name === 'Ethereum');
  assert.equal(snap.rows[ethIdx].networkKey, 'base');
  assert.equal(snap.rows[ethIdx + 1].networkKey, 'mainnet');
});

test('chain sort: group by network label, fiat desc within each', () => {
  const inputs = [
    { networkKey: 'base',    networkLabel: 'Base',     balances: [
      entry(NATIVE_ETH, '1', 3000),
      entry(USDC_BASE, '500', 1),
    ] },
    { networkKey: 'mainnet', networkLabel: 'Ethereum', balances: [
      entry(NATIVE_ETH, '0.1', 3000),
      entry(USDC_MAINNET, '5000', 1),
    ] },
  ];
  const snap = buildUnifiedPortfolio(inputs, { now: NOW, sort: 'chain' });
  const order = snap.rows.map(r => `${r.networkKey}:${r.token.symbol}`);
  assert.deepEqual(order, [
    'base:ETH',      // Base comes before Ethereum alphabetically
    'base:USDC',
    'mainnet:USDC',  // USDC 5000 > ETH 300 within Ethereum
    'mainnet:ETH',
  ]);
});

// ---------------------------------------------------------------------------
// Error passthrough
// ---------------------------------------------------------------------------

test('error field from per-network input flows through to the row', () => {
  const input = {
    networkKey: 'mainnet',
    networkLabel: 'Ethereum',
    balances: [entry(NATIVE_ETH, 'Error', null, { error: 'RPC down' })],
  };
  const snap = buildUnifiedPortfolio([input], { now: NOW });
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.rows[0].error, 'RPC down');
  assert.equal(snap.rows[0].balanceNumber, 0, 'unparsable balance string coerced to 0');
  assert.equal(snap.rows[0].usdValue, null);
});

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

test('empty input yields empty snapshot', () => {
  const snap = buildUnifiedPortfolio([], { now: NOW });
  assert.deepEqual(snap.rows, []);
  assert.equal(snap.totalUsd, 0);
  assert.equal(snap.totalUsdFormatted, '$0.00');
  assert.deepEqual(snap.networkStaleness, {});
});

// ---------------------------------------------------------------------------
// Testnet pricing invariant
//
// The service-worker's `pricesAvailableForNetwork` guard ensures testnet
// tokens arrive here with `priceUsd: null`. These tests pin the aggregator's
// side of the contract: a null price must mean "no USD contribution", so
// toggling test-networks visibility only adds/removes rows — it cannot
// inflate or deflate the fiat total.
// ---------------------------------------------------------------------------

const SEPOLIA_TESTNET_INPUT = {
  networkKey: 'sepolia',
  networkLabel: 'Sepolia',
  chainBadgeIcon: 'eth.svg',
  balances: [
    // Sepolia ETH with priceUsd=null — the shape the service-worker produces
    // once the testnet price guard short-circuits resolvePricesForNetwork.
    entry(NATIVE_ETH, '0.75', null),
  ],
};

test('testnet rows (null-priced) are rendered but contribute zero to totalUsd', () => {
  const snap = buildUnifiedPortfolio([MAINNET_INPUT, SEPOLIA_TESTNET_INPUT], {
    now: NOW,
    showZeroBalances: false,
  });

  const sepoliaRow = snap.rows.find((r) => r.networkKey === 'sepolia');
  assert.ok(sepoliaRow, 'sepolia row should render when user opted in to testnets');
  assert.equal(sepoliaRow.usdValue, null, 'testnet row has no USD value');
  assert.equal(sepoliaRow.usdFormatted, null, 'testnet row renders "—" in the UI');

  // totalUsd should equal JUST the mainnet ETH contribution — 0.5760 × 3645.83
  // rounded via normal number math. The sepolia balance (0.75 ETH × whatever
  // mainnet ETH happens to be worth) must NOT be added in.
  const expectedMainnetOnly = 0.576 * 3645.83;
  assert.ok(
    Math.abs(snap.totalUsd - expectedMainnetOnly) < 0.01,
    `totalUsd (${snap.totalUsd}) must exclude the testnet row (expected ~${expectedMainnetOnly})`
  );
});

test('toggling testnets on/off only changes row count, never totalUsd', () => {
  // Simulates the user flipping "show test networks" — the service-worker
  // changes the input set but the already-cached balances are identical. The
  // totalUsd must be stable across the two calls because testnet priceUsd
  // stays null either way.
  const withoutTestnets = buildUnifiedPortfolio([MAINNET_INPUT], { now: NOW });
  const withTestnets = buildUnifiedPortfolio([MAINNET_INPUT, SEPOLIA_TESTNET_INPUT], { now: NOW });

  assert.equal(
    withoutTestnets.totalUsd,
    withTestnets.totalUsd,
    'testnet visibility must not move the fiat total'
  );
  assert.ok(
    withTestnets.rows.length > withoutTestnets.rows.length,
    'showing testnets should add rows'
  );
});
