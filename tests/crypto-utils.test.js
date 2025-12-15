import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  validatePasswordLength,
  generateSalt,
  deriveKey,
  encryptData,
  decryptData,
  encryptMnemonic,
  decryptMnemonic,
  validateMnemonic,
  generateMnemonic,
  safeWriteJSON,
  safeReadJSON
} from '../dist/crypto-utils.js';

// ============================================================================
// Password Validation Tests
// ============================================================================

test('validatePasswordLength accepts passwords >= 8 characters', () => {
  assert.equal(validatePasswordLength('12345678'), true);
  assert.equal(validatePasswordLength('longerpassword'), true);
  assert.equal(validatePasswordLength('a'.repeat(100)), true);
});

test('validatePasswordLength rejects passwords < 8 characters', () => {
  assert.equal(validatePasswordLength('1234567'), false);
  assert.equal(validatePasswordLength('short'), false);
  assert.equal(validatePasswordLength(''), false);
});

test('validatePasswordLength handles edge cases', () => {
  assert.equal(validatePasswordLength(null), false);
  assert.equal(validatePasswordLength(undefined), false);
  assert.equal(validatePasswordLength(12345678), false); // number, not string
  assert.equal(validatePasswordLength({}), false);
});

test('validatePasswordLength accepts unicode passwords', () => {
  assert.equal(validatePasswordLength('密码密码密码密码'), true); // 8 Chinese characters
  assert.equal(validatePasswordLength('🔐🔐🔐🔐🔐🔐🔐🔐'), true); // 8 emoji (may vary by encoding)
});

// ============================================================================
// Salt Generation Tests
// ============================================================================

test('generateSalt produces unique salts', () => {
  const salt1 = generateSalt();
  const salt2 = generateSalt();
  const salt3 = generateSalt();

  assert.notEqual(salt1, salt2);
  assert.notEqual(salt2, salt3);
  assert.notEqual(salt1, salt3);
});

test('generateSalt produces valid hex strings', () => {
  const salt = generateSalt();

  // Should be 64 hex characters (32 bytes * 2)
  assert.equal(salt.length, 64);
  assert.match(salt, /^[0-9a-f]{64}$/);
});

// ============================================================================
// Key Derivation Tests
// ============================================================================

test('deriveKey produces consistent output for same inputs', () => {
  const password = 'testpassword';
  const salt = generateSalt();

  const key1 = deriveKey(password, salt);
  const key2 = deriveKey(password, salt);

  assert.deepEqual(key1, key2);
});

test('deriveKey produces different output for different salts', () => {
  const password = 'testpassword';
  const salt1 = generateSalt();
  const salt2 = generateSalt();

  const key1 = deriveKey(password, salt1);
  const key2 = deriveKey(password, salt2);

  assert.notDeepEqual(key1, key2);
});

test('deriveKey produces different output for different passwords', () => {
  const salt = generateSalt();
  const key1 = deriveKey('password1', salt);
  const key2 = deriveKey('password2', salt);

  assert.notDeepEqual(key1, key2);
});

test('deriveKey produces 32-byte key (256 bits)', () => {
  const key = deriveKey('password', generateSalt());
  assert.equal(key.length, 32);
});

// ============================================================================
// Encryption/Decryption Round-Trip Tests
// ============================================================================

test('encryptData/decryptData round-trip preserves plaintext', () => {
  const plaintext = 'This is a secret message!';
  const password = 'strongpassword';

  const { encrypted, salt } = encryptData(plaintext, password);
  const decrypted = decryptData(encrypted, password, salt);

  assert.equal(decrypted, plaintext);
});

test('encryptData produces different ciphertext each time', () => {
  const plaintext = 'Same message';
  const password = 'samepassword';

  const result1 = encryptData(plaintext, password);
  const result2 = encryptData(plaintext, password);

  // Each encryption should use unique salt and IV
  assert.notEqual(result1.encrypted, result2.encrypted);
  assert.notEqual(result1.salt, result2.salt);
});

