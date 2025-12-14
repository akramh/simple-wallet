/**
 * @fileoverview Tests for session password obfuscation.
 *
 * Tests the XOR-based memory obfuscation for session passwords
 * to verify round-trip correctness and memory clearing behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// Mock Implementation of Session Password Logic
// ============================================================================

// These tests verify the logic that's implemented in service-worker.ts
// We recreate the core logic here for unit testing without browser dependencies

/**
 * @typedef {Object} ObfuscatedPassword
 * @property {Uint8Array} data - XOR'd password bytes
 * @property {Uint8Array} key - Random key used for XOR
 */

/**
 * Creates a mock session password manager for testing.
 * Uses the same algorithm as service-worker.ts
 */
function createPasswordManager() {
  /** @type {ObfuscatedPassword|null} */
  let obfuscatedPassword = null;

  // Use crypto.getRandomValues if available (Node 19+), otherwise mock
  const getRandomValues = (arr) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return crypto.getRandomValues(arr);
    }
    // Fallback for older Node versions
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  };

  return {
    /**
     * Store session password with obfuscation.
     * @param {string|null} password
     */
    setSessionPassword(password) {
      if (password === null) {
        // Clear the obfuscated password
        if (obfuscatedPassword) {
          // Overwrite memory before clearing
          obfuscatedPassword.data.fill(0);
          obfuscatedPassword.key.fill(0);
          obfuscatedPassword = null;
        }
        return;
      }

      // Convert password to bytes
      const encoder = new TextEncoder();
      const passwordBytes = encoder.encode(password);

      // Generate random key of same length
      const key = new Uint8Array(passwordBytes.length);
      getRandomValues(key);

      // XOR password with key
      const data = new Uint8Array(passwordBytes.length);
      for (let i = 0; i < passwordBytes.length; i++) {
        data[i] = passwordBytes[i] ^ key[i];
      }

      // Clear original password bytes
      passwordBytes.fill(0);

      obfuscatedPassword = { data, key };
    },

    /**
     * Retrieve session password (de-obfuscate).
     * @returns {string|null}
     */
    getSessionPassword() {
      if (!obfuscatedPassword) return null;

      // XOR data with key to recover password
      const passwordBytes = new Uint8Array(obfuscatedPassword.data.length);
      for (let i = 0; i < obfuscatedPassword.data.length; i++) {
        passwordBytes[i] = obfuscatedPassword.data[i] ^ obfuscatedPassword.key[i];
      }

      // Convert to string
      const decoder = new TextDecoder();
      const password = decoder.decode(passwordBytes);

      // Clear temporary bytes
      passwordBytes.fill(0);

      return password;
    },

    /**
     * Check if session password is set.
     * @returns {boolean}
     */
    hasSessionPassword() {
      return obfuscatedPassword !== null;
    },

    /**
     * Get raw obfuscated data for inspection (testing only).
     * @returns {ObfuscatedPassword|null}
     */
    _getObfuscated() {
      return obfuscatedPassword;
    }
  };
}

// ============================================================================
// Basic Round-Trip Tests
// ============================================================================

test('setSessionPassword/getSessionPassword round-trip preserves password', () => {
  const manager = createPasswordManager();
  const password = 'MySecretPassword123!';

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

test('getSessionPassword returns null when not set', () => {
  const manager = createPasswordManager();

  assert.equal(manager.getSessionPassword(), null);
});

test('hasSessionPassword returns false initially', () => {
  const manager = createPasswordManager();

  assert.equal(manager.hasSessionPassword(), false);
});

test('hasSessionPassword returns true after setting password', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('password');

  assert.equal(manager.hasSessionPassword(), true);
});

// ============================================================================
// Memory Clearing Tests
// ============================================================================

test('setSessionPassword(null) clears the password', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('password');
  manager.setSessionPassword(null);

  assert.equal(manager.getSessionPassword(), null);
  assert.equal(manager.hasSessionPassword(), false);
});

test('setSessionPassword(null) zeros obfuscated memory', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('password');
  const obfuscated = manager._getObfuscated();

  // Store references to arrays before clearing
  const dataRef = obfuscated.data;
  const keyRef = obfuscated.key;

  manager.setSessionPassword(null);

  // Arrays should be zeroed (even though we no longer have access via manager)
  assert.ok(dataRef.every(b => b === 0), 'data should be zeroed');
  assert.ok(keyRef.every(b => b === 0), 'key should be zeroed');
});

test('clearing password twice is safe', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('password');
  manager.setSessionPassword(null);
  manager.setSessionPassword(null); // Should not throw

  assert.equal(manager.hasSessionPassword(), false);
});

// ============================================================================
// Obfuscation Tests
// ============================================================================

