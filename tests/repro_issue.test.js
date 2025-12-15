
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../dist/wallet.js';
import { MemoryStorage } from '../dist/storage.js';
import { ethers } from 'ethers';

test('reproduce provider issue', async () => {
  const config = {
    network: 'base',
    networks: {
      base: {
        name: 'Base',
        rpcUrl: 'https://mainnet.base.org',
        chainId: 8453,
        // No type: 'evm' here, mimicking config.json
        nativeSymbol: 'ETH',
        nativeName: 'Base ETH'
      }
    }
  };

  const storage = new MemoryStorage();
  const wallet = new Wallet(config, storage);
  
  // Mock provider
  const mockProvider = {
    getBlockNumber: async () => 123,
    getFeeData: async () => ({ gasPrice: 100n }),
    estimateGas: async () => 21000n,
    getBalance: async () => 1000000000000000000n
  };

  wallet.providerFactory = {
    createProvider: () => mockProvider
  };

  // Initialize
  await wallet.initialize();

  // Access provider via getter
  const provider = wallet.provider;
  assert.ok(provider, 'Provider should be initialized');
  
  // Check if we can call methods on it
  const block = await provider.getBlockNumber();
  assert.equal(block, 123);

  // Check gas estimate logic simulation (app-service style)
  const feeData = await provider.getFeeData();
  assert.ok(feeData, 'Should get fee data');
});
