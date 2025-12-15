/**
 * @file ecpair.js
 * @description Stub for ecpair module in React Native
 * 
 * ECPair requires tiny-secp256k1 WebAssembly which doesn't work in React Native.
 * This stub allows the app to compile. Bitcoin signing will need
 * a proper native implementation for production use.
 */

class ECPairStub {
  constructor(privateKey, publicKey, options = {}) {
    this.__D = privateKey || null;
    this.__Q = publicKey || new Uint8Array(33).fill(0);
    this.__Q[0] = 0x02;
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
    return Buffer.from(this.__Q);
  }

  toWIF() {
    console.warn('ECPair.toWIF is stubbed in React Native');
    return 'stub_wif_not_implemented';
  }

  sign(hash) {
    console.warn('ECPair.sign is stubbed in React Native');
    return Buffer.alloc(64);
  }

  signSchnorr(hash) {
    console.warn('ECPair.signSchnorr is stubbed in React Native');
    return Buffer.alloc(64);
  }

  verify(hash, signature) {
    console.warn('ECPair.verify is stubbed in React Native');
    return false;
  }

  verifySchnorr(hash, signature) {
    console.warn('ECPair.verifySchnorr is stubbed in React Native');
    return false;
  }
}

function ECPairFactory(ecc) {
  return {
    makeRandom(options = {}) {
      console.warn('ECPair.makeRandom is stubbed in React Native');
      const privateKey = new Uint8Array(32);
      // Fill with pseudo-random for structure (not secure!)
      for (let i = 0; i < 32; i++) {
        privateKey[i] = Math.floor(Math.random() * 256);
      }
      return new ECPairStub(privateKey, null, options);
    },

    fromPrivateKey(privateKey, options = {}) {
      console.warn('ECPair.fromPrivateKey is stubbed in React Native');
      return new ECPairStub(privateKey, null, options);
    },

    fromPublicKey(publicKey, options = {}) {
      console.warn('ECPair.fromPublicKey is stubbed in React Native');
      return new ECPairStub(null, publicKey, options);
    },

    fromWIF(wif, network) {
      console.warn('ECPair.fromWIF is stubbed in React Native');
      return new ECPairStub(new Uint8Array(32), null, { network });
    },
  };
}

module.exports = ECPairFactory;
module.exports.default = ECPairFactory;
module.exports.ECPairFactory = ECPairFactory;
