import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRequestBodies,
  parseHexBalance,
  parsePortfolioResponse,
  isPortfolioSupported,
  NETWORK_KEY_TO_PORTFOLIO_SLUG,
} from '../dist/portfolio-api.js';

// ---------------------------------------------------------------------------
// isPortfolioSupported / slug map
// ---------------------------------------------------------------------------

test('isPortfolioSupported covers the 8 EVM chains + solana-mainnet', () => {
  for (const key of ['mainnet', 'sepolia', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea', 'solana-mainnet']) {
    assert.equal(isPortfolioSupported(key), true, `${key} should be supported`);
  }
});

test('isPortfolioSupported returns false for BTC / XRP / TON', () => {
  for (const key of ['bitcoin-mainnet', 'bitcoin-testnet', 'xrp-mainnet', 'ton-mainnet', 'solana-devnet']) {
    assert.equal(isPortfolioSupported(key), false, `${key} should be unsupported`);
  }
});

test('slug map uses Alchemy naming (eth-mainnet, bnb-mainnet, sol-mainnet)', () => {
  assert.equal(NETWORK_KEY_TO_PORTFOLIO_SLUG.mainnet, 'eth-mainnet');
  assert.equal(NETWORK_KEY_TO_PORTFOLIO_SLUG.bsc, 'bnb-mainnet');
  assert.equal(NETWORK_KEY_TO_PORTFOLIO_SLUG['solana-mainnet'], 'sol-mainnet');
});

// ---------------------------------------------------------------------------
// parseHexBalance
// ---------------------------------------------------------------------------

test('parseHexBalance: empty / null / invalid → "0"', () => {
  assert.equal(parseHexBalance(null, 18), '0');
  assert.equal(parseHexBalance(undefined, 18), '0');
  assert.equal(parseHexBalance('', 18), '0');
  assert.equal(parseHexBalance('not-hex', 18), '0');
});

test('parseHexBalance: zero', () => {
  assert.equal(parseHexBalance('0x0', 18), '0');
  assert.equal(parseHexBalance('0x00000000', 6), '0');
});

test('parseHexBalance: whole-number balance with no fractional part', () => {
  // 1 * 10^18
  assert.equal(parseHexBalance('0xde0b6b3a7640000', 18), '1');
  // 5 * 10^6 = 5 USDC
  assert.equal(parseHexBalance('0x4c4b40', 6), '5');
});

test('parseHexBalance: fractional ETH', () => {
  // 0.5 ETH = 500000000000000000
  assert.equal(parseHexBalance('0x6f05b59d3b20000', 18), '0.5');
  // 2.3104 ETH (approximate, from aggregator test)
  const hex = '0x' + BigInt('2310400000000000000').toString(16);
  assert.equal(parseHexBalance(hex, 18), '2.3104');
});

test('parseHexBalance: trailing zeros trimmed', () => {
  // 1.100000000000000000 ETH → "1.1"
  const hex = '0x' + BigInt('1100000000000000000').toString(16);
  assert.equal(parseHexBalance(hex, 18), '1.1');
});

test('parseHexBalance: decimals <= 0 returns integer toString', () => {
  assert.equal(parseHexBalance('0x10', 0), '16');
  assert.equal(parseHexBalance('0x10', -1), '16');
});

test('parseHexBalance: accepts hex without 0x prefix', () => {
  assert.equal(parseHexBalance('de0b6b3a7640000', 18), '1');
});

test('parseHexBalance: huge value (no float overflow)', () => {
  // 1,000,000,000 ETH in wei
  const hex = '0x' + (10n ** 27n).toString(16);
  assert.equal(parseHexBalance(hex, 18), '1000000000');
});

// ---------------------------------------------------------------------------
// buildRequestBodies
// ---------------------------------------------------------------------------

test('buildRequestBodies: single address with 5 networks fits in one request', () => {
  const bodies = buildRequestBodies([
    { address: '0xabc', networkKeys: ['mainnet', 'base', 'arbitrum', 'optimism', 'polygon'] }
  ]);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].addresses.length, 1);
  assert.deepEqual(bodies[0].addresses[0].networks, [
    'eth-mainnet', 'base-mainnet', 'arb-mainnet', 'opt-mainnet', 'polygon-mainnet'
  ]);
});

test('buildRequestBodies: single address with 8 EVM chains splits into 2 chunks, fits 1 request', () => {
  const bodies = buildRequestBodies([
    { address: '0xabc', networkKeys: ['mainnet', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea'] }
  ]);
  // Two chunks of 5 + 3, both fit in one 2-address request.
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].addresses.length, 2);
  assert.equal(bodies[0].addresses[0].networks.length, 5);
  assert.equal(bodies[0].addresses[1].networks.length, 3);
});

