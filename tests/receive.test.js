/**
 * @file receive.test.js
 * @description Regression tests for WalletAppService.getAddressForChain — the
 *   service method that powers the extension's multi-chain Receive picker.
 *   Verifies that a mnemonic wallet can derive addresses for all five chain
 *   groups without switching the active network, and that a private-key wallet
 *   returns null for any chain that doesn't match its privateKeyType.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

function buildConfig(network = 'mainnet') {
  return {
    network,
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.example', nativeSymbol: 'ETH', nativeName: 'Ether' },
      'bitcoin-mainnet': { type: 'bitcoin', rpcUrl: 'https://btc.example', nativeSymbol: 'BTC', nativeName: 'Bitcoin', btcNetwork: 'mainnet' },
      'bitcoin-testnet': { type: 'bitcoin', rpcUrl: 'https://btc-tn.example', nativeSymbol: 'tBTC', nativeName: 'Bitcoin Testnet', btcNetwork: 'testnet' },
      'solana-mainnet': { type: 'solana', rpcUrl: 'https://sol.example', nativeSymbol: 'SOL', nativeName: 'Solana' },
      'xrp-mainnet': { type: 'xrp', rpcUrl: 'https://xrp.example', nativeSymbol: 'XRP', nativeName: 'XRP' },
      'ton-mainnet': { type: 'ton', rpcUrl: 'https://ton.example', nativeSymbol: 'TON', nativeName: 'TON', tonNetwork: 'mainnet' },
    },
  };
}

class MockProvider {
  async getBlockNumber() { return 1; }
}

function mockFactory() {
  return { createProvider: () => new MockProvider() };
}

async function buildService(network = 'mainnet') {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig(network);
  const wallet = new Wallet(config, storage, mockFactory());
  await wallet.initialize();
  wallet.importWallet(TEST_MNEMONIC, 'pw', 0);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: mockFactory() });
  await svc.initialize();
  return { svc, wallet, config };
}

test('getAddressForChain returns an address for every chain group without switching networks', async () => {
  const { svc } = await buildService('mainnet');

  const evm = svc.getAddressForChain('evm');
  const sol = svc.getAddressForChain('solana');
  const btc = svc.getAddressForChain('bitcoin');
  const xrp = svc.getAddressForChain('xrp');
  const ton = svc.getAddressForChain('ton');

  assert.ok(evm && evm.startsWith('0x'), `EVM address should be 0x-prefixed, got ${evm}`);
  assert.ok(sol && sol.length >= 32, `Solana address should be non-empty base58, got ${sol}`);
  assert.ok(btc && btc.startsWith('bc1'), `Bitcoin mainnet address should be bech32 bc1..., got ${btc}`);
  assert.ok(xrp && xrp.startsWith('r'), `XRP address should start with r, got ${xrp}`);
  assert.ok(ton && ton.length > 0, `TON address should be non-empty, got ${ton}`);

  const distinct = new Set([evm, sol, btc, xrp, ton]);
  assert.equal(distinct.size, 5, 'each chain should derive a distinct address');
});

test('getAddressForChain(bitcoin) returns a testnet address when active network is bitcoin-testnet', async () => {
  const { svc } = await buildService('bitcoin-testnet');
  const btc = svc.getAddressForChain('bitcoin');
  assert.ok(btc, 'should derive a Bitcoin address');
  // Native SegWit testnet prefix is `tb1`.
  assert.ok(btc.startsWith('tb1'), `expected testnet bech32 tb1..., got ${btc}`);
});

test('getAddressForChain does not change the active network', async () => {
  const { svc, config } = await buildService('mainnet');
  svc.getAddressForChain('solana');
  svc.getAddressForChain('bitcoin');
  svc.getAddressForChain('xrp');
  svc.getAddressForChain('ton');
  assert.equal(config.network, 'mainnet', 'active network should be unchanged');
});

test('getAddressForChain refuses chains that do not match a private-key import', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig('solana-mainnet');
  const wallet = new Wallet(config, storage, mockFactory());
  await wallet.initialize();

  // Simulate a Solana-only private-key wallet. The underlying key is irrelevant
  // to this test — we only need the importType/privateKeyType flags set so
  // the service method can enforce the chain guard.
  wallet.importType = 'privateKey';
  wallet.privateKeyType = 'solana';

  const svc = new WalletAppService(wallet, config, { storage, providerFactory: mockFactory() });
  await svc.initialize();

  assert.equal(svc.getAddressForChain('evm'), null, 'EVM should be refused for Solana-only wallet');
  assert.equal(svc.getAddressForChain('bitcoin'), null, 'Bitcoin should be refused for Solana-only wallet');
  assert.equal(svc.getAddressForChain('xrp'), null, 'XRP should be refused for Solana-only wallet');
  assert.equal(svc.getAddressForChain('ton'), null, 'TON should be refused for Solana-only wallet');
});
