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

// ============================================================================
// Wallet Import/Export Tests
// ============================================================================

test('importWallet with valid mnemonic creates wallet', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  // Standard 12-word test mnemonic
  const mnemonic = 'test test test test test test test test test test test junk';
  wallet.importWallet(mnemonic, 'password123', 0);

  assert.ok(wallet.wallet, 'wallet should be created');
  assert.ok(wallet.wallet.address, 'wallet should have an address');
  assert.ok(wallet.mnemonic, 'mnemonic should be stored');
});

test('importWallet with invalid mnemonic throws error', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  // Invalid mnemonic (random words)
  const invalidMnemonic = 'not a valid mnemonic phrase that will work here';

  assert.throws(
    () => wallet.importWallet(invalidMnemonic, 'password123', 0),
    /invalid mnemonic/i
  );
});

test('importWallet with too few words throws error', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  // Only 6 words instead of 12
  const shortMnemonic = 'test test test test test junk';

  assert.throws(
    () => wallet.importWallet(shortMnemonic, 'password123', 0),
    /invalid mnemonic/i
  );
});

test('importWallet derives deterministic address from mnemonic', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet1 = new Wallet(config, storage);
  wallet1.providerFactory = { createProvider: () => new MockProvider() };
  await wallet1.initialize();

  const wallet2 = new Wallet(config, new MemoryStorage());
  wallet2.providerFactory = { createProvider: () => new MockProvider() };
  await wallet2.initialize();

  const mnemonic = 'test test test test test test test test test test test junk';
  
  wallet1.importWallet(mnemonic, 'password1', 0);
  wallet2.importWallet(mnemonic, 'password2', 0);

  // Same mnemonic should produce same address regardless of password
  assert.equal(wallet1.wallet.address, wallet2.wallet.address, 
    'same mnemonic should derive same address');
});

test('exportWallet creates backup file with wallet data', async () => {
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
  wallet.importWallet(mnemonic, 'password123', 0);
  wallet.saveWallet('export-test');

  // Export to a "file" (using MemoryStorage)
  const result = wallet.exportWallet('export-test', 'backup.json');

  assert.ok(result, 'export should succeed');
  
  // Verify the backup file was created
  const backupContent = storage.readFile('backup.json');
  assert.ok(backupContent, 'backup file should exist');
  
  const backup = JSON.parse(backupContent);
  assert.ok(backup.version, 'backup should have version');
  assert.ok(backup.exportedAt, 'backup should have exportedAt timestamp');
  assert.ok(backup.wallet, 'backup should have wallet data');
  assert.ok(backup.wallet.encryptedMnemonic, 'backup should have encryptedMnemonic');
});

test('exportWallet fails for non-existent wallet', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  assert.throws(
    () => wallet.exportWallet('non-existent-wallet', 'backup.json'),
    /Wallet not found|Export failed/i
  );
});

test('importFromBackup restores wallet correctly', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  
  // Create and export wallet
  const wallet1 = new Wallet(config, storage);
  wallet1.providerFactory = { createProvider: () => new MockProvider() };
  await wallet1.initialize();

  const mnemonic = 'test test test test test test test test test test test junk';
  wallet1.importWallet(mnemonic, 'wallet-password', 0);
  const originalAddress = wallet1.wallet.address;
  wallet1.saveWallet('original');
  
  wallet1.exportWallet('original', 'backup.json');

  // Import on a fresh wallet instance with the same storage
  const wallet2 = new Wallet(config, storage);
  wallet2.providerFactory = { createProvider: () => new MockProvider() };
  await wallet2.initialize();

  const restoredName = wallet2.importFromBackup('backup.json', 'wallet-password');

  assert.ok(restoredName, 'import should return wallet name');
  
  // Load the restored wallet to verify it works
  wallet2.loadWallet(restoredName, 'wallet-password');
  assert.ok(wallet2.wallet, 'wallet should be restored');
  assert.equal(wallet2.wallet.address.toLowerCase(), originalAddress.toLowerCase(), 
    'restored wallet should have same address');
});

test('importFromBackup fails with wrong password', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  
  const wallet1 = new Wallet(config, storage);
  wallet1.providerFactory = { createProvider: () => new MockProvider() };
  await wallet1.initialize();

  const mnemonic = 'test test test test test test test test test test test junk';
  wallet1.importWallet(mnemonic, 'correct-password', 0);
  wallet1.saveWallet('original');
  
  wallet1.exportWallet('original', 'backup.json');

  // Try to import with wrong password
  const wallet2 = new Wallet(config, storage);
  wallet2.providerFactory = { createProvider: () => new MockProvider() };
  await wallet2.initialize();

  assert.throws(
    () => wallet2.importFromBackup('backup.json', 'wrong-password'),
    /Incorrect password|invalid/i
  );
});

test('importFromBackup fails with non-existent file', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  
  const wallet = new Wallet(config, storage);
  wallet.providerFactory = { createProvider: () => new MockProvider() };
  await wallet.initialize();

  assert.throws(
    () => wallet.importFromBackup('non-existent-backup.json', 'password'),
    /not found|unreadable/i
  );
});

test('export/import round-trip preserves wallet identity', async () => {
  const storage = new MemoryStorage();
  const config = {
    network: 'mainnet',
    networks: { mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' } }
  };
  class MockProvider { async getBlockNumber() { return 1; } }
  
  // Create original wallet
  const wallet1 = new Wallet(config, storage);
  wallet1.providerFactory = { createProvider: () => new MockProvider() };
  await wallet1.initialize();
  wallet1.createNewWallet('original-password');
  const originalAddress = wallet1.wallet.address;
  
  // Switch to account 1 and verify different address
  wallet1.switchAccount(1);
  const account1Address = wallet1.wallet.address;
  assert.notEqual(originalAddress, account1Address, 'different accounts should have different addresses');
  
  wallet1.saveWallet('original');
  
  // Export
  wallet1.exportWallet('original', 'backup.json');
  
  // Import to fresh wallet
  const wallet2 = new Wallet(config, storage);
  wallet2.providerFactory = { createProvider: () => new MockProvider() };
  await wallet2.initialize();
  const restoredName = wallet2.importFromBackup('backup.json', 'original-password');
  
  // Load and verify accounts derive same addresses
  wallet2.loadWallet(restoredName, 'original-password');
  const restored0 = wallet2.switchAccount(0);
  const restored1 = wallet2.switchAccount(1);
  
  assert.equal(restored0.address.toLowerCase(), originalAddress.toLowerCase(), 'account 0 should match');
  assert.equal(restored1.address.toLowerCase(), account1Address.toLowerCase(), 'account 1 should match');
});
