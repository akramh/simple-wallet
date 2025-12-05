import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';

import { Wallet } from '../dist/wallet.js';
import { MemoryStorage } from '../dist/storage.js';

test('provider failover uses next RPC when first fails', async () => {
  const calls = [];

  class MockProvider {
    constructor(url, chainId) {
      this.url = url;
      this.chainId = chainId;
    }
    async getBlockNumber() {
      calls.push(this.url);
      if (this.url.includes('bad')) {
        throw new Error('rpc down');
      }
      return 123;
    }
  }

  const config = {
    network: 'mainnet',
    networks: {
      mainnet: {
        chainId: 1,
        rpcUrl: ['https://bad-rpc.example', 'https://good-rpc.example']
      }
    }
  };

  const wallet = new Wallet(config, new MemoryStorage());
  wallet.providerFactory = {
    createProvider: (url, chainId) => new MockProvider(url, chainId)
  };
  await wallet.initialize();

  assert.equal(wallet.provider.url, 'https://good-rpc.example');
  assert.equal(calls.at(-1), 'https://good-rpc.example');
  assert.ok(calls.some(url => url.includes('bad')), 'should have tried the bad RPC first');
});

test('token metadata caches after first fetch', async () => {
  let symbolCalls = 0;

  class MockContract {
    constructor(address) {
      this.address = address;
    }
    async symbol() {
      symbolCalls += 1;
      return 'AAA';
    }
    async name() {
      return 'Alpha';
    }
    async decimals() {
      return 18;
    }
  }

  class MockProvider {
    constructor() {}
    async getBlockNumber() {
      return 1;
    }
  }

  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };

  const wallet = new Wallet(config, new MemoryStorage());
  wallet.providerFactory = {
    createProvider: () => new MockProvider()
  };
  wallet.ContractClass = MockContract;
  await wallet.initialize();
  const meta1 = await wallet.getTokenMetadata('0x0000000000000000000000000000000000000001');
  const meta2 = await wallet.getTokenMetadata('0x0000000000000000000000000000000000000001');

  assert.equal(symbolCalls, 1, 'should reuse cache on second fetch');
  assert.equal(meta1.symbol, 'AAA');
  assert.equal(meta2.symbol, 'AAA');
});

test('getTokenBalance surfaces BAD_DATA with descriptive error', async () => {
  class MockContract {
    constructor() {}
    async balanceOf() {
      const err = new Error('bad');
      err.code = 'BAD_DATA';
      throw err;
    }
  }

  class MockProvider {
    constructor() {}
    async getBlockNumber() {
      return 1;
    }
  }

  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };

  const wallet = new Wallet(config, new MemoryStorage());
  wallet.providerFactory = {
    createProvider: () => new MockProvider()
  };
  wallet.ContractClass = MockContract;
  await wallet.initialize();
  wallet.mnemonic = 'test test test test test test test test test test test junk';
  wallet.wallet = { address: '0x0000000000000000000000000000000000000002' };

  const token = { address: '0x0000000000000000000000000000000000000001', decimals: 18 };

  await assert.rejects(
    () => wallet.getTokenBalance(token),
    /Token read failed: RPC returned empty\/invalid data/
  );
});

test('setNetwork reconnects wallet to new provider', async () => {
  const constructed = [];

  class MockProvider {
    constructor(url, chainId) {
      this.url = url;
      this.chainId = chainId;
      constructed.push({ url, chainId });
    }
    async getBlockNumber() {
      return 1;
    }
  }

  const config = {
    network: 'mainnet',
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.mainnet' },
      base: { chainId: 8453, rpcUrl: 'https://rpc.base' }
    }
  };

  const wallet = new Wallet(config, new MemoryStorage());
  wallet.providerFactory = {
    createProvider: (url, chainId) => new MockProvider(url, chainId)
  };
  await wallet.initialize();
  // Load a dummy wallet with a mocked account derivation to avoid real key work.
  wallet.mnemonic = 'test test test test test test test test test test test junk';
  wallet._deriveAccount = () => ({
    address: '0x0000000000000000000000000000000000000003',
    connect: (provider) => ({ address: '0x0000000000000000000000000000000000000003', provider })
  });
  wallet.wallet = wallet._deriveAccount(0).connect(wallet.provider);

  await wallet.setNetwork('base');

  assert.equal(wallet.provider.url, 'https://rpc.base');
  assert.equal(constructed.length, 2, 'constructed providers for both networks');
  assert.ok(wallet.wallet.provider, 'wallet reconnected');
});

test('loadWallet rejects wrong password and tampered mnemonic', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  wallet.createNewWallet('correct-password');
  wallet.saveWallet('primary');

  await assert.rejects(
    async () => wallet.loadWallet('primary', 'wrong-password'),
    /Incorrect password/
  );

  const saved = storage.readJSON('wallets.json', {});
  saved.primary.encryptedMnemonic = saved.primary.encryptedMnemonic.replace(/./, 'x'); // corrupt
  storage.writeJSON('wallets.json', saved);

  await assert.rejects(
    async () => wallet.loadWallet('primary', 'correct-password'),
    /Incorrect password|invalid mnemonic/i
  );
});

test('switchAccount derives deterministic addresses and persists index', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  const mnemonic = 'test test test test test test test test test test test junk';
  wallet.importWallet(mnemonic, 'pw', 0);
  wallet.saveWallet('acct');

  const first = wallet.switchAccount(0);
  const second = wallet.switchAccount(1);
  assert.notEqual(first.address, second.address, 'account 0 and 1 should differ');

  wallet.saveWallet('acct');
  const reloaded = wallet.loadWallet('acct', 'pw');
  assert.equal(wallet.getCurrentAccountIndex(), 1, 'current account index persisted');
});

test('multiple wallets coexist and can be listed', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  wallet.createNewWallet('pw1');
  wallet.saveWallet('one');
  wallet.createNewWallet('pw2');
  wallet.saveWallet('two');

  const all = wallet.getAllWallets();
  assert.ok(all.one, 'wallet one present');
  assert.ok(all.two, 'wallet two present');
  assert.notEqual(all.one.encryptedMnemonic, all.two.encryptedMnemonic, 'wallets have unique data');
});
