/**
 * @fileoverview Tests for MobileCryptoAdapter primitives.
 *
 * Focuses on deterministic behavior and basic crypto invariants:
 * - PBKDF2 output is deterministic for same inputs
 * - AES-GCM encrypt/decrypt round-trip succeeds with correct auth tag
 */

import { describe, test, expect } from '@jest/globals';

import { MobileCryptoAdapter } from '../services/MobileCryptoAdapter';

describe('MobileCryptoAdapter', () => {
  test('pbkdf2Sync is deterministic for same inputs', () => {
    const crypto = new MobileCryptoAdapter();
    const salt = new Uint8Array(32).fill(7);

    const a = crypto.pbkdf2Sync('password', salt, 10, 32, 'sha256');
    const b = crypto.pbkdf2Sync('password', salt, 10, 32, 'sha256');

    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  test('AES-GCM encrypt/decrypt round-trip works with auth tag', () => {
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
});