test('decryptData throws on wrong password', () => {
  const plaintext = 'Secret data';
  const { encrypted, salt } = encryptData(plaintext, 'correctpassword');

  assert.throws(
    () => decryptData(encrypted, 'wrongpassword', salt),
    /Unsupported state|bad decrypt|authentication/i
  );
});

test('decryptData throws on tampered ciphertext', () => {
  const plaintext = 'Secret data';
  const { encrypted, salt } = encryptData(plaintext, 'password');

  // Tamper with the ciphertext portion
  const parts = encrypted.split(':');
  parts[2] = 'x' + parts[2].slice(1); // corrupt the ciphertext
  const tampered = parts.join(':');

  assert.throws(
    () => decryptData(tampered, 'password', salt),
    /Unsupported state|bad decrypt|authentication/i
  );
});

test('decryptData throws on tampered auth tag', () => {
  const plaintext = 'Secret data';
  const { encrypted, salt } = encryptData(plaintext, 'password');

  const parts = encrypted.split(':');
  parts[1] = 'x' + parts[1].slice(1); // corrupt the auth tag
  const tampered = parts.join(':');

  assert.throws(
    () => decryptData(tampered, 'password', salt),
    /Unsupported state|bad decrypt|authentication/i
  );
});

test('decryptData throws on invalid format', () => {
  const salt = generateSalt();

  assert.throws(
    () => decryptData('not:valid:format:extra', 'password', salt),
    /Invalid encrypted data format/
  );

  assert.throws(
    () => decryptData('onlyonepart', 'password', salt),
    /Invalid encrypted data format/
  );
});

// ============================================================================
// Mnemonic Encryption Tests
// ============================================================================

test('encryptMnemonic/decryptMnemonic round-trip preserves mnemonic', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const password = 'securepassword';

  const { encrypted, salt, iv, authTag } = encryptMnemonic(mnemonic, password);
  const decrypted = decryptMnemonic(encrypted, password, salt, iv, authTag);

  assert.equal(decrypted, mnemonic);
});

test('encryptMnemonic returns all required components', () => {
  const mnemonic = 'test test test test test test test test test test test junk';
  const password = 'password';

  const result = encryptMnemonic(mnemonic, password);

  assert.ok(result.encrypted, 'should have encrypted');
  assert.ok(result.salt, 'should have salt');
  assert.ok(result.iv, 'should have iv');
  assert.ok(result.authTag, 'should have authTag');

  // All should be hex strings
  assert.match(result.salt, /^[0-9a-f]+$/);
  assert.match(result.iv, /^[0-9a-f]+$/);
  assert.match(result.authTag, /^[0-9a-f]+$/);
});

test('decryptMnemonic throws on wrong password', () => {
  const mnemonic = 'test test test test test test test test test test test junk';
  const { encrypted, salt, iv, authTag } = encryptMnemonic(mnemonic, 'correctpw');

  assert.throws(
    () => decryptMnemonic(encrypted, 'wrongpw', salt, iv, authTag),
    /Unsupported state|bad decrypt|authentication/i
  );
});

// ============================================================================
// Mnemonic Validation Tests
// ============================================================================

test('validateMnemonic accepts valid 12-word mnemonic', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  assert.equal(validateMnemonic(mnemonic), true);
});

test('validateMnemonic accepts valid 24-word mnemonic', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  assert.equal(validateMnemonic(mnemonic), true);
});

test('validateMnemonic rejects invalid word counts', () => {
  assert.equal(validateMnemonic('one two three'), false);
  assert.equal(validateMnemonic('one two three four five six seven eight nine ten eleven'), false); // 11 words
  assert.equal(validateMnemonic('one two three four five six seven eight nine ten eleven twelve thirteen'), false); // 13 words
});

test('validateMnemonic rejects empty and invalid input', () => {
  assert.equal(validateMnemonic(''), false);
  assert.equal(validateMnemonic(null), false);
  assert.equal(validateMnemonic(undefined), false);
  assert.equal(validateMnemonic('   '), false);
});

test('validateMnemonic handles extra whitespace', () => {
  const mnemonic = '  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  about  ';
  assert.equal(validateMnemonic(mnemonic), true);
});

