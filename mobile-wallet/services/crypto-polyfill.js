/**
 * @file crypto-polyfill.js
 * @description Sets up global crypto and Buffer for ethers.js, @solana/web3.js, xrpl, TON, and other libraries
 *
 * This must be imported BEFORE ethers.js or any library that uses crypto.
 * It sets up:
 * - global.Buffer from @craftzdog/react-native-buffer (full Node.js Buffer API including .copy())
 * - global.crypto.getRandomValues from expo-crypto
 * - global.TextEncoder/TextDecoder for encoding (used by Solana/XRP/TON)
 */

// Use @craftzdog/react-native-buffer for full Buffer API compatibility (includes .copy(), .slice(), etc.)
// This is required for @ton/core which uses Buffer.copy()
import { Buffer } from '@craftzdog/react-native-buffer';
import * as ExpoCrypto from 'expo-crypto';

// Debug: log what's available before polyfill
console.log('[crypto-polyfill] Starting polyfill...');
console.log('[crypto-polyfill] typeof globalThis:', typeof globalThis);
console.log('[crypto-polyfill] globalThis.crypto exists:', !!globalThis?.crypto);
console.log('[crypto-polyfill] globalThis.crypto?.getRandomValues exists:', !!globalThis?.crypto?.getRandomValues);

// Polyfill global.Buffer for Node.js compatibility
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Shared getRandomValues implementation using expo-crypto
const getRandomValues = (array) => {
  const bytes = ExpoCrypto.getRandomBytes(array.length);
  array.set(bytes);
  return array;
};

// Polyfill globalThis.crypto for @noble/hashes, @scure/bip39 (ECMAScript standard)
// These libraries check: typeof globalThis === 'object' ? globalThis.crypto : null
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.getRandomValues === 'undefined') {
  globalThis.crypto.getRandomValues = getRandomValues;
}

// Debug: verify polyfill worked
console.log('[crypto-polyfill] After polyfill:');
console.log('[crypto-polyfill] globalThis.crypto exists:', !!globalThis?.crypto);
console.log('[crypto-polyfill] globalThis.crypto?.getRandomValues exists:', !!globalThis?.crypto?.getRandomValues);
console.log('[crypto-polyfill] globalThis.crypto?.getRandomValues is function:', typeof globalThis?.crypto?.getRandomValues === 'function');

// Polyfill global.crypto for ethers.js, Solana, and XRP libraries (Node.js style)
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues === 'undefined') {
  global.crypto.getRandomValues = getRandomValues;
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

// Polyfill base64 conversion functions for @ton/crypto
// These are React Native-specific globals that @ton/crypto expects
// NOTE: We must NOT use Buffer here as @craftzdog/react-native-buffer calls these functions internally,
// which would create infinite recursion. Use pure JS base64 decoding instead.
if (typeof global.base64ToArrayBuffer === 'undefined') {
  global.base64ToArrayBuffer = (base64) => {
    // Pure JS base64 decode without using Buffer (to avoid circular dependency)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charCodeAt(i)] = i;
    }

    // Remove padding and whitespace
    const cleanBase64 = base64.replace(/[^A-Za-z0-9+/]/g, '');
    const len = cleanBase64.length;
    const bufferLength = Math.floor(len * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    const bytes = new Uint8Array(bufferLength);

    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = lookup[cleanBase64.charCodeAt(i)];
      const encoded2 = lookup[cleanBase64.charCodeAt(i + 1)];
      const encoded3 = lookup[cleanBase64.charCodeAt(i + 2)];
      const encoded4 = lookup[cleanBase64.charCodeAt(i + 3)];

      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
      if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }

    return bytes.buffer;
  };
}

if (typeof global.arrayBufferToBase64 === 'undefined') {
  global.arrayBufferToBase64 = (arrayBuffer) => {
    // Pure JS base64 encode without using Buffer (to avoid circular dependency)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = new Uint8Array(arrayBuffer);
    let result = '';

    for (let i = 0; i < bytes.length; i += 3) {
      const byte1 = bytes[i];
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];

      result += chars[byte1 >> 2];
      result += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
      result += i + 1 < bytes.length ? chars[((byte2 & 15) << 2) | (byte3 >> 6)] : '=';
      result += i + 2 < bytes.length ? chars[byte3 & 63] : '=';
    }

    return result;
  };
}

console.log('[crypto-polyfill] Installed Buffer, crypto, TextEncoder/TextDecoder, and base64 polyfills');
