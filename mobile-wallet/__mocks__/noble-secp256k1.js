const VALID_X_ONLY = new Set([
  '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  'fffffffffffffffffffffffffffffffffffffffffffffffffffffffeeffffc2e',
  'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  '0000000000000000000000000000000000000000000000000000000000000001',
  '1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b',
  '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
]);

const TWEAK_VECTORS = new Map([
  [
    '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798|fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140',
    null,
  ],
  [
    '1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b|a8397a935f0dfceba6ba9618f6451ef4d80637abf4e6af2669fbc9de6a8fd2ac',
    { parity: 1, x: 'e478f99dab91052ab39a33ea35fd5e6e4933f4d28023cd597c9a1f6760346adf' },
  ],
  [
    '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991|823c3cd2142744b075a87eade7e1b8678ba308d566226a0056ca2b7a76f86b47',
    { parity: 0, x: '9534f8dc8c6deda2dc007655981c78b49c5d96c778fbf363462a11ec9dfd948c' },
  ],
]);

class Point {
  constructor(x, tweak = null) {
    this.x = x;
    this.tweak = tweak;
  }

  static fromHex(hex) {
    const hexStr = typeof hex === 'string' ? hex : Buffer.from(hex).toString('hex');
    if (!hexStr.startsWith('02')) {
      throw new Error('Invalid prefix');
    }
    const xOnly = hexStr.slice(2);
    if (!VALID_X_ONLY.has(xOnly)) {
      throw new Error('Invalid point');
    }
    return new Point(xOnly);
  }

  static BASE = new Point('BASE');

  add(other) {
    return new Point(this.x, other.tweak);
  }

  multiply(tweak) {
    const tweakHex = typeof tweak === 'bigint'
      ? tweak.toString(16).padStart(64, '0')
      : Buffer.from(tweak).toString('hex');
    return new Point(this.x, tweakHex);
  }

  is0() {
    const key = `${this.x}|${this.tweak}`;
    return TWEAK_VECTORS.has(key) && TWEAK_VECTORS.get(key) === null;
  }

  toBytes() {
    const key = `${this.x}|${this.tweak}`;
    const entry = TWEAK_VECTORS.get(key);
    if (!entry) {
      return Buffer.from(`02${this.x}`, 'hex');
    }
    const prefix = entry.parity === 1 ? '03' : '02';
    return Buffer.from(`${prefix}${entry.x}`, 'hex');
  }
}

module.exports = {
  __esModule: true,
  Point,
  getPublicKey: () => new Uint8Array(33),
  sign: () => new Uint8Array(64),
  verify: () => true,
  hashes: { sha256: null, hmacSha256: null },
  etc: {},
  default: {
    Point,
    getPublicKey: () => new Uint8Array(33),
    sign: () => new Uint8Array(64),
    verify: () => true,
    hashes: { sha256: null, hmacSha256: null },
    etc: {},
  },
};
