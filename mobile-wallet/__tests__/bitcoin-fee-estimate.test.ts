jest.mock('../stubs/bip32.js', () => () => ({
  fromSeed: () => ({
    derivePath: () => ({
      privateKey: Buffer.from('00', 'hex'),
    }),
  }),
}));

jest.mock(
  '@noble/hashes/ripemd160',
  () => ({ ripemd160: () => new Uint8Array() }),
  { virtual: true }
);

const { BitcoinProvider } = require('../stubs/bitcoin-index.js');

describe('BitcoinProvider fee estimation', () => {
  const makeProvider = () =>
    new BitcoinProvider({ network: 'mainnet', networkKey: 'bitcoin-mainnet' });

  test('estimates fee with change output when dust threshold is met', async () => {
    const provider = makeProvider();
    provider.getUTXOs = jest.fn().mockResolvedValue([
      { txid: 'tx1', vout: 0, value: 100000, status: { confirmed: true } },
    ]);

    const estimate = await provider.estimateSendTransaction(
      'bc1qsender',
      'bc1qrecipient',
      '0.0005',
      5
    );

    expect(estimate.fee.vbytes).toBe(140);
    expect(estimate.fee.feeSats).toBe(700);
    expect(estimate.fee.inputCount).toBe(1);
    expect(estimate.fee.outputCount).toBe(2);
    expect(estimate.changeSats).toBe(49300);
  });

  test('drops change output when below dust limit', async () => {
    const provider = makeProvider();
    provider.getUTXOs = jest.fn().mockResolvedValue([
      { txid: 'tx2', vout: 1, value: 6000, status: { confirmed: true } },
    ]);

    const estimate = await provider.estimateSendTransaction(
      'bc1qsender',
      'bc1qrecipient',
      '0.00005',
      5
    );

    expect(estimate.fee.vbytes).toBe(109);
    expect(estimate.fee.feeSats).toBe(545);
    expect(estimate.fee.outputCount).toBe(1);
    expect(estimate.changeSats).toBe(0);
  });

  test('uses unconfirmed UTXOs for testnet fee estimates', async () => {
    const provider = new BitcoinProvider({ network: 'testnet', networkKey: 'bitcoin-testnet' });
    provider.getUTXOs = jest.fn().mockResolvedValue([
      { txid: 'tx4', vout: 0, value: 100000, status: { confirmed: false } },
    ]);

    const estimate = await provider.estimateSendTransaction(
      'tb1qsender',
      'tb1qrecipient',
      '0.0005',
      5
    );

    expect(estimate.fee.vbytes).toBe(140);
    expect(estimate.fee.feeSats).toBe(700);
    expect(estimate.fee.outputCount).toBe(2);
  });

  test('throws when balance cannot cover amount plus fee', async () => {
    const provider = makeProvider();
    provider.getUTXOs = jest.fn().mockResolvedValue([
      { txid: 'tx3', vout: 0, value: 1000, status: { confirmed: true } },
    ]);

    await expect(
      provider.estimateSendTransaction('bc1qsender', 'bc1qrecipient', '0.00002', 5)
    ).rejects.toThrow('Insufficient BTC balance for amount + fee');
  });
});
