import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NodeCryptoAdapter,
  WebCryptoAdapter,
  createNodeCryptoAdapter,
  createWebCryptoAdapter
} from '../dist/crypto-adapter.js';

// ============================================================================
// NodeCryptoAdapter Tests
// ============================================================================

test('NodeCryptoAdapter randomBytes generates random data', () => {
  const adapter = new NodeCryptoAdapter();

  const bytes1 = adapter.randomBytes(32);
  const bytes2 = adapter.randomBytes(32);

  assert.equal(bytes1.length, 32);
  assert.equal(bytes2.length, 32);

  // Random bytes should be different
  assert.notDeepEqual(bytes1, bytes2);
});

test('NodeCryptoAdapter randomBytes generates different lengths', () => {
  const adapter = new NodeCryptoAdapter();

  const bytes16 = adapter.randomBytes(16);
  const bytes32 = adapter.randomBytes(32);
  const bytes64 = adapter.randomBytes(64);

  assert.equal(bytes16.length, 16);
  assert.equal(bytes32.length, 32);
  assert.equal(bytes64.length, 64);
});

test('NodeCryptoAdapter pbkdf2Sync derives consistent keys', () => {
  const adapter = new NodeCryptoAdapter();

  const password = 'test-password';
  const salt = adapter.randomBytes(32);
  const iterations = 100000;
  const keyLength = 32;

  const key1 = adapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
  const key2 = adapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');

  assert.equal(key1.length, keyLength);
  assert.deepEqual(key1, key2, 'same inputs should produce same key');
});

test('NodeCryptoAdapter pbkdf2Sync produces different keys for different passwords', () => {
  const adapter = new NodeCryptoAdapter();

  const salt = adapter.randomBytes(32);
  const iterations = 100000;
  const keyLength = 32;

  const key1 = adapter.pbkdf2Sync('password1', salt, iterations, keyLength, 'sha256');
  const key2 = adapter.pbkdf2Sync('password2', salt, iterations, keyLength, 'sha256');

  assert.notDeepEqual(key1, key2);
});

test('NodeCryptoAdapter pbkdf2Sync produces different keys for different salts', () => {
  const adapter = new NodeCryptoAdapter();

  const password = 'test-password';
  const salt1 = adapter.randomBytes(32);
  const salt2 = adapter.randomBytes(32);
  const iterations = 100000;
  const keyLength = 32;

  const key1 = adapter.pbkdf2Sync(password, salt1, iterations, keyLength, 'sha256');
  const key2 = adapter.pbkdf2Sync(password, salt2, iterations, keyLength, 'sha256');

  assert.notDeepEqual(key1, key2);
});

test('NodeCryptoAdapter encrypt/decrypt round-trip with AES-256-GCM', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = 'This is a secret message!';
  const key = adapter.randomBytes(32); // 256 bits
  const iv = adapter.randomBytes(16);  // 128 bits

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('NodeCryptoAdapter decrypt fails with wrong key', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = 'Secret data';
  const correctKey = adapter.randomBytes(32);
  const wrongKey = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt with correct key
  const cipher = adapter.createCipheriv('aes-256-gcm', correctKey, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Try to decrypt with wrong key
  const decipher = adapter.createDecipheriv('aes-256-gcm', wrongKey, iv);
  decipher.setAuthTag(authTag);

  assert.throws(() => {
    decipher.update(encrypted, 'hex', 'utf8');
    decipher.final('utf8');
  }, /Unsupported state or unable to authenticate data/);
});

test('NodeCryptoAdapter decrypt fails with tampered ciphertext', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = 'Secret data';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Tamper with ciphertext
  const tampered = 'ff' + encrypted.substring(2);

  // Try to decrypt tampered data
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  assert.throws(() => {
    decipher.update(tampered, 'hex', 'utf8');
    decipher.final('utf8');
  }, /Unsupported state or unable to authenticate data/);
});

test('NodeCryptoAdapter handles empty plaintext', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = '';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('NodeCryptoAdapter handles large plaintext', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = 'A'.repeat(10000);
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  assert.equal(decrypted, plaintext);
  assert.equal(decrypted.length, 10000);
});

