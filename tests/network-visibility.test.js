import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getVisibleNetworkEntries } from '../dist/network-visibility.js';

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
