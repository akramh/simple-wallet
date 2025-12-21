/**
 * @file react-native-fast-pbkdf2.js
 * @description Stub for react-native-fast-pbkdf2 used by @ton/crypto-primitives.
 *
 * The TON SDK's crypto-primitives package expects this module for pbkdf2 in
 * React Native environments. We redirect to our MobileCryptoAdapter which
 * uses @noble/hashes for pbkdf2.
 */

const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { sha512 } = require('@noble/hashes/sha512');
// Use the React Native compatible Buffer with full API (.copy(), etc.)
const { Buffer } = require('@craftzdog/react-native-buffer');

/**
 * Derives a key using PBKDF2-SHA512.
 *
 * @param {string} passwordBase64 - Password as base64 string
 * @param {string} saltBase64 - Salt as base64 string
 * @param {number} iterations - Number of iterations
 * @param {number} keyLen - Desired key length in bytes
 * @param {string} hash - Hash algorithm (only 'sha-512' is supported)
 * @returns {Promise<string>} Derived key as base64 string
 */
async function derive(passwordBase64, saltBase64, iterations, keyLen, hash) {
  if (hash !== 'sha-512') {
    throw new Error(`Unsupported hash algorithm: ${hash}. Only sha-512 is supported.`);
  }

  // Decode base64 inputs
  const password = Buffer.from(passwordBase64, 'base64');
  const salt = Buffer.from(saltBase64, 'base64');

  // Use @noble/hashes pbkdf2
  const derived = pbkdf2(sha512, password, salt, {
    c: iterations,
    dkLen: keyLen,
  });

  // Return as base64
  return Buffer.from(derived).toString('base64');
}

module.exports = {
  default: {
    derive,
  },
  derive,
};