// ============================================================================
// Mnemonic Generation Tests
// ============================================================================

test('generateMnemonic generates 24-word mnemonic by default', () => {
  const mnemonic = generateMnemonic();
  const words = mnemonic.split(' ');

  assert.equal(words.length, 24, 'should generate 24 words by default');
  assert.equal(validateMnemonic(mnemonic), true, 'generated mnemonic should be valid');
});

test('generateMnemonic generates 12-word mnemonic when specified', () => {
  const mnemonic = generateMnemonic(12);
  const words = mnemonic.split(' ');

  assert.equal(words.length, 12, 'should generate 12 words when specified');
  assert.equal(validateMnemonic(mnemonic), true, 'generated mnemonic should be valid');
});

test('generateMnemonic generates 24-word mnemonic when specified', () => {
  const mnemonic = generateMnemonic(24);
  const words = mnemonic.split(' ');

  assert.equal(words.length, 24, 'should generate 24 words when specified');
  assert.equal(validateMnemonic(mnemonic), true, 'generated mnemonic should be valid');
});

test('generateMnemonic generates unique mnemonics each time', () => {
  const mnemonic1 = generateMnemonic();
  const mnemonic2 = generateMnemonic();
  const mnemonic3 = generateMnemonic();

  assert.notEqual(mnemonic1, mnemonic2, 'mnemonics should be unique');
  assert.notEqual(mnemonic2, mnemonic3, 'mnemonics should be unique');
  assert.notEqual(mnemonic1, mnemonic3, 'mnemonics should be unique');
});

test('generateMnemonic produces mnemonics that can be encrypted and decrypted', () => {
  const mnemonic = generateMnemonic(24);
  const password = 'testpassword';

  const { encrypted, salt, iv, authTag } = encryptMnemonic(mnemonic, password);
  const decrypted = decryptMnemonic(encrypted, password, salt, iv, authTag);

  assert.equal(decrypted, mnemonic, 'decrypted should match original');
});

// ============================================================================
// Safe File I/O Tests
// ============================================================================

test('safeWriteJSON/safeReadJSON round-trip preserves data', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
  const testFile = path.join(tempDir, 'test.json');

  try {
    const data = { key: 'value', nested: { arr: [1, 2, 3] } };

    safeWriteJSON(testFile, data);
    const result = safeReadJSON(testFile);

    assert.deepEqual(result, data);
  } finally {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeWriteJSON creates backup file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
  const testFile = path.join(tempDir, 'test.json');
  const backupFile = `${testFile}.backup`;

  try {
    // Write initial data
    safeWriteJSON(testFile, { version: 1 });

    // Write updated data (should create backup)
    safeWriteJSON(testFile, { version: 2 });

    assert.ok(fs.existsSync(backupFile), 'backup file should exist');

    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    assert.equal(backup.version, 1, 'backup should contain old data');

    const current = safeReadJSON(testFile);
    assert.equal(current.version, 2, 'current file should have new data');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeReadJSON returns empty object for non-existent file', () => {
  const result = safeReadJSON('/non/existent/path.json');
  assert.deepEqual(result, {});
});

test('safeReadJSON recovers from backup if main file is missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
  const testFile = path.join(tempDir, 'test.json');
  const backupFile = `${testFile}.backup`;

  try {
    // Create only backup file
    fs.writeFileSync(backupFile, JSON.stringify({ recovered: true }));

    const result = safeReadJSON(testFile);
    assert.deepEqual(result, { recovered: true });

    // Main file should be restored
    assert.ok(fs.existsSync(testFile), 'main file should be restored from backup');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('safeWriteJSON removes temp file on failure', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
  const testFile = path.join(tempDir, 'subdir', 'test.json'); // subdir doesn't exist
  const tempFile = `${testFile}.tmp`;

  try {
    // This should fail because subdir doesn't exist
    assert.throws(() => safeWriteJSON(testFile, { data: 'test' }), /Failed to write file/);

    // Temp file should not exist
    assert.ok(!fs.existsSync(tempFile), 'temp file should be cleaned up on failure');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