test('buildRequestBodies: EVM (8 nets) + Solana address → 2 chunks EVM + 1 chunk SOL = 2 requests', () => {
  const bodies = buildRequestBodies([
    { address: '0xabc', networkKeys: ['mainnet', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea'] },
    { address: 'SolAnA...', networkKeys: ['solana-mainnet'] }
  ]);
  // 3 chunks → request 1 packs first 2, request 2 packs the remaining 1
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].addresses.length, 2);
  assert.equal(bodies[1].addresses.length, 1);
  assert.deepEqual(bodies[1].addresses[0].networks, ['sol-mainnet']);
});

test('buildRequestBodies: drops unsupported networks silently', () => {
  const bodies = buildRequestBodies([
    { address: '0xabc', networkKeys: ['mainnet', 'bitcoin-mainnet', 'xrp-mainnet', 'base'] }
  ]);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].addresses[0].networks, ['eth-mainnet', 'base-mainnet']);
});

test('buildRequestBodies: empty address group is skipped', () => {
  const bodies = buildRequestBodies([
    { address: '', networkKeys: ['mainnet'] },
    { address: '0xabc', networkKeys: ['base'] }
  ]);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].addresses.length, 1);
  assert.equal(bodies[0].addresses[0].address, '0xabc');
});

test('buildRequestBodies: group with only unsupported networks produces no request', () => {
  const bodies = buildRequestBodies([
    { address: '0xabc', networkKeys: ['bitcoin-mainnet', 'ton-mainnet'] }
  ]);
  assert.equal(bodies.length, 0);
});

test('buildRequestBodies: empty input → []', () => {
  assert.deepEqual(buildRequestBodies([]), []);
});

// ---------------------------------------------------------------------------
// parsePortfolioResponse
// ---------------------------------------------------------------------------

test('parsePortfolioResponse: empty + malformed responses safely return []', () => {
  assert.deepEqual(parsePortfolioResponse(null), []);
  assert.deepEqual(parsePortfolioResponse({}), []);
  assert.deepEqual(parsePortfolioResponse({ data: {} }), []);
  assert.deepEqual(parsePortfolioResponse({ data: { tokens: [] } }), []);
});

test('parsePortfolioResponse: native ETH with price', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'eth-mainnet',
        address: '0xabc',
        tokenAddress: null,
        tokenBalance: '0xde0b6b3a7640000', // 1 ETH
        tokenMetadata: { symbol: null, decimals: null, name: null, logo: null },
        tokenPrices: [{ currency: 'usd', value: '3000.25' }]
      }]
    }
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].networkKey, 'mainnet');
  assert.equal(entries[0].tokenKey, 'native');
  assert.equal(entries[0].balance, '1');
  assert.equal(entries[0].decimals, 18);
  assert.equal(entries[0].priceUsd, 3000.25);
});

test('parsePortfolioResponse: ERC-20 with metadata + price, address lowercased', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'base-mainnet',
        address: '0xabc',
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        tokenBalance: '0x4c4b40', // 5 * 10^6
        tokenMetadata: { name: 'USD Coin', symbol: 'USDC', decimals: 6, logo: 'https://x/usdc.png' },
        tokenPrices: [{ currency: 'usd', value: '1.0' }]
      }]
    }
  });
  assert.equal(entries[0].networkKey, 'base');
  assert.equal(entries[0].tokenKey, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  assert.equal(entries[0].balance, '5');
  assert.equal(entries[0].priceUsd, 1);
  assert.equal(entries[0].symbol, 'USDC');
});

test('parsePortfolioResponse: unknown network slug is dropped', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [
        { network: 'zora-mainnet', tokenAddress: null, tokenBalance: '0x1' },
        { network: 'eth-mainnet', tokenAddress: null, tokenBalance: '0xde0b6b3a7640000', tokenMetadata: { decimals: 18 } }
      ]
    }
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].networkKey, 'mainnet');
});

test('parsePortfolioResponse: ERC-20 without decimals metadata is skipped (unparseable)', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'eth-mainnet',
        tokenAddress: '0xdead',
        tokenBalance: '0x100',
        tokenMetadata: { symbol: 'UNK' /* no decimals */ }
      }]
    }
  });
  assert.equal(entries.length, 0);
});

test('parsePortfolioResponse: missing tokenPrices → priceUsd null', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'eth-mainnet',
        tokenAddress: null,
        tokenBalance: '0xde0b6b3a7640000'
      }]
    }
  });
  assert.equal(entries[0].priceUsd, null);
});

test('parsePortfolioResponse: non-usd prices ignored', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'eth-mainnet',
        tokenAddress: null,
        tokenBalance: '0xde0b6b3a7640000',
        tokenPrices: [{ currency: 'eur', value: '2500' }]
      }]
    }
  });
  assert.equal(entries[0].priceUsd, null);
});

test('parsePortfolioResponse: solana native decimals default to 9', () => {
  const entries = parsePortfolioResponse({
    data: {
      tokens: [{
        network: 'sol-mainnet',
        tokenAddress: null,
        tokenBalance: '0x3b9aca00' // 10^9 lamports = 1 SOL
      }]
    }
  });
  assert.equal(entries[0].networkKey, 'solana-mainnet');
  assert.equal(entries[0].decimals, 9);
  assert.equal(entries[0].balance, '1');
});
