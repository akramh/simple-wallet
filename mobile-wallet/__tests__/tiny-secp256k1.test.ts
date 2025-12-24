const ecc = require('../stubs/tiny-secp256k1.js');

const hex = (value: string) => Buffer.from(value, 'hex');

describe('tiny-secp256k1 stub compatibility', () => {
  test('validates x-only points like bitcoinjs-lib expects', () => {
    const valid = [
      '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      'fffffffffffffffffffffffffffffffffffffffffffffffffffffffeeffffc2e',
      'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      '0000000000000000000000000000000000000000000000000000000000000001',
    ];
    const invalid = [
      '0000000000000000000000000000000000000000000000000000000000000000',
      'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
    ];

    valid.forEach((value) => {
      expect(ecc.isXOnlyPoint(hex(value))).toBe(true);
    });
    invalid.forEach((value) => {
      expect(ecc.isXOnlyPoint(hex(value))).toBe(false);
    });
  });

  test('xOnlyPointAddTweak matches known vectors', () => {
    const vectors = [
      {
        pubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        tweak: 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140',
        parity: -1,
        result: null,
      },
      {
        pubkey: '1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b',
        tweak: 'a8397a935f0dfceba6ba9618f6451ef4d80637abf4e6af2669fbc9de6a8fd2ac',
        parity: 1,
        result: 'e478f99dab91052ab39a33ea35fd5e6e4933f4d28023cd597c9a1f6760346adf',
      },
      {
        pubkey: '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
        tweak: '823c3cd2142744b075a87eade7e1b8678ba308d566226a0056ca2b7a76f86b47',
        parity: 0,
        result: '9534f8dc8c6deda2dc007655981c78b49c5d96c778fbf363462a11ec9dfd948c',
      },
    ];

    vectors.forEach((vector) => {
      const result = ecc.xOnlyPointAddTweak(hex(vector.pubkey), hex(vector.tweak));
      if (vector.result === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result?.parity).toBe(vector.parity);
        expect(Buffer.from(result?.xOnlyPubkey || []).toString('hex')).toBe(vector.result);
      }
    });
  });
});
