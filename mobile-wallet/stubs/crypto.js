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

const { sha256 } = require('@noble/hashes/sha256');
const { sha512 } = require('@noble/hashes/sha512');
const { ripemd160 } = require('@noble/hashes/legacy.js');
const { hmac } = require('@noble/hashes/hmac');

const HASH_ALGORITHMS = {
  sha256,
  sha512,
  ripemd160,
};

const toBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return new Uint8Array(Buffer.from(String(value)));
};

const digestToBuffer = (bytes, encoding) => {
  const buffer = Buffer.from(bytes);
  if (encoding === 'hex') return buffer.toString('hex');
  return buffer;
};

const createHash = (algorithm) => {
  const algo = String(algorithm || '').toLowerCase();
  const hashFn = HASH_ALGORITHMS[algo];
  if (!hashFn) {
    throw new Error(`crypto.createHash unsupported algorithm: ${algorithm}`);
  }

  const chunks = [];
  const api = {
    update: (input) => {
      chunks.push(toBytes(input));
      return api;
    },
    digest: (encoding) => {
      const payload = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      const hash = hashFn(payload);
      return digestToBuffer(hash, encoding);
    },
  };
  return api;
};

const createHmac = (algorithm, key) => {
  const algo = String(algorithm || '').toLowerCase();
  const hashFn = HASH_ALGORITHMS[algo];
  if (!hashFn) {
    throw new Error(`crypto.createHmac unsupported algorithm: ${algorithm}`);
  }

  const h = hmac.create(hashFn, toBytes(key));
  const api = {
    update: (input) => {
      h.update(toBytes(input));
      return api;
    },
    digest: (encoding) => {
      const result = h.digest();
      return digestToBuffer(result, encoding);
    },
  };
  return api;
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
