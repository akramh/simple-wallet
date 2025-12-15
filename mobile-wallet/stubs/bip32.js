/**
 * @file bip32.js
 * @description Stub for bip32 module in React Native
 * 
 * BIP32 requires tiny-secp256k1 WebAssembly which doesn't work in React Native.
 * This stub allows the app to compile. Bitcoin HD wallet functionality will need
 * a proper native implementation for production use.
 */

const notImplemented = (method) => {
  console.warn(`bip32.${method} is not available in React Native`);
  return null;
};

// Dummy BIP32 interface that passes basic checks
class BIP32Stub {
  constructor() {
    this.publicKey = new Uint8Array(33);
    this.publicKey[0] = 0x02;
    this.privateKey = null;
    this.chainCode = new Uint8Array(32);
    this.depth = 0;
    this.index = 0;
    this.parentFingerprint = 0;
  }

  get fingerprint() {
    return new Uint8Array([0, 0, 0, 0]);
  }

  get identifier() {
    return new Uint8Array(20);
  }

  isNeutered() {
    return this.privateKey === null;
  }

  neutered() {
    return new BIP32Stub();
  }

  toBase58() {
    console.warn('bip32.toBase58 is stubbed in React Native');
    return 'xpub_stub_not_implemented';
  }

  toWIF() {
    console.warn('bip32.toWIF is stubbed in React Native');
    return 'wif_stub_not_implemented';
  }

  derive(index) {
    console.warn('bip32.derive is stubbed in React Native');
    return new BIP32Stub();
  }

  deriveHardened(index) {
    console.warn('bip32.deriveHardened is stubbed in React Native');
    return new BIP32Stub();
  }

  derivePath(path) {
    console.warn('bip32.derivePath is stubbed in React Native');
    return new BIP32Stub();
  }

  sign(hash) {
    console.warn('bip32.sign is stubbed in React Native');
    return new Uint8Array(64);
  }

  verify(hash, signature) {
    console.warn('bip32.verify is stubbed in React Native');
    return false;
  }
}

// BIP32Factory that returns stub implementation
function BIP32Factory(ecc) {
  return {
    fromSeed(seed, network) {
      console.warn('bip32.fromSeed is stubbed in React Native');
      const node = new BIP32Stub();
      node.privateKey = new Uint8Array(32);
      return node;
    },
    fromBase58(string, network) {
      console.warn('bip32.fromBase58 is stubbed in React Native');
      return new BIP32Stub();
    },
    fromPublicKey(publicKey, chainCode, network) {
      console.warn('bip32.fromPublicKey is stubbed in React Native');
      return new BIP32Stub();
    },
    fromPrivateKey(privateKey, chainCode, network) {
      console.warn('bip32.fromPrivateKey is stubbed in React Native');
      const node = new BIP32Stub();
      node.privateKey = privateKey;
      return node;
    },
  };
}

module.exports = BIP32Factory;
module.exports.default = BIP32Factory;
module.exports.BIP32Factory = BIP32Factory;