// ============================================================================
// WebCryptoAdapter Tests
// ============================================================================

test('WebCryptoAdapter randomBytes generates random data', () => {
  const adapter = new WebCryptoAdapter();

  const bytes1 = adapter.randomBytes(32);
  const bytes2 = adapter.randomBytes(32);

  assert.equal(bytes1.length, 32);
  assert.equal(bytes2.length, 32);

  // Random bytes should be different
  assert.ok(bytes1 instanceof Uint8Array);
  assert.ok(bytes2 instanceof Uint8Array);
  assert.notDeepEqual(bytes1, bytes2);
});

test('WebCryptoAdapter randomBytes generates different lengths', () => {
  const adapter = new WebCryptoAdapter();

  const bytes16 = adapter.randomBytes(16);
  const bytes32 = adapter.randomBytes(32);
  const bytes64 = adapter.randomBytes(64);

  assert.equal(bytes16.length, 16);
  assert.equal(bytes32.length, 32);
  assert.equal(bytes64.length, 64);
});

test('WebCryptoAdapter pbkdf2Sync derives consistent keys', () => {
  const adapter = new WebCryptoAdapter();

  const password = 'test-password';
  const salt = adapter.randomBytes(32);
  const iterations = 100000;
  const keyLength = 32;

  const key1 = adapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
  const key2 = adapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');

  assert.equal(key1.length, keyLength);
  assert.deepEqual(key1, key2, 'same inputs should produce same key');
});

test('WebCryptoAdapter pbkdf2Sync only supports sha256', () => {
  const adapter = new WebCryptoAdapter();

  const password = 'test-password';
  const salt = adapter.randomBytes(32);

  assert.throws(() => {
    adapter.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
  }, /WebCryptoAdapter only supports PBKDF2-HMAC-SHA256/);
});

test('WebCryptoAdapter pbkdf2Sync accepts Buffer as salt', () => {
  const adapter = new WebCryptoAdapter();

  const password = 'test-password';
  const salt = Buffer.from(adapter.randomBytes(32));
  const iterations = 100000;
  const keyLength = 32;

  const key = adapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');

  assert.equal(key.length, keyLength);
  assert.ok(key instanceof Uint8Array);
});

test('WebCryptoAdapter encrypt/decrypt round-trip with AES-256-GCM', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'This is a secret message!';
  const key = adapter.randomBytes(32); // 256 bits
  const iv = adapter.randomBytes(16);  // 128 bits

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted, 'hex', 'utf8');
  const decrypted = decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('WebCryptoAdapter decrypt fails with wrong key', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Secret data';
  const correctKey = adapter.randomBytes(32);
  const wrongKey = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt with correct key
  const cipher = adapter.createCipheriv('aes-256-gcm', correctKey, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Try to decrypt with wrong key
  const decipher = adapter.createDecipheriv('aes-256-gcm', wrongKey, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted, 'hex', 'utf8');

  assert.throws(() => {
    decipher.final('utf8');
  }, /data integrity check failed/);
});

test('WebCryptoAdapter decrypt fails with tampered ciphertext', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Secret data';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Tamper with ciphertext
  const tampered = 'ff' + encrypted.substring(2);

  // Try to decrypt tampered data
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(tampered, 'hex', 'utf8');

  assert.throws(() => {
    decipher.final('utf8');
  }, /data integrity check failed/);
});

test('WebCryptoAdapter throws if authTag not set before decrypt', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Secret data';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');

  // Try to decrypt without setting authTag
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.update(encrypted, 'hex', 'utf8');

  assert.throws(() => {
    decipher.final('utf8');
  }, /Auth tag not set/);
});

test('WebCryptoAdapter throws if getAuthTag called before final', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Secret data';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');

  assert.throws(() => {
    cipher.getAuthTag();
  }, /Auth tag not available/);
});

test('WebCryptoAdapter handles empty plaintext', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = '';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted, 'hex', 'utf8');
  const decrypted = decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('WebCryptoAdapter handles large plaintext', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'A'.repeat(10000);
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted, 'hex', 'utf8');
  const decrypted = decipher.final('utf8');

  assert.equal(decrypted, plaintext);
  assert.equal(decrypted.length, 10000);
});

