/**
 * @file bip32.js
 * @description Pure JS BIP32 implementation for React Native using @noble/secp256k1
 * 
 * This replaces the WebAssembly-dependent bip32 module with a pure JavaScript
 * implementation that works in React Native environments.
 */

const ecc = require('./tiny-secp256k1');
const { sha256 } = require('@noble/hashes/sha256');
const { sha512 } = require('@noble/hashes/sha512');
const { hmac } = require('@noble/hashes/hmac');
const { ripemd160 } = require('@noble/hashes/ripemd160');

// Ensure Buffer is available
const { Buffer } = require('buffer');

// Network configurations
const BITCOIN_MAINNET = {
  wif: 0x80,
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
};

/**
 * Hash160 (SHA256 + RIPEMD160)
 */
function hash160(buffer) {
  return Buffer.from(ripemd160(sha256(buffer)));
}

/**
 * HMAC-SHA512
 */
function hmacSHA512(key, data) {
  return Buffer.from(hmac(sha512, key, data));
}

/**
 * Base58 alphabet
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET.charAt(i)] = i;
}

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

function bs58checkEncode(payload) {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return bs58encode(Buffer.concat([payload, Buffer.from(checksum)]));
}

/**
 * BIP32 HD Key class
 */
class BIP32 {
  constructor(privateKey, publicKey, chainCode, network = BITCOIN_MAINNET, depth = 0, index = 0, parentFingerprint = 0) {
    this.__D = privateKey;
    this.__Q = publicKey;
    this.chainCode = chainCode;
    this.network = network;
    this.depth = depth;
    this.index = index;
    this.parentFingerprint = parentFingerprint;
  }

  get privateKey() {
    return this.__D;
  }

  get publicKey() {
    if (!this.__Q && this.__D) {
      this.__Q = ecc.pointFromScalar(this.__D, true);
    }
    return this.__Q;
  }

  get identifier() {
    return hash160(this.publicKey);
  }

  get fingerprint() {
    return this.identifier.slice(0, 4);
  }

  isNeutered() {
    return this.__D === undefined || this.__D === null;
  }

  neutered() {
    return new BIP32(
      undefined,
      this.publicKey,
      this.chainCode,
      this.network,
      this.depth,
      this.index,
      this.parentFingerprint
    );
  }

  toBase58() {
    const network = this.network;
    const version = !this.isNeutered() ? network.bip32.private : network.bip32.public;
    const buffer = Buffer.allocUnsafe(78);
    
    // 4 bytes: version bytes
    buffer.writeUInt32BE(version, 0);
    // 1 byte: depth
    buffer.writeUInt8(this.depth, 4);
    // 4 bytes: parent fingerprint
    buffer.writeUInt32BE(this.parentFingerprint, 5);
    // 4 bytes: child index
    buffer.writeUInt32BE(this.index, 9);
    // 32 bytes: chain code
    this.chainCode.copy(buffer, 13);
    
    if (!this.isNeutered()) {
      // 33 bytes: 0x00 || private key
      buffer.writeUInt8(0, 45);
      this.privateKey.copy(buffer, 46);
    } else {
      // 33 bytes: public key
      this.publicKey.copy(buffer, 45);
    }
    
    return bs58checkEncode(buffer);
  }

  toWIF() {
    if (!this.privateKey) throw new Error('Missing private key');
    const buffer = Buffer.allocUnsafe(34);
    buffer.writeUInt8(this.network.wif, 0);
    this.privateKey.copy(buffer, 1);
    buffer.writeUInt8(0x01, 33); // compressed
    return bs58checkEncode(buffer);
  }

  derive(index) {
    const isHardened = index >= 0x80000000;
    const data = Buffer.allocUnsafe(37);
    
    if (isHardened) {
      if (this.isNeutered()) throw new Error('Missing private key for hardened child key');
      data[0] = 0;
      this.privateKey.copy(data, 1);
      data.writeUInt32BE(index, 33);
    } else {
      this.publicKey.copy(data, 0);
      data.writeUInt32BE(index, 33);
    }
    
    const I = hmacSHA512(this.chainCode, data);
    const IL = I.slice(0, 32);
    const IR = I.slice(32);
    
    let hd;
    if (!this.isNeutered()) {
      const ki = ecc.privateAdd(this.privateKey, IL);
      if (ki === null) return this.derive(index + 1);
      hd = new BIP32(
        ki,
        undefined,
        IR,
        this.network,
        this.depth + 1,
        index,
        this.fingerprint.readUInt32BE(0)
      );
    } else {
      const Ki = ecc.pointAddScalar(this.publicKey, IL, true);
      if (Ki === null) return this.derive(index + 1);
      hd = new BIP32(
        undefined,
        Ki,
        IR,
        this.network,
        this.depth + 1,
        index,
        this.fingerprint.readUInt32BE(0)
      );
    }
    
    return hd;
  }

  deriveHardened(index) {
    return this.derive(index + 0x80000000);
  }

  derivePath(path) {
    let splitPath = path.split('/');
    if (splitPath[0] === 'm') {
      if (this.parentFingerprint) throw new Error('Expected master, got child');
      splitPath = splitPath.slice(1);
    }
    
    return splitPath.reduce((prevHd, indexStr) => {
      let index;
      if (indexStr.slice(-1) === "'") {
        index = parseInt(indexStr.slice(0, -1), 10);
        return prevHd.deriveHardened(index);
      } else {
        index = parseInt(indexStr, 10);
        return prevHd.derive(index);
      }
    }, this);
  }

  sign(hash) {
    if (!this.privateKey) throw new Error('Missing private key');
    return ecc.sign(hash, this.privateKey);
  }

  verify(hash, signature) {
    return ecc.verify(hash, this.publicKey, signature);
  }
}

/**
 * BIP32Factory - creates BIP32 instances
 */
function BIP32Factory(eccLib) {
  // Use provided ecc library or fall back to our implementation
  const ec = eccLib || ecc;
  
  return {
    fromSeed(seed, network = BITCOIN_MAINNET) {
      if (seed.length < 16) throw new Error('Seed should be at least 128 bits');
      if (seed.length > 64) throw new Error('Seed should be at most 512 bits');
      
      const I = hmacSHA512(Buffer.from('Bitcoin seed'), seed);
      const IL = I.slice(0, 32);
      const IR = I.slice(32);
      
      return new BIP32(Buffer.from(IL), undefined, Buffer.from(IR), network);
    },
    
    fromPublicKey(publicKey, chainCode, network = BITCOIN_MAINNET) {
      return new BIP32(undefined, publicKey, chainCode, network);
    },
    
    fromPrivateKey(privateKey, chainCode, network = BITCOIN_MAINNET) {
      return new BIP32(privateKey, undefined, chainCode, network);
    },
  };
}

module.exports = BIP32Factory;
module.exports.default = BIP32Factory;
module.exports.BIP32Factory = BIP32Factory;
