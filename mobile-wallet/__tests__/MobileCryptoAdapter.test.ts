/**
 * @fileoverview Tests for MobileCryptoAdapter primitives.
 *
 * Tests cover:
 * - PBKDF2 sync and async key derivation
 * - AES-GCM encrypt/decrypt round-trip
 * - Deterministic behavior for same inputs
 *
 * Note: In Jest/Node.js, react-native-quick-crypto is not available,
 * so pbkdf2Async falls back to @noble/hashes.
 */

import { describe, test, expect } from '@jest/globals';

import { MobileCryptoAdapter } from '../services/MobileCryptoAdapter';

describe('MobileCryptoAdapter', () => {
  describe('PBKDF2', () => {
    test('pbkdf2Sync is deterministic for same inputs', () => {
      const crypto = new MobileCryptoAdapter();
      const salt = new Uint8Array(32).fill(7);

      const a = crypto.pbkdf2Sync('password', salt, 10, 32, 'sha256');
      const b = crypto.pbkdf2Sync('password', salt, 10, 32, 'sha256');

      expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });

    test('pbkdf2Async is deterministic for same inputs', async () => {
      const crypto = new MobileCryptoAdapter();
      const salt = new Uint8Array(32).fill(7);

      const a = await crypto.pbkdf2Async('password', salt, 10, 32, 'sha256');
      const b = await crypto.pbkdf2Async('password', salt, 10, 32, 'sha256');

      expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });

    test('pbkdf2Sync and pbkdf2Async produce same results', async () => {
      const crypto = new MobileCryptoAdapter();
      const salt = new Uint8Array(32).fill(42);
      const password = 'test-password';
      const iterations = 1000;

      const syncResult = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
      const asyncResult = await crypto.pbkdf2Async(password, salt, iterations, 32, 'sha256');

      expect(Buffer.from(syncResult).toString('hex')).toBe(Buffer.from(asyncResult).toString('hex'));
    });

    test('pbkdf2Sync performance with 100000 iterations', () => {
      const crypto = new MobileCryptoAdapter();
      const salt = new Uint8Array(32).fill(7);
      const password = 'testpass9';

      const startTime = Date.now();
      const result = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const elapsedMs = Date.now() - startTime;

      console.log(`[PERF] pbkdf2Sync 100k iterations: ${elapsedMs}ms`);

      expect(result.length).toBe(32);
      // Should complete in reasonable time with @noble/hashes
      expect(elapsedMs).toBeLessThan(5000);
    });

    test('pbkdf2Async performance with 100000 iterations', async () => {
      const crypto = new MobileCryptoAdapter();
      const salt = new Uint8Array(32).fill(7);
      const password = 'testpass9';

      const startTime = Date.now();
      const result = await crypto.pbkdf2Async(password, salt, 100000, 32, 'sha256');
      const elapsedMs = Date.now() - startTime;

      console.log(`[PERF] pbkdf2Async 100k iterations: ${elapsedMs}ms`);

      expect(result.length).toBe(32);
      // In Jest, falls back to @noble/hashes (no native crypto)
      // In React Native with quick-crypto, this would be < 100ms
      expect(elapsedMs).toBeLessThan(5000);
    });
  });

  describe('AES-GCM', () => {
    test('encrypt/decrypt round-trip works with auth tag', () => {
      const crypto = new MobileCryptoAdapter();
      const key = new Uint8Array(32).fill(1);
      const iv = new Uint8Array(16).fill(2);
      const plaintext = 'hello world';

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.update(plaintext, 'utf8');
      const ciphertextHex = cipher.final('hex');
      const authTag = cipher.getAuthTag();

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      decipher.update(ciphertextHex, 'hex', 'utf8');
      const decrypted = decipher.final('utf8');

      expect(decrypted).toBe(plaintext);
    });

    test('decryption fails with wrong auth tag', () => {
      const crypto = new MobileCryptoAdapter();
      const key = new Uint8Array(32).fill(1);
      const iv = new Uint8Array(16).fill(2);
      const plaintext = 'secret data';

      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.update(plaintext, 'utf8');
      const ciphertextHex = cipher.final('hex');

      // Try to decrypt with wrong auth tag
      const wrongTag = new Uint8Array(16).fill(0);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(wrongTag);
      decipher.update(ciphertextHex, 'hex', 'utf8');

      expect(() => decipher.final('utf8')).toThrow();
    });

    // Cross-implementation regression test for the Phase 3 cipher swap.
    //
    // On device, `MobileCryptoAdapter` uses `react-native-quick-crypto` —
    // a JSI binding over OpenSSL, so its AES-GCM is functionally identical
    // to Node's built-in `crypto.createCipheriv('aes-256-gcm', ...)`.
    // Under Jest there's no native module, so the adapter falls back to the
    // pure-JS `asmcrypto.js` wrapper.
    //
    // To prove the swap is byte-compatible (no re-encryption migration
    // needed for existing wallets), we encrypt with Node's cipher — the
    // exact API quick-crypto exposes on device — and decrypt through the
    // adapter's fallback wrapper, and vice versa. Round-trip success means
    // the two implementations agree on the wire format.
    test('asmcrypto wrapper round-trips with Node createCipheriv', () => {
      // Use require() so the test file stays runnable even if a future
      // env removes the global crypto symbol.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = require('crypto');
      const adapter = new MobileCryptoAdapter();

      const key = Buffer.from(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'hex',
      );
      const iv = Buffer.from('a1b2c3d4e5f6a7b8c9d0e1f2', 'hex'); // 12-byte GCM IV
      const plaintext = JSON.stringify({
        msg: 'fixture for the cipher swap',
        n: 42,
        nested: { a: [1, 2, 3] },
      });

      // 1. Encrypt with Node (the API quick-crypto mirrors on device),
      //    decrypt with the adapter's fallback (the path used in Jest /
      //    Expo Go).
      {
        const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([
          cipher.update(plaintext, 'utf8'),
          cipher.final(),
        ]);
        const tag: Buffer = cipher.getAuthTag();

        const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        decipher.update(ciphertext.toString('hex'), 'hex', 'utf8');
        const out = decipher.final('utf8');
        expect(out).toBe(plaintext);
      }

      // 2. The reverse: encrypt with the adapter (fallback path),
      //    decrypt with Node.
      {
        const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
        cipher.update(plaintext, 'utf8');
        const ciphertextHex = cipher.final('hex') as string;
        const tag = cipher.getAuthTag();

        const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(Buffer.from(tag));
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(ciphertextHex, 'hex')),
          decipher.final(),
        ]).toString('utf8');
        expect(decrypted).toBe(plaintext);
      }
    });
  });

  describe('randomBytes', () => {
    test('generates bytes of requested length', () => {
      const crypto = new MobileCryptoAdapter();

      const bytes16 = crypto.randomBytes(16);
      const bytes32 = crypto.randomBytes(32);

      expect(bytes16.length).toBe(16);
      expect(bytes32.length).toBe(32);
    });

    test('generates different values each call', () => {
      const crypto = new MobileCryptoAdapter();

      const a = crypto.randomBytes(32);
      const b = crypto.randomBytes(32);

      expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
    });
  });
});
