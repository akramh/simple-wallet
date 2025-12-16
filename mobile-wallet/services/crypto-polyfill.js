/**
 * @file crypto-polyfill.js
 * @description Sets up global crypto and Buffer for ethers.js and other libraries
 * 
 * This must be imported BEFORE ethers.js or any library that uses crypto.
 * It sets up:
 * - global.Buffer from the 'buffer' package
 * - global.crypto.getRandomValues from expo-crypto
 */

import { Buffer } from 'buffer';
import * as ExpoCrypto from 'expo-crypto';

// Polyfill global.Buffer for Node.js compatibility
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill global.crypto for ethers.js
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}

if (typeof global.crypto.getRandomValues === 'undefined') {
  global.crypto.getRandomValues = (array) => {
    const bytes = ExpoCrypto.getRandomBytes(array.length);
    array.set(bytes);
    return array;
  };
}

// Also ensure webcrypto interface is available
if (typeof global.crypto.subtle === 'undefined' && typeof crypto !== 'undefined' && crypto.subtle) {
  global.crypto.subtle = crypto.subtle;
}

console.log('[crypto-polyfill] Installed Buffer and crypto.getRandomValues polyfills');
