import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';

test('getPortfolioForNetwork uses the correct EVM network provider per call', async () => {
  class MockProvider {
    constructor(url, chainId) {
      this.url = url;
      this.chainId = chainId;
    }
    async getBlockNumber() {
      return 1;
    }
    async getBalance() {
      // Return different balances based on network.
      return this.chainId === 1 ? 1000000000000000000n : 500000000000000000n;
    }
  }

  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', { netA: [], netB: [] });
  storage.writeJSON('tokens-user.json', {});

  const config = {
    network: 'netA',
    networks: {
      netA: { type: 'evm', chainId: 1, rpcUrl: 'https://rpc.a', nativeSymbol: 'ETH', nativeName: 'Ether' },
      netB: { type: 'evm', chainId: 8453, rpcUrl: 'https://rpc.b', nativeSymbol: 'ETH', nativeName: 'Ether' },
    },
  };

  const providerFactory = {
    createProvider: (url, chainId) => new MockProvider(url, chainId),
  };

  const wallet = new Wallet(config, storage, providerFactory);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory });
  await svc.initialize();

  // Avoid full mnemonic generation; just stub an address for read-only portfolio calls.
  wallet.wallet = { address: '0x0000000000000000000000000000000000000002' };

  const a = await svc.getPortfolioForNetwork('netA');
  const b = await svc.getPortfolioForNetwork('netB');

  assert.equal(a[0].token.type, 'native');
  assert.equal(b[0].token.type, 'native');
  assert.equal(a[0].token.symbol, 'ETH');
  assert.equal(b[0].token.symbol, 'ETH');

  assert.equal(a[0].balance, '1.0');
  assert.equal(b[0].balance, '0.5');
});

