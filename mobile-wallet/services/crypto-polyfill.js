/**
 * @file crypto-polyfill.js
 * @description Sets up global crypto and Buffer for ethers.js, @solana/web3.js, xrpl, and other libraries
 * 
 * This must be imported BEFORE ethers.js or any library that uses crypto.
 * It sets up:
 * - global.Buffer from the 'buffer' package
 * - global.crypto.getRandomValues from expo-crypto
 * - global.TextEncoder/TextDecoder for encoding (used by Solana/XRP)
 */

import { Buffer } from 'buffer';
import * as ExpoCrypto from 'expo-crypto';

// Polyfill global.Buffer for Node.js compatibility
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill global.crypto for ethers.js, Solana, and XRP libraries
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

// Polyfill TextEncoder/TextDecoder for @solana/web3.js and xrpl
// These are needed for proper string encoding in these libraries
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(str) {
      const buf = Buffer.from(str, 'utf-8');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
  };
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      this.encoding = encoding;
    }
    decode(input) {
      if (input instanceof ArrayBuffer) {
        return Buffer.from(input).toString(this.encoding);
      }
      if (ArrayBuffer.isView(input)) {
        return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString(this.encoding);
      }
      return Buffer.from(input).toString(this.encoding);
    }
  };
}

console.log('[crypto-polyfill] Installed Buffer, crypto, and TextEncoder/TextDecoder polyfills');
