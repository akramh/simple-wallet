/**
 * @file ecpair.js
 * @description Pure JS ECPair implementation for React Native using @noble/secp256k1
 */

const ecc = require('./tiny-secp256k1');
const { Buffer } = require('buffer');

class ECPair {
  constructor(privateKey, publicKey, options = {}) {
    this.__D = privateKey ? Buffer.from(privateKey) : null;
    this.__Q = publicKey ? Buffer.from(publicKey) : null;
    this.compressed = options.compressed !== false;
    this.network = options.network || {
      messagePrefix: '\x18Bitcoin Signed Message:\n',
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80,
    };
  }

  get privateKey() {
    return this.__D;
  }

  get publicKey() {
    if (!this.__Q && this.__D) {
      this.__Q = ecc.pointFromScalar(this.__D, this.compressed);
    }
    return this.__Q;
  }

  toWIF() {
    if (!this.__D) throw new Error('Missing private key');
    const { sha256 } = require('@noble/hashes/sha256');
    
    const prefix = Buffer.from([this.network.wif]);
    const suffix = this.compressed ? Buffer.from([0x01]) : Buffer.alloc(0);
    const data = Buffer.concat([prefix, this.__D, suffix]);
    
    const checksum = sha256(sha256(data)).slice(0, 4);
    const fullData = Buffer.concat([data, Buffer.from(checksum)]);
    
    return bs58encode(fullData);
  }

  sign(hash) {
    if (!this.__D) throw new Error('Missing private key');
    return ecc.sign(hash, this.__D);
  }

  verify(hash, signature) {
    return ecc.verify(hash, this.publicKey, signature);
  }
}

// Base58 encoding
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bs58encode(source) {
  if (source.length === 0) return '';
  
  const digits = [0];
  for (let i = 0; i < source.length; ++i) {
    let carry = source[i];
    for (let j = 0; j < digits.length; ++j) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  
  let string = '';
  for (let k = 0; source[k] === 0 && k < source.length - 1; ++k) {
    string += ALPHABET[0];
  }
  for (let q = digits.length - 1; q >= 0; --q) {
    string += ALPHABET[digits[q]];
  }
  return string;
}

function ECPairFactory(eccLib) {
  const ec = eccLib || ecc;
  
  return {
    makeRandom(options = {}) {
      const privateKey = Buffer.alloc(32);
      // Use crypto.getRandomValues if available
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(privateKey);
      } else {
        for (let i = 0; i < 32; i++) {
          privateKey[i] = Math.floor(Math.random() * 256);
        }
      }
      return new ECPair(privateKey, null, options);
    },

    fromPrivateKey(privateKey, options = {}) {
      if (!ecc.isPrivate(privateKey)) {
        throw new Error('Private key not in valid range');
      }
      return new ECPair(privateKey, null, options);
    },

    fromPublicKey(publicKey, options = {}) {
      if (!ecc.isPoint(publicKey)) {
        throw new Error('Public key not on curve');
      }
      return new ECPair(null, publicKey, options);
    },

    fromWIF(wif, network) {
      // Decode base58check
      const { sha256 } = require('@noble/hashes/sha256');
      const decoded = bs58decode(wif);
      
      const checksum = decoded.slice(-4);
      const data = decoded.slice(0, -4);
      
      const hash = sha256(sha256(data)).slice(0, 4);
      if (!Buffer.from(hash).equals(Buffer.from(checksum))) {
        throw new Error('Invalid checksum');
      }
      
      const version = data[0];
      const compressed = data.length === 34;
      const privateKey = compressed ? data.slice(1, 33) : data.slice(1);
      
      return new ECPair(Buffer.from(privateKey), null, { compressed, network });
    },
  };
}

function bs58decode(string) {
  if (string.length === 0) return Buffer.alloc(0);
  
  const ALPHABET_MAP = {};
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET.charAt(i)] = i;
  }
  
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    if (!(c in ALPHABET_MAP)) throw new Error('Invalid character');
    
    let carry = ALPHABET_MAP[c];
    for (let j = 0; j < bytes.length; ++j) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  
  // Add leading zeros
  for (let k = 0; string[k] === ALPHABET[0] && k < string.length - 1; ++k) {
    bytes.push(0);
  }
  
  return Buffer.from(bytes.reverse());
}

module.exports = ECPairFactory;
module.exports.default = ECPairFactory;
module.exports.ECPairFactory = ECPairFactory;