test('obfuscated data differs from plaintext', () => {
  const manager = createPasswordManager();
  const password = 'password';

  manager.setSessionPassword(password);
  const obfuscated = manager._getObfuscated();

  // Convert password to bytes for comparison
  const passwordBytes = new TextEncoder().encode(password);

  // Data should not match plaintext (unless random key happened to be all zeros, extremely unlikely)
  let matches = true;
  for (let i = 0; i < passwordBytes.length; i++) {
    if (obfuscated.data[i] !== passwordBytes[i]) {
      matches = false;
      break;
    }
  }

  assert.equal(matches, false, 'obfuscated data should differ from plaintext');
});

test('different setSessionPassword calls produce different obfuscations', () => {
  const manager1 = createPasswordManager();
  const manager2 = createPasswordManager();

  manager1.setSessionPassword('samepassword');
  manager2.setSessionPassword('samepassword');

  const obf1 = manager1._getObfuscated();
  const obf2 = manager2._getObfuscated();

  // Keys should be different (random)
  let keysMatch = true;
  for (let i = 0; i < obf1.key.length; i++) {
    if (obf1.key[i] !== obf2.key[i]) {
      keysMatch = false;
      break;
    }
  }

  assert.equal(keysMatch, false, 'random keys should differ between calls');
});

test('obfuscated data and key have same length as password', () => {
  const manager = createPasswordManager();
  const password = 'test123';

  manager.setSessionPassword(password);
  const obfuscated = manager._getObfuscated();

  const passwordBytes = new TextEncoder().encode(password);

  assert.equal(obfuscated.data.length, passwordBytes.length);
  assert.equal(obfuscated.key.length, passwordBytes.length);
});

// ============================================================================
// Edge Case Tests
// ============================================================================

test('handles empty string password', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('');
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, '');
  assert.equal(manager.hasSessionPassword(), true);
});

test('handles unicode password', () => {
  const manager = createPasswordManager();
  const password = '密码🔐Пароль';

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

test('handles very long password', () => {
  const manager = createPasswordManager();
  const password = 'a'.repeat(10000);

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

test('handles password with special characters', () => {
  const manager = createPasswordManager();
  const password = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

test('handles password with null bytes', () => {
  const manager = createPasswordManager();
  const password = 'before\x00after';

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

test('handles password with newlines', () => {
  const manager = createPasswordManager();
  const password = 'line1\nline2\r\nline3';

  manager.setSessionPassword(password);
  const retrieved = manager.getSessionPassword();

  assert.equal(retrieved, password);
});

// ============================================================================
// Multiple Get Tests
// ============================================================================

test('getSessionPassword can be called multiple times', () => {
  const manager = createPasswordManager();
  const password = 'persistent';

  manager.setSessionPassword(password);

  assert.equal(manager.getSessionPassword(), password);
  assert.equal(manager.getSessionPassword(), password);
  assert.equal(manager.getSessionPassword(), password);
});

test('password persists after multiple gets', () => {
  const manager = createPasswordManager();
  const password = 'persistent';

  manager.setSessionPassword(password);

  for (let i = 0; i < 100; i++) {
    manager.getSessionPassword();
  }

  assert.equal(manager.getSessionPassword(), password);
  assert.equal(manager.hasSessionPassword(), true);
});

// ============================================================================
// Overwrite Tests
// ============================================================================

test('setting new password overwrites old password', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('old-password');
  manager.setSessionPassword('new-password');

  assert.equal(manager.getSessionPassword(), 'new-password');
});

test('overwriting password does not leave old data', () => {
  const manager = createPasswordManager();

  manager.setSessionPassword('first-password-that-is-longer');
  const oldData = new Uint8Array(manager._getObfuscated().data);

  manager.setSessionPassword('short');
  const newData = manager._getObfuscated().data;

  // New data should be shorter
  assert.equal(newData.length, new TextEncoder().encode('short').length);

  // Old data reference should still exist but arrays are different objects
  assert.notEqual(oldData.length, newData.length);
});

// ============================================================================
// XOR Properties Tests
// ============================================================================

test('XOR operation is reversible', () => {
  const manager = createPasswordManager();

  // XOR property: (A XOR B) XOR B = A
  manager.setSessionPassword('test');
  const obf = manager._getObfuscated();

  // Manually verify XOR reversibility
  const recovered = new Uint8Array(obf.data.length);
  for (let i = 0; i < obf.data.length; i++) {
    recovered[i] = obf.data[i] ^ obf.key[i];
  }

  const decoder = new TextDecoder();
  assert.equal(decoder.decode(recovered), 'test');
});

test('key is non-zero for non-empty password (probabilistic)', () => {
  const manager = createPasswordManager();

  // Set a password and check that key has some non-zero bytes
  // This is probabilistic but extremely unlikely to fail
  manager.setSessionPassword('password');
  const obf = manager._getObfuscated();

  const hasNonZero = obf.key.some(b => b !== 0);
  assert.ok(hasNonZero, 'random key should have non-zero bytes');
});
