/**
 * @file wallet-lock.test.js
 * @description Invariant tests for Wallet.lock().
 *
 * Locking must destroy every piece of decrypted key material held in memory
 * (mnemonic, raw private key, derived signer) — the extension service worker
 * relies on this from lockWallet(). Unlock must fully reconstruct state from
 * storage via loadWallet().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { MemoryStorage } from '../dist/storage.js';

const PASSWORD = 'correct horse battery staple';

const CONFIG = {
  network: 'mainnet',
  networks: {
    mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' }
  }
};

function freshConfig() {
  // Wallet mutates config.network; give each test its own copy.
  return JSON.parse(JSON.stringify(CONFIG));
}

test('lock() clears all decrypted and key-derivation state', () => {
  const wallet = new Wallet(freshConfig(), new MemoryStorage());
  wallet.createNewWallet(PASSWORD);

  // Sanity: sensitive state is populated after create.
  assert.ok(wallet.mnemonic);
  assert.ok(wallet.wallet);
  assert.ok(wallet.encryptedMnemonic);

  wallet.lock();

  assert.equal(wallet.mnemonic, null);
  assert.equal(wallet.privateKey, null);
  assert.equal(wallet.wallet, null);
  assert.equal(wallet.encryptedMnemonic, null);
  assert.equal(wallet.encryptedPrivateKey, null);
  assert.equal(wallet.salt, null);
  assert.equal(wallet.iv, null);
  assert.equal(wallet.authTag, null);
  assert.equal(wallet.privateKeyType, undefined);
  assert.equal(wallet.currentAccountIndex, 0);
});

test('unlock after lock() fully restores wallet state from storage', () => {
  const storage = new MemoryStorage();
  const wallet = new Wallet(freshConfig(), storage);

  const created = wallet.createNewWallet(PASSWORD);
  wallet.saveWallet('default');

  wallet.lock();
  assert.equal(wallet.mnemonic, null);

  const restored = wallet.loadWallet('default', PASSWORD);
  assert.ok(restored, 'wallet failed to reload after lock');
  assert.equal(restored.address, created.address);
  assert.equal(wallet.mnemonic, created.mnemonic);
  assert.ok(wallet.wallet, 'signer not reconstructed after unlock');
});

test('lock() clears raw private key state for private-key imports', () => {
  const wallet = new Wallet(freshConfig(), new MemoryStorage());
  // Well-known throwaway key (hardhat account #0) — never used on mainnet.
  const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  wallet.importFromPrivateKey(key, 'evm', PASSWORD);

  assert.ok(wallet.privateKey);
  assert.equal(wallet.privateKeyType, 'evm');

  wallet.lock();

  assert.equal(wallet.privateKey, null);
  assert.equal(wallet.wallet, null);
  assert.equal(wallet.privateKeyType, undefined);
  assert.equal(wallet.encryptedPrivateKey, null);
});

test('lock() on a never-loaded wallet is a safe no-op', () => {
  const wallet = new Wallet(freshConfig(), new MemoryStorage());
  assert.doesNotThrow(() => wallet.lock());
  assert.equal(wallet.mnemonic, null);
});
