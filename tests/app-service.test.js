import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';
import { deriveTonAddress } from '../dist/ton/index.js';

test('WalletAppService returns native token first and merges built-in/custom', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {
    mainnet: [
      { symbol: 'USDC', address: '0x0000000000000000000000000000000000000001', decimals: 6, type: 'erc20' }
    ]
  });
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'mainnet',
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.example', nativeSymbol: 'ETH', nativeName: 'Ether' }
    }
  };

  class MockProvider {
    constructor() {}
    async getBlockNumber() {
      return 1;
    }
  }

  const mockFactory = { createProvider: (url, chainId) => new MockProvider(url, chainId) };
  const wallet = new Wallet(config, storage, mockFactory);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: mockFactory });
  await svc.initialize();

  const tokens = svc.getTokensForNetwork('mainnet');
  assert.equal(tokens[0].type, 'native');
  assert.equal(tokens[0].symbol, 'ETH');
  assert.ok(tokens.some(t => t.symbol === 'USDC' && t.address.endsWith('1')));
});

test('WalletAppService add/remove custom tokens updates storage list', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', { mainnet: [] });
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example', nativeSymbol: 'ETH', nativeName: 'Ether' } }
  };

  class MockProvider {
    constructor() {}
    async getBlockNumber() {
      return 1;
    }
  }

  const mockFactory = { createProvider: (url, chainId) => new MockProvider(url, chainId) };
  const wallet = new Wallet(config, storage, mockFactory);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: mockFactory });
  await svc.initialize();

  svc.addCustomToken('mainnet', { symbol: 'TKN', address: '0x00000000000000000000000000000000000000aa', decimals: 18, type: 'erc20' });
  let tokens = svc.getTokensForNetwork('mainnet');
  assert.ok(tokens.some(t => t.symbol === 'TKN'));

  svc.removeCustomToken('mainnet', '0x00000000000000000000000000000000000000aa');
  tokens = svc.getTokensForNetwork('mainnet');
  assert.ok(!tokens.some(t => t.symbol === 'TKN'));
});

test('setNetwork persists updated config using storage adapter', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'mainnet',
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.example', nativeSymbol: 'ETH', nativeName: 'Ether' },
      base: { chainId: 8453, rpcUrl: 'https://rpc.base', nativeSymbol: 'ETH', nativeName: 'Base' }
    }
  };

  class MockProvider {
    constructor(url, chainId) {
      this.url = url;
      this.chainId = chainId;
    }
    async getBlockNumber() {
      return 1;
    }
  }

  const mockFactory = { createProvider: (url, chainId) => new MockProvider(url, chainId) };
  const wallet = new Wallet(config, storage, mockFactory);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: mockFactory });
  await svc.initialize();

  await svc.setNetwork('base');

  const persisted = storage.readJSON('config.json', { network: '' });
  assert.equal(persisted.network, 'base');
  assert.equal(wallet.provider.chainId, 8453);
});

test('getGasEstimate uses in-memory mnemonic for TON fee estimation', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'ton-mainnet',
    networks: {
      'ton-mainnet': {
        name: 'TON Mainnet',
        type: 'ton',
        tonNetwork: 'mainnet',
        rpcUrl: 'https://ton.example',
        nativeSymbol: 'TON',
        nativeName: 'Toncoin'
      }
    }
  };

  const wallet = new Wallet(config, storage);
  const svc = new WalletAppService(wallet, config, { storage });
  await svc.initialize();

  wallet.createNewWallet('password');
  const mnemonic = wallet.mnemonic;
  const { address } = deriveTonAddress(mnemonic, 0);

  const calls = [];
  svc.tonProvider = {
    getNetworkKey: () => 'ton-mainnet',
    estimateFee: async (...args) => {
      calls.push(args);
      return { feeNano: '1000', feeTon: '0.000001' };
    }
  };

  const token = { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: 'native' };
  const estimate = await svc.getGasEstimate(token, address, '1.0');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], mnemonic);
  assert.equal(estimate.estimatedCostNative, '0.000001');
});

test('sendTonTransaction passes current account index to provider', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'ton-mainnet',
    networks: {
      'ton-mainnet': {
        name: 'TON Mainnet',
        type: 'ton',
        tonNetwork: 'mainnet',
        rpcUrl: 'https://ton.example',
        nativeSymbol: 'TON',
        nativeName: 'Toncoin'
      }
    }
  };

  const wallet = new Wallet(config, storage);
  const svc = new WalletAppService(wallet, config, { storage });
  await svc.initialize();

  wallet.createNewWallet('password');
  wallet.switchAccount(1);

  const calls = [];
  svc.tonProvider = {
    getNetworkKey: () => 'ton-mainnet',
    sendTransaction: async (...args) => {
      calls.push(args);
      return { hash: 'ton_hash' };
    }
  };

  await svc.sendTonTransaction('UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', '1', 'password');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][5], 1);
});
