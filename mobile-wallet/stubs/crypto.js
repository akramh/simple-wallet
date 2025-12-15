/**
 * @file crypto.js
 * @description Stub for Node.js 'crypto' module in React Native
 * 
 * The wallet SDK imports Node.js 'crypto' but uses a CryptoAdapter
 * abstraction. In React Native, we use MobileCryptoAdapter which
 * uses WebCrypto APIs. This stub allows the code to compile.
 */

// Use expo-crypto for random bytes generation
let getRandomBytes;
try {
  // Try to use expo-crypto if available
  const expoCrypto = require('expo-crypto');
  getRandomBytes = expoCrypto.getRandomBytes;
} catch {
  // Fallback to Math.random (less secure, for development only)
  getRandomBytes = (size) => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  };
}

const randomBytes = (size, callback) => {
  const bytes = Buffer.from(getRandomBytes(size));
  if (callback) {
    callback(null, bytes);
    return;
  }
  return bytes;
};

const createHash = (algorithm) => {
  // Return a simple hash-like object
  // Actual hashing is done via crypto adapter
  let data = '';
  return {
    update: (input) => {
      data += input.toString();
      return this;
    },
    digest: (encoding) => {
      console.warn('crypto.createHash is stubbed. Use CryptoAdapter for actual hashing.');
      return encoding === 'hex' ? '0'.repeat(64) : Buffer.alloc(32);
    },
  };
};

const createHmac = (algorithm, key) => {
  return createHash(algorithm);
};

module.exports = {
  randomBytes,
  getRandomValues: (array) => {
    const bytes = getRandomBytes(array.length);
    array.set(bytes);
    return array;
  },
  createHash,
  createHmac,
  createCipheriv: () => {
    throw new Error('crypto.createCipheriv is not supported. Use CryptoAdapter.');
  },
  createDecipheriv: () => {
    throw new Error('crypto.createDecipheriv is not supported. Use CryptoAdapter.');
  },
  pbkdf2: () => {
    throw new Error('crypto.pbkdf2 is not supported. Use CryptoAdapter.');
  },
  pbkdf2Sync: () => {
    throw new Error('crypto.pbkdf2Sync is not supported. Use CryptoAdapter.');
  },
  scrypt: () => {
    throw new Error('crypto.scrypt is not supported. Use CryptoAdapter.');
  },
  scryptSync: () => {
    throw new Error('crypto.scryptSync is not supported. Use CryptoAdapter.');
  },
  // For Web Crypto compatibility
  subtle: globalThis.crypto?.subtle,
  webcrypto: globalThis.crypto,
};
