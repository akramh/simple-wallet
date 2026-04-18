import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getVisibleNetworkEntries, isNetworkUsable } from '../dist/network-visibility.js';

const networks = {
  mainnet: { name: 'Ethereum Mainnet', nativeSymbol: 'ETH', nativeName: 'Ether' },
  sepolia: { name: 'Sepolia', nativeSymbol: 'ETH', nativeName: 'Sepolia Ether', isTestnet: true },
  'solana-devnet': { name: 'Solana Devnet', nativeSymbol: 'SOL', nativeName: 'Solana', isTestnet: true }
};

test('getVisibleNetworkEntries hides testnets by default', () => {
  const entries = getVisibleNetworkEntries(networks, { showTestnets: false });
  const keys = entries.map(([key]) => key);
  assert.deepEqual(keys, ['mainnet']);
});

test('getVisibleNetworkEntries always includes current network', () => {
  const entries = getVisibleNetworkEntries(networks, {
    showTestnets: false,
    currentNetwork: 'sepolia'
  });
  const keys = entries.map(([key]) => key);
  assert.deepEqual(keys, ['mainnet', 'sepolia']);
});

test('getVisibleNetworkEntries includes testnets when enabled', () => {
  const entries = getVisibleNetworkEntries(networks, { showTestnets: true });
  const keys = entries.map(([key]) => key);
  assert.deepEqual(keys, ['mainnet', 'sepolia', 'solana-devnet']);
});

// ---------------------------------------------------------------------------
// isNetworkUsable
// ---------------------------------------------------------------------------

const usabilityNetworks = {
  mainnet:            { type: 'evm',     name: 'Ethereum',  nativeSymbol: 'ETH',  nativeName: 'Ether' },
  base:               { type: 'evm',     name: 'Base',      nativeSymbol: 'ETH',  nativeName: 'Ether' },
  'bitcoin-mainnet':  { type: 'bitcoin', name: 'Bitcoin',   nativeSymbol: 'BTC',  nativeName: 'Bitcoin', bitcoinNetwork: 'mainnet' },
  'solana-mainnet':   { type: 'solana',  name: 'Solana',    nativeSymbol: 'SOL',  nativeName: 'Solana' },
  'xrp-mainnet':      { type: 'xrp',     name: 'XRP',       nativeSymbol: 'XRP',  nativeName: 'XRP',      xrpNetwork: 'mainnet' },
  'ton-mainnet':      { type: 'ton',     name: 'TON',       nativeSymbol: 'TON',  nativeName: 'Toncoin',  tonNetwork: 'mainnet' },
  legacyEvm:          { name: 'Legacy EVM', nativeSymbol: 'ETH', nativeName: 'Ether' } // no `type` — should resolve as evm
};

test('isNetworkUsable: mnemonic wallets can use every network', () => {
  for (const key of Object.keys(usabilityNetworks)) {
    assert.equal(
      isNetworkUsable(key, usabilityNetworks[key], { importType: 'mnemonic' }),
      true,
      `expected ${key} usable for mnemonic wallet`
    );
  }
});

test('isNetworkUsable: missing import context treated as mnemonic', () => {
  assert.equal(isNetworkUsable('mainnet', usabilityNetworks.mainnet), true);
  assert.equal(isNetworkUsable('bitcoin-mainnet', usabilityNetworks['bitcoin-mainnet']), true);
  assert.equal(isNetworkUsable('mainnet', usabilityNetworks.mainnet, {}), true);
});

test('isNetworkUsable: bitcoin privateKey can only use bitcoin networks', () => {
  const ctx = { importType: 'privateKey', privateKeyType: 'bitcoin' };
  assert.equal(isNetworkUsable('bitcoin-mainnet', usabilityNetworks['bitcoin-mainnet'], ctx), true);
  assert.equal(isNetworkUsable('mainnet', usabilityNetworks.mainnet, ctx), false);
  assert.equal(isNetworkUsable('solana-mainnet', usabilityNetworks['solana-mainnet'], ctx), false);
});

test('isNetworkUsable: evm privateKey can use every evm network', () => {
  const ctx = { importType: 'privateKey', privateKeyType: 'evm' };
  assert.equal(isNetworkUsable('mainnet', usabilityNetworks.mainnet, ctx), true);
  assert.equal(isNetworkUsable('base', usabilityNetworks.base, ctx), true);
  assert.equal(isNetworkUsable('bitcoin-mainnet', usabilityNetworks['bitcoin-mainnet'], ctx), false);
  assert.equal(isNetworkUsable('solana-mainnet', usabilityNetworks['solana-mainnet'], ctx), false);
});

test('isNetworkUsable: solana / xrp / ton privateKeys each resolve their own chain', () => {
  for (const type of ['solana', 'xrp', 'ton']) {
    const ctx = { importType: 'privateKey', privateKeyType: type };
    const key = `${type}-mainnet`;
    assert.equal(isNetworkUsable(key, usabilityNetworks[key], ctx), true, `${type} key usable on ${key}`);
    assert.equal(isNetworkUsable('mainnet', usabilityNetworks.mainnet, ctx), false, `${type} key not usable on EVM`);
  }
});

test('isNetworkUsable: legacy evm config without type falls back to key prefix', () => {
  const ctx = { importType: 'privateKey', privateKeyType: 'evm' };
  assert.equal(isNetworkUsable('legacyEvm', usabilityNetworks.legacyEvm, ctx), true);
});

test('isNetworkUsable: undefined config still resolves from key prefix', () => {
  const btcCtx = { importType: 'privateKey', privateKeyType: 'bitcoin' };
  assert.equal(isNetworkUsable('bitcoin-mainnet', undefined, btcCtx), true);
  assert.equal(isNetworkUsable('mainnet', undefined, btcCtx), false);

  const solCtx = { importType: 'privateKey', privateKeyType: 'solana' };
  assert.equal(isNetworkUsable('solana-devnet', undefined, solCtx), true);
  assert.equal(isNetworkUsable('xrp-mainnet', undefined, solCtx), false);
});
