import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyExplorerApiKeys } from '../dist/config-utils.js';

const baseConfig = {
  network: 'mainnet',
  networks: {
    mainnet: { chainId: 1, rpcUrl: 'https://rpc.example.com', nativeSymbol: 'ETH', nativeName: 'Ether' },
    sepolia: { chainId: 11155111, rpcUrl: 'https://rpc.sepolia.org', nativeSymbol: 'ETH', nativeName: 'Sepolia Ether' },
    'ton-mainnet': { type: 'ton', tonNetwork: 'mainnet', rpcUrl: 'https://toncenter.com/api/v2/jsonRPC', nativeSymbol: 'TON', nativeName: 'Toncoin' }
  }
};

test('applies global and per-network explorer API keys from env', () => {
  const env = {
    EXPLORER_API_KEY: 'global-key',
    EXPLORER_API_KEY_SEPOLIA: 'override-key'
  };

  const { config, globalApiKey } = applyExplorerApiKeys(baseConfig, env);

  assert.equal(globalApiKey, 'global-key');
  assert.equal(config.networks.mainnet.explorerApiKey, 'global-key');
  assert.equal(config.networks.sepolia.explorerApiKey, 'override-key');
  assert.ok(!('explorerApiKey' in baseConfig.networks.mainnet), 'base config should not be mutated');
});

test('accepts Vite-prefixed explorer API keys for extension builds', () => {
  const env = {
    VITE_EXPLORER_API_KEY_MAINNET: 'vite-mainnet-key'
  };

  const { config, globalApiKey } = applyExplorerApiKeys(baseConfig, env);

  assert.equal(globalApiKey, undefined);
  assert.equal(config.networks.mainnet.explorerApiKey, 'vite-mainnet-key');
  assert.ok(!config.networks.sepolia.explorerApiKey);
});

test('applies Toncenter API key from env to TON networks', () => {
  const env = {
    TONCENTER_API_KEY_TON_MAINNET: 'ton-mainnet-key'
  };

  const { config } = applyExplorerApiKeys(baseConfig, env);

  assert.equal(config.networks['ton-mainnet'].rpcApiKey, 'ton-mainnet-key');
});
