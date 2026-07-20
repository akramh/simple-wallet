/**
 * @file wallet-migration.test.js
 * @description Regression tests for the plaintext→encrypted wallet migration.
 *
 * Guards two historical bugs in the CLI migration (src/index.ts):
 * 1. The migrated record stored only {encryptedMnemonic, salt}, dropping the
 *    IV and GCM auth tag — making every migrated wallet permanently
 *    undecryptable.
 * 2. The replacement file was written non-atomically with default (0644)
 *    permissions, alongside a plaintext wallets.json.backup copy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  migratePlaintextWallets,
  writeWalletsFileAtomic,
  decryptMnemonic,
  generateMnemonic
} from '../dist/crypto-utils.js';
import { Wallet } from '../dist/wallet.js';
import { MemoryStorage } from '../dist/storage.js';

const PASSWORD = 'correct horse battery staple';

const CONFIG = {
  network: 'mainnet',
  networks: {
    mainnet: { chainId: 1, rpcUrl: 'https://rpc.example' }
  }
};

// ============================================================================
// migratePlaintextWallets
// ============================================================================

test('migration stores all four decryption components and round-trips', () => {
  const mnemonic = generateMnemonic(12);
  const input = {
    default: { mnemonic, currentAccountIndex: 0 }
  };

  const { wallets, migratedCount } = migratePlaintextWallets(input, PASSWORD);

  assert.equal(migratedCount, 1);
  const record = wallets.default;

  // Regression: the old migration omitted iv and authTag entirely.
  assert.ok(record.encryptedMnemonic, 'encryptedMnemonic missing');
  assert.ok(record.salt, 'salt missing');
  assert.ok(record.iv, 'iv missing — record would be undecryptable');
  assert.ok(record.authTag, 'authTag missing — record would be undecryptable');

  // Plaintext must be gone.
  assert.equal(record.mnemonic, undefined);

  // The stored components must actually decrypt back to the original.
  const decrypted = decryptMnemonic(
    record.encryptedMnemonic,
    PASSWORD,
    record.salt,
    record.iv,
    record.authTag
  );
  assert.equal(decrypted, mnemonic);
});

test('migrated record is loadable by Wallet.loadWallet', () => {
  const mnemonic = generateMnemonic(12);
  const { wallets } = migratePlaintextWallets(
    { default: { mnemonic, currentAccountIndex: 0 } },
    PASSWORD
  );

  const storage = new MemoryStorage();
  storage.writeJSON('wallets.json', wallets);

  const wallet = new Wallet(CONFIG, storage);
  const info = wallet.loadWallet('default', PASSWORD);

  assert.ok(info, 'migrated wallet failed to load');
  assert.equal(info.mnemonic, mnemonic);
});

test('migration leaves already-encrypted wallets untouched and preserves metadata', () => {
  const mnemonic = generateMnemonic(12);
  const alreadyEncrypted = {
    encryptedMnemonic: 'deadbeef',
    salt: 'aa',
    iv: 'bb',
    authTag: 'cc'
  };
  const input = {
    old: { mnemonic, currentAccountIndex: 2, label: 'legacy' },
    done: alreadyEncrypted
  };

  const { wallets, migratedCount } = migratePlaintextWallets(input, PASSWORD);

  assert.equal(migratedCount, 1);
  // Untouched record passes through by reference-equal content.
  assert.deepEqual(wallets.done, alreadyEncrypted);
  // Non-secret metadata survives migration.
  assert.equal(wallets.old.currentAccountIndex, 2);
  assert.equal(wallets.old.label, 'legacy');
  // Input object is not mutated (plaintext still present in caller's copy
  // until the caller replaces the file).
  assert.equal(input.old.mnemonic, mnemonic);
});

test('migration of empty wallets record is a no-op', () => {
  const { wallets, migratedCount } = migratePlaintextWallets({}, PASSWORD);
  assert.equal(migratedCount, 0);
  assert.deepEqual(wallets, {});
});

// ============================================================================
// writeWalletsFileAtomic
// ============================================================================

test('writeWalletsFileAtomic writes 0600, replaces content, leaves no temp file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-migration-test-'));
  const walletsPath = path.join(tempDir, 'wallets.json');

  try {
    // Pre-existing world-readable plaintext file, as the legacy migration left it.
    fs.writeFileSync(walletsPath, JSON.stringify({ default: { mnemonic: 'leak me' } }), {
      mode: 0o644
    });

    writeWalletsFileAtomic(walletsPath, { default: { encryptedMnemonic: 'abc' } });

    const written = JSON.parse(fs.readFileSync(walletsPath, 'utf8'));
    assert.equal(written.default.encryptedMnemonic, 'abc');
    assert.equal(written.default.mnemonic, undefined);

    // Owner-only permissions even though the original file was 0644.
    const mode = fs.statSync(walletsPath).mode & 0o777;
    assert.equal(mode, 0o600);

    // No stray temp or backup files.
    assert.equal(fs.existsSync(`${walletsPath}.tmp`), false);
    assert.equal(fs.existsSync(`${walletsPath}.backup`), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
