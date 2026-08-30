/**
 * @fileoverview Unit tests for WalletBridge swap passthrough.
 *
 * Verifies the chain-neutral swap methods route to WalletAppService, the
 * password asymmetry (session password injected for Solana sources only —
 * the UI never supplies one), the locked-wallet invariant, and that
 * isSwapSupported degrades to false rather than throwing when locked.
 */

import { describe, test, expect, jest, beforeEach, afterEach, afterAll } from '@jest/globals';

// Mock bundled config with a Solana network active
jest.mock('../config/bundled-config', () => ({
  __esModule: true,
  getBundledConfig: () => ({
    network: 'solana-mainnet',
    networks: {
      'solana-mainnet': {
        name: 'Solana',
        type: 'solana',
        nativeSymbol: 'SOL',
        rpcUrl: 'https://sol.example',
      },
      mainnet: {
        name: 'Ethereum',
        chainId: 1,
        nativeSymbol: 'ETH',
        rpcUrl: 'https://eth.example',
      },
    },
  }),
  getBundledTokens: () => ({}),
  getCoingeckoApiKey: () => undefined,
  getAlchemyApiKey: () => undefined,
  getOneInchApiKey: () => undefined,
  setRuntimeAlchemyKey: jest.fn(),
}));

jest.mock('../services/MobileStorageAdapter', () => ({
  __esModule: true,
  mobileStorage: {
    initialize: jest.fn(async () => {}),
    readJSON: jest.fn((path, fallback) => fallback || {}),
    writeJSON: jest.fn(() => {}),
    clear: jest.fn(async () => {}),
  },
  MobileStorageAdapter: class {},
}));

jest.mock('../services/MobileCryptoAdapter', () => ({
  __esModule: true,
  mobileCrypto: {},
  MobileCryptoAdapter: class {},
}));

const SOL = { symbol: 'SOL', name: 'Solana', type: 'native', address: '', decimals: 9 };
const ETH = { symbol: 'ETH', name: 'Ether', type: 'native', address: '', decimals: 18 };

/** Build a quote view whose request drives the source-network branch. */
const makeQuote = (fromNetworkKey: string) => ({
  provider: fromNetworkKey === 'solana-mainnet' ? 'mayan' : 'oneinch',
  fromNetworkKey,
  toNetworkKey: fromNetworkKey === 'solana-mainnet' ? 'mainnet' : 'mainnet',
  fromTokenSymbol: fromNetworkKey === 'solana-mainnet' ? 'SOL' : 'ETH',
  toTokenSymbol: 'ETH',
  amountInFormatted: '1',
  amountOutFormatted: '0.05',
  minAmountOutFormatted: '0.049',
  rateFormatted: '',
  feeFormatted: '',
  needsApproval: false,
  expiresAt: Date.now() + 45_000,
  raw: {},
  request: {
    fromNetworkKey,
    fromToken: fromNetworkKey === 'solana-mainnet' ? SOL : ETH,
    toNetworkKey: 'mainnet',
    toToken: ETH,
    amount: '1',
    slippagePercent: 1,
  },
});

const mockGetSwapQuote = jest.fn(async () => makeQuote('solana-mainnet'));
const mockExecuteSwap = jest.fn(async (_quote: any, _options?: any) => ({
  provider: 'mayan',
  txId: 'swap_sig',
  fromNetworkKey: 'solana-mainnet',
  toNetworkKey: 'mainnet',
}));
const mockGetSwapStatus = jest.fn(async () => ({ state: 'completed', destTxId: 'dest_sig' }));
const mockIsSwapSupported = jest.fn(() => true);
const mockGetSwapCapabilities = jest.fn(() => ({
  canSwap: true,
  sameChain: false,
  crossChain: true,
  destinationNetworkKeys: ['mainnet'],
}));
const mockIsNetworkSolana = jest.fn((key: string) => key === 'solana-mainnet');

jest.mock('@wallet/wallet', () => ({
  __esModule: true,
  Wallet: class {
    constructor() {}
    createNewWallet() {
      return { address: 'So1AddressTest', mnemonic: 'test mnemonic words' };
    }
    importWallet() {
      return { address: 'So1AddressTest' };
    }
    get mnemonic() {
      return 'test mnemonic words';
    }
    get wallet() {
      return { privateKey: '0xpriv' };
    }
  },
}));

jest.mock('@wallet/app-service', () => ({
  __esModule: true,
  WalletAppService: class {
    constructor() {}
    async initialize() {}
    saveWallet() {}
    loadWallet() {
      return { address: 'So1AddressTest' };
    }
    async loadWalletAsync() {
      return { address: 'So1AddressTest' };
    }
    getAddress() {
      return 'So1AddressTest';
    }
    async setNetwork() {}
    getTokensForNetwork() {
      return [SOL];
    }
    getCurrentAccountIndex() {
      return 0;
    }
    getSwapQuote = mockGetSwapQuote;
    executeSwap = mockExecuteSwap;
    getSwapStatus = mockGetSwapStatus;
    isSwapSupported = mockIsSwapSupported;
    getSwapCapabilities = mockGetSwapCapabilities;
    isNetworkSolana = mockIsNetworkSolana;
  },
}));

