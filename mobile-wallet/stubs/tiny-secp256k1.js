/**
 * @file tiny-secp256k1.js
 * @description Pure JS implementation for React Native using @noble/secp256k1
 * 
 * This replaces the WebAssembly-based tiny-secp256k1 with a pure JavaScript
 * implementation that works in React Native environments.
 */

const secpModule = require('@noble/secp256k1');
const secp = secpModule.default ?? secpModule;
const { sha256 } = require('@noble/hashes/sha256');
const { hmac } = require('@noble/hashes/hmac');

// Configure noble/secp256k1 to use noble/hashes for sync operations
secp.etc.hmacSha256Sync = (key, ...msgs) => {
  const h = hmac.create(sha256, key);
  msgs.forEach(m => h.update(m));
  return h.digest();
};
secp.hashes.sha256 = (msg) => sha256(msg);
secp.hashes.hmacSha256 = (key, msg) => hmac(sha256, key, msg);

// Curve order for secp256k1
const CURVE_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/**
 * Check if a buffer is a valid compressed or uncompressed public key point.
 */
const isPoint = (p) => {
  if (!p || (!Buffer.isBuffer(p) && !(p instanceof Uint8Array))) return false;
  try {
    secp.Point.fromHex(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a buffer is a valid compressed public key (33 bytes, starts with 02 or 03).
 */
const isPointCompressed = (p) => {
  if (!p || p.length !== 33) return false;
  return p[0] === 0x02 || p[0] === 0x03;
};

/**
 * Check if a buffer is a valid private key (32 bytes, non-zero, less than curve order).
 */
const isPrivate = (d) => {
  if (!d || d.length !== 32) return false;
  try {
    const n = BigInt('0x' + Buffer.from(d).toString('hex'));
    return n > 0n && n < CURVE_ORDER;
  } catch {
    return false;
  }
};

/**
 * Check if a buffer is a valid x-only point (32 bytes).
 */
const isXOnlyPoint = (p) => {
  if (!p || p.length !== 32) return false;
  try {
    const hex = Buffer.from(p).toString('hex');
    secp.Point.fromHex('02' + hex);
    return true;
  } catch {
    return false;
  }
};

/**
 * Derive public key from private key.
 */
const pointFromScalar = (d, compressed = true) => {
  if (!isPrivate(d)) return null;
  try {
    const pubKey = secp.getPublicKey(d, compressed);
    return Buffer.from(pubKey);
  } catch {
    return null;
  }
};

/**
 * Derive x-only public key from private key.
 */
const xOnlyPointFromScalar = (d) => {
  if (!isPrivate(d)) return null;
  try {
    const pubKey = secp.getPublicKey(d, true);
    return Buffer.from(pubKey.slice(1));
  } catch {
    return null;
  }
};

/**
 * Compress or decompress a public key point.
 */
const pointCompress = (p, compressed = true) => {
  if (!isPoint(p)) return null;
  try {
    const point = secp.Point.fromHex(p);
    return Buffer.from(point.toBytes(compressed));
  } catch {
    return null;
  }
};

/**
 * Add a scalar to a point (for BIP32 child key derivation).
 */
const pointAddScalar = (p, tweak, compressed = true) => {
  if (!isPoint(p) || !tweak || tweak.length !== 32) return null;
  try {
    const point = secp.Point.fromHex(p);
    const tweakScalar = BigInt('0x' + Buffer.from(tweak).toString('hex'));
    const tweakPoint = secp.Point.BASE.multiply(tweakScalar);
    const result = point.add(tweakPoint);
    return Buffer.from(result.toBytes(compressed));
  } catch {
    return null;
  }
};

/**
 * Add two points together.
 */
const pointAdd = (a, b, compressed = true) => {
  if (!isPoint(a) || !isPoint(b)) return null;
  try {
    const pointA = secp.Point.fromHex(a);
    const pointB = secp.Point.fromHex(b);
    const result = pointA.add(pointB);
    return Buffer.from(result.toBytes(compressed));
  } catch {
    return null;
  }
};

/**
 * Multiply a point by a scalar.
 */
const pointMultiply = (p, tweak, compressed = true) => {
  if (!isPoint(p) || !tweak || tweak.length !== 32) return null;
  try {
    const point = secp.Point.fromHex(p);
    const n = BigInt('0x' + Buffer.from(tweak).toString('hex'));
    const result = point.multiply(n);
    return Buffer.from(result.toBytes(compressed));
  } catch {
    return null;
  }
};

/**
 * Add a tweak to a private key (for BIP32 child key derivation).
 */
const privateAdd = (d, tweak) => {
  if (!isPrivate(d) || !tweak || tweak.length !== 32) return null;
  try {
    const dNum = BigInt('0x' + Buffer.from(d).toString('hex'));
    const tweakNum = BigInt('0x' + Buffer.from(tweak).toString('hex'));
    const sum = (dNum + tweakNum) % CURVE_ORDER;
    if (sum === 0n) return null;
    const hexSum = sum.toString(16).padStart(64, '0');
    return Buffer.from(hexSum, 'hex');
  } catch {
    return null;
  }
};

/**
 * Subtract a tweak from a private key.
 */
const privateSub = (d, tweak) => {
  if (!isPrivate(d) || !tweak || tweak.length !== 32) return null;
  try {
    const dNum = BigInt('0x' + Buffer.from(d).toString('hex'));
    const tweakNum = BigInt('0x' + Buffer.from(tweak).toString('hex'));
    let diff = (dNum - tweakNum) % CURVE_ORDER;
    if (diff < 0n) diff += CURVE_ORDER;
    if (diff === 0n) return null;
    const hexDiff = diff.toString(16).padStart(64, '0');
    return Buffer.from(hexDiff, 'hex');
  } catch {
    return null;
  }
};

/**
 * Negate a private key.
 */
const privateNegate = (d) => {
  if (!isPrivate(d)) return null;
  try {
    const dNum = BigInt('0x' + Buffer.from(d).toString('hex'));
    const neg = (CURVE_ORDER - dNum) % CURVE_ORDER;
    const hexNeg = neg.toString(16).padStart(64, '0');
    return Buffer.from(hexNeg, 'hex');
  } catch {
    return null;
  }
};

/**
 * Sign a message hash with a private key (ECDSA).
 */
const sign = (h, d, e) => {
  if (!h || h.length !== 32 || !isPrivate(d)) return null;
  try {
    const sig = secp.sign(h, d, { lowS: true, der: false, prehash: false });
    return Buffer.from(sig);
  } catch (err) {
    console.error('secp256k1 sign error:', err);
    return null;
  }
};

/**
 * Sign a message hash with a private key (Schnorr).
 */
const signSchnorr = (h, d, e) => {
  console.warn('Schnorr signing not implemented');
  return null;
};

/**
 * Verify an ECDSA signature.
 */
const verify = (h, Q, signature, strict = false) => {
  if (!h || h.length !== 32 || !isPoint(Q) || !signature) return false;
  try {
    return secp.verify(signature, h, Q, { prehash: false });
  } catch {
    return false;
  }
};

/**
 * Verify a Schnorr signature.
 */
const verifySchnorr = (h, Q, signature) => {
  console.warn('Schnorr verification not implemented');
  return false;
};

/**
 * x-only point add tweak (for Taproot).
 */
const xOnlyPointAddTweak = (p, tweak) => {
  if (!p || p.length !== 32 || !tweak || tweak.length !== 32) return null;
  try {
    const hex = Buffer.from(p).toString('hex');
    const point = secp.Point.fromHex('02' + hex);
    const tweakScalar = BigInt('0x' + Buffer.from(tweak).toString('hex'));
    const tweakPoint = secp.Point.BASE.multiply(tweakScalar);
    const result = point.add(tweakPoint);
    if (result.is0()) return null;
    const resultBytes = result.toBytes(true);
    return {
      parity: resultBytes[0] === 0x03 ? 1 : 0,
      xOnlyPubkey: Buffer.from(resultBytes.slice(1)),
    };
  } catch {
    return null;
  }
};

module.exports = {
  isPoint,
  isPointCompressed,
  isPrivate,
  isXOnlyPoint,
  pointFromScalar,
  xOnlyPointFromScalar,
  pointCompress,
  pointAdd,
  pointAddScalar,
  pointMultiply,
  privateAdd,
  privateSub,
  privateNegate,
  sign,
  signSchnorr,
  verify,
  verifySchnorr,
  xOnlyPointAddTweak,
};
module.exports.default = module.exports;
module.exports.__esModule = true;
