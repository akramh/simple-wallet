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

test('substitutes ${ALCHEMY_API_KEY} in EVM and Solana rpcUrl from env', () => {
  const cfg = {
    network: 'mainnet',
    networks: {
      mainnet: {
        chainId: 1,
        rpcUrl: ['https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}', 'https://fallback.example.com'],
        nativeSymbol: 'ETH',
        nativeName: 'Ether',
      },
      'solana-mainnet': {
        type: 'solana',
        rpcUrl: 'https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
        nativeSymbol: 'SOL',
        nativeName: 'Solana',
      },
    },
  };

  const { config } = applyExplorerApiKeys(cfg, { ALCHEMY_API_KEY: 'abc123' });

  assert.deepEqual(config.networks.mainnet.rpcUrl, [
    'https://eth-mainnet.g.alchemy.com/v2/abc123',
    'https://fallback.example.com',
  ]);
  assert.equal(
    config.networks['solana-mainnet'].rpcUrl,
    'https://solana-mainnet.g.alchemy.com/v2/abc123',
  );
});

test('drops ${ALCHEMY_API_KEY} URLs when key is missing, keeps public fallbacks', () => {
  const cfg = {
    network: 'mainnet',
    networks: {
      mainnet: {
        chainId: 1,
        rpcUrl: ['https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}', 'https://public.example.com'],
        nativeSymbol: 'ETH',
        nativeName: 'Ether',
      },
    },
  };

  const { config } = applyExplorerApiKeys(cfg, {});

  // Placeholder URL dropped; fallback collapses string[] of length 1 to a string.
  assert.equal(config.networks.mainnet.rpcUrl, 'https://public.example.com');
});

test('regression: legacy ${HELIUS_API_KEY} substitution still works', () => {
  const cfg = {
    network: 'solana-mainnet',
    networks: {
      'solana-mainnet': {
        type: 'solana',
        rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}',
        nativeSymbol: 'SOL',
        nativeName: 'Solana',
      },
    },
  };

  const { config } = applyExplorerApiKeys(cfg, { HELIUS_API_KEY: 'legacy-key' });

  assert.equal(
    config.networks['solana-mainnet'].rpcUrl,
    'https://mainnet.helius-rpc.com/?api-key=legacy-key',
  );
});

test('runtime-injected ALCHEMY_API_KEY takes precedence over VITE_ variant', () => {
  // The extension injects a user-entered key as the bare env name on top of
  // import.meta.env; getEnvValue checks the bare name first, so the stored
  // key must win over the build-time VITE_ value.
  const cfg = {
    network: 'mainnet',
    networks: {
      mainnet: {
        chainId: 1,
        rpcUrl: ['https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}'],
        nativeSymbol: 'ETH',
        nativeName: 'Ether',
      },
    },
  };

  const { config } = applyExplorerApiKeys(cfg, {
    VITE_ALCHEMY_API_KEY: 'buildtime-key',
    ALCHEMY_API_KEY: 'runtime-key',
  });

  assert.equal(config.networks.mainnet.rpcUrl, 'https://eth-mainnet.g.alchemy.com/v2/runtime-key');
});