test('WebCryptoAdapter handles unicode characters', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Hello 世界 🌍 café';
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted, 'hex', 'utf8');
  const decrypted = decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('WebCryptoAdapter accepts Buffer inputs', () => {
  const adapter = new WebCryptoAdapter();

  const plaintext = 'Test message';
  const key = Buffer.from(adapter.randomBytes(32));
  const iv = Buffer.from(adapter.randomBytes(16));

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(plaintext, 'utf8', 'hex');
  const encrypted = cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(authTag));
  decipher.update(encrypted, 'hex', 'utf8');
  const decrypted = decipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

// ============================================================================
// Cross-Adapter Compatibility Tests
// ============================================================================

test('NodeCryptoAdapter and WebCryptoAdapter produce different random bytes', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  const nodeBytes = nodeAdapter.randomBytes(32);
  const webBytes = webAdapter.randomBytes(32);

  // Both should be 32 bytes
  assert.equal(nodeBytes.length, 32);
  assert.equal(webBytes.length, 32);

  // But should be different (statistically extremely unlikely to be equal)
  assert.notDeepEqual(nodeBytes, webBytes);
});

test('NodeCryptoAdapter and WebCryptoAdapter derive same keys from same inputs', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  const password = 'test-password';
  const salt = nodeAdapter.randomBytes(32);
  const iterations = 10000; // Use lower iterations for faster test
  const keyLength = 32;

  const nodeKey = nodeAdapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
  const webKey = webAdapter.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');

  // Convert to Buffer for comparison
  const nodeKeyBuffer = Buffer.from(nodeKey);
  const webKeyBuffer = Buffer.from(webKey);

  assert.deepEqual(nodeKeyBuffer, webKeyBuffer, 'both adapters should derive identical keys');
});

test('Data encrypted with NodeCryptoAdapter can be decrypted with WebCryptoAdapter', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  const plaintext = 'Cross-adapter test message';
  const key = nodeAdapter.randomBytes(32);
  const iv = nodeAdapter.randomBytes(16);

  // Encrypt with Node adapter
  const nodeCipher = nodeAdapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = nodeCipher.update(plaintext, 'utf8', 'hex');
  encrypted += nodeCipher.final('hex');
  const authTag = nodeCipher.getAuthTag();

  // Decrypt with Web adapter
  const webDecipher = webAdapter.createDecipheriv('aes-256-gcm', key, iv);
  webDecipher.setAuthTag(authTag);
  webDecipher.update(encrypted, 'hex', 'utf8');
  const decrypted = webDecipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('Data encrypted with WebCryptoAdapter can be decrypted with NodeCryptoAdapter', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  const plaintext = 'Cross-adapter test message';
  const key = webAdapter.randomBytes(32);
  const iv = webAdapter.randomBytes(16);

  // Encrypt with Web adapter
  const webCipher = webAdapter.createCipheriv('aes-256-gcm', key, iv);
  webCipher.update(plaintext, 'utf8', 'hex');
  const encrypted = webCipher.final('hex');
  const authTag = webCipher.getAuthTag();

  // Decrypt with Node adapter
  const nodeDecipher = nodeAdapter.createDecipheriv('aes-256-gcm', key, iv);
  nodeDecipher.setAuthTag(authTag);
  let decrypted = nodeDecipher.update(encrypted, 'hex', 'utf8');
  decrypted += nodeDecipher.final('utf8');

  assert.equal(decrypted, plaintext);
});