jest.mock('@wallet/crypto-utils', () => ({
  __esModule: true,
  setCryptoAdapter: jest.fn(() => {}),
}));

jest.mock('@wallet/price-providers/index', () => ({
  __esModule: true,
  setCoingeckoApiKey: jest.fn(() => {}),
}));

jest.mock('../services/price-service', () => ({
  __esModule: true,
  getTokenPrices: jest.fn(async () => new Map()),
  calculateTotalValue: jest.fn(() => 0),
  getBitcoinPrice: jest.fn(async () => null),
  getSolanaPrice: jest.fn(async () => null),
  getXRPPrice: jest.fn(async () => null),
  getTonPrice: jest.fn(async () => null),
}));

jest.mock('../services/CacheService', () => ({
  __esModule: true,
  cacheService: {
    get: jest.fn(() => null),
    getStale: jest.fn(() => null),
    set: jest.fn(() => {}),
  },
}));

import { walletBridge } from '../services/WalletBridge';

afterAll(async () => {
  jest.useRealTimers();
  await walletBridge.lockWallet();
});

describe('WalletBridge swap (unlocked)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await walletBridge.initialize();
    await walletBridge.createWallet('testpassword', 'test');
  });

  afterEach(async () => {
    await walletBridge.lockWallet();
  });

  test('Solana-source swaps inject the session password', async () => {
    const quote = makeQuote('solana-mainnet');
    const result = await walletBridge.executeSwap(quote as any);

    expect(result.txId).toBe('swap_sig');
    // Session password injected by the bridge — never supplied by the UI.
    expect(mockExecuteSwap).toHaveBeenCalledWith(
      quote,
      expect.objectContaining({ password: 'testpassword' })
    );
  });

  test('EVM-source swaps pass no password (the signer is already unlocked)', async () => {
    const quote = makeQuote('mainnet');
    await walletBridge.executeSwap(quote as any);

    expect(mockExecuteSwap).toHaveBeenCalledWith(
      quote,
      expect.objectContaining({ password: undefined })
    );
  });

  test('progress callbacks are forwarded to the service layer', async () => {
    const phases: string[] = [];
    mockExecuteSwap.mockImplementationOnce(async (_quote: any, options: any) => {
      options.onProgress?.('checking-allowance');
      options.onProgress?.('swap-submitted');
      return { provider: 'oneinch', txId: '0x1', fromNetworkKey: 'mainnet', toNetworkKey: 'mainnet' };
    });

    await walletBridge.executeSwap(makeQuote('mainnet') as any, (phase) => phases.push(phase));
    expect(phases).toEqual(['checking-allowance', 'swap-submitted']);
  });

  test('quote, status, and capabilities pass through', async () => {
    const quote = await walletBridge.getSwapQuote({
      fromNetworkKey: 'solana-mainnet',
      fromToken: SOL as any,
      toNetworkKey: 'mainnet',
      toToken: ETH as any,
      amount: '1',
    });
    expect(quote.provider).toBe('mayan');

    const status = await walletBridge.getSwapStatus({
      provider: 'mayan',
      txId: 'swap_sig',
      fromNetworkKey: 'solana-mainnet',
    });
    expect(status.state).toBe('completed');

    expect(walletBridge.isSwapSupported('solana-mainnet')).toBe(true);
    expect(walletBridge.getSwapCapabilities().destinationNetworkKeys).toEqual(['mainnet']);
  });

  test('getSwapDestTokens is not balance-filtered', () => {
    // You can swap into a token you hold none of, so this must return the
    // network's full token list rather than the sendable-assets subset.
    expect(walletBridge.getSwapDestTokens('solana-mainnet')).toEqual([SOL]);
  });
});

describe('WalletBridge swap (locked invariants)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await walletBridge.initialize();
    await walletBridge.createWallet('testpassword', 'test');
    await walletBridge.lockWallet();
  });

  test('swap methods reject when locked', async () => {
    await expect(walletBridge.executeSwap(makeQuote('mainnet') as any)).rejects.toThrow(/locked/i);
    await expect(
      walletBridge.getSwapQuote({
        fromNetworkKey: 'mainnet',
        fromToken: ETH as any,
        toNetworkKey: 'mainnet',
        toToken: ETH as any,
        amount: '1',
      })
    ).rejects.toThrow(/locked/i);
    await expect(
      walletBridge.getSwapStatus({ provider: 'mayan', txId: 'x', fromNetworkKey: 'mainnet' })
    ).rejects.toThrow(/locked/i);
    expect(mockExecuteSwap).not.toHaveBeenCalled();
  });

  test('isSwapSupported returns false (never throws) when locked', () => {
    // Screens call this during render to gate the affordance — it must not
    // throw on a locked wallet.
    expect(walletBridge.isSwapSupported('mainnet')).toBe(false);
  });
});