test('Both adapters handle mnemonic-sized data identically', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  // 12-word mnemonic
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const key = nodeAdapter.randomBytes(32);
  const iv = nodeAdapter.randomBytes(16);

  // Encrypt with both adapters
  const nodeCipher = nodeAdapter.createCipheriv('aes-256-gcm', key, iv);
  let nodeEncrypted = nodeCipher.update(mnemonic, 'utf8', 'hex');
  nodeEncrypted += nodeCipher.final('hex');
  const nodeAuthTag = nodeCipher.getAuthTag();

  const webCipher = webAdapter.createCipheriv('aes-256-gcm', key, iv);
  webCipher.update(mnemonic, 'utf8', 'hex');
  const webEncrypted = webCipher.final('hex');
  const webAuthTag = webCipher.getAuthTag();

  // Both should produce identical output
  assert.equal(nodeEncrypted, webEncrypted);
  assert.deepEqual(Buffer.from(nodeAuthTag), Buffer.from(webAuthTag));
});

// ============================================================================
// Factory Function Tests
// ============================================================================

test('createNodeCryptoAdapter returns NodeCryptoAdapter instance', () => {
  const adapter = createNodeCryptoAdapter();

  assert.ok(adapter instanceof NodeCryptoAdapter);

  // Verify it works
  const bytes = adapter.randomBytes(32);
  assert.equal(bytes.length, 32);
});

test('createWebCryptoAdapter returns WebCryptoAdapter instance', () => {
  const adapter = createWebCryptoAdapter();

  assert.ok(adapter instanceof WebCryptoAdapter);

  // Verify it works
  const bytes = adapter.randomBytes(32);
  assert.equal(bytes.length, 32);
});

test('createWebCryptoAdapter throws if WebCrypto not available', () => {
  // Temporarily hide crypto
  const originalCrypto = global.crypto;
  delete global.crypto;

  try {
    assert.throws(() => {
      createWebCryptoAdapter();
    }, /WebCrypto not available/);
  } finally {
    // Restore crypto
    global.crypto = originalCrypto;
  }
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

test('NodeCryptoAdapter handles binary data', () => {
  const adapter = new NodeCryptoAdapter();

  const binaryData = Buffer.from([0x00, 0x01, 0xFF, 0xAB, 0xCD, 0xEF]);
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(binaryData);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  assert.deepEqual(decrypted, binaryData);
});

test('WebCryptoAdapter handles binary data', () => {
  const adapter = new WebCryptoAdapter();

  const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0xAB, 0xCD, 0xEF]);
  const key = adapter.randomBytes(32);
  const iv = adapter.randomBytes(16);

  // Encrypt
  const cipher = adapter.createCipheriv('aes-256-gcm', key, iv);
  cipher.update(binaryData);
  const encrypted = cipher.final();
  const authTag = cipher.getAuthTag();

  // Decrypt
  const decipher = adapter.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  decipher.update(encrypted);
  const decrypted = decipher.final();

  assert.deepEqual(decrypted, binaryData);
});

test('NodeCryptoAdapter and WebCryptoAdapter produce different IV each time', () => {
  const nodeAdapter = new NodeCryptoAdapter();
  const webAdapter = new WebCryptoAdapter();

  const iv1 = nodeAdapter.randomBytes(16);
  const iv2 = nodeAdapter.randomBytes(16);
  const iv3 = webAdapter.randomBytes(16);
  const iv4 = webAdapter.randomBytes(16);

  assert.notDeepEqual(iv1, iv2);
  assert.notDeepEqual(iv3, iv4);
  assert.notDeepEqual(Buffer.from(iv1), Buffer.from(iv3));
});

test('Different IVs produce different ciphertexts for same plaintext', () => {
  const adapter = new NodeCryptoAdapter();

  const plaintext = 'Same message';
  const key = adapter.randomBytes(32);
  const iv1 = adapter.randomBytes(16);
  const iv2 = adapter.randomBytes(16);

  // Encrypt with first IV
  const cipher1 = adapter.createCipheriv('aes-256-gcm', key, iv1);
  let encrypted1 = cipher1.update(plaintext, 'utf8', 'hex');
  encrypted1 += cipher1.final('hex');

  // Encrypt with second IV
  const cipher2 = adapter.createCipheriv('aes-256-gcm', key, iv2);
  let encrypted2 = cipher2.update(plaintext, 'utf8', 'hex');
  encrypted2 += cipher2.final('hex');

  // Should produce different ciphertexts
  assert.notEqual(encrypted1, encrypted2);
});
