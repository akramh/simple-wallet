import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock config
jest.mock('../config/bundled-config', () => ({
  __esModule: true,
  getBundledConfig: () => ({
    network: 'mainnet',
    networks: {
      mainnet: { name: 'Mainnet', chainId: 1, nativeSymbol: 'ETH', isTestnet: false },
      sepolia: { name: 'Sepolia', chainId: 11155111, nativeSymbol: 'ETH', isTestnet: true },
    },
  }),
  getBundledTokens: () => ({}),
  getCoingeckoApiKey: () => undefined,
  getAlchemyApiKey: () => undefined,
  getHeliusApiKey: () => undefined,
}));

// Mock mobile adapters
jest.mock('../services/MobileStorageAdapter', () => ({
  __esModule: true,
  mobileStorage: {
    initialize: jest.fn(async () => {}),
    readJSON: jest.fn((path, fallback) => fallback || {}),
    writeJSON: jest.fn(() => {}),
  },
}));

jest.mock('../services/MobileCryptoAdapter', () => ({
  __esModule: true,
  mobileCrypto: {},
}));

// Mock shared SDK price service instead of the wrapper
jest.mock('@wallet/price-service.js', () => ({
  __esModule: true,
  getTokenPrices: jest.fn(async () => new Map([['native', 2000]])),
  getTokenPriceBySymbol: jest.fn(async () => 100),
  calculateTotalValue: jest.fn(() => 2000),
  getPriceByNetworkType: jest.fn(async () => 2000),
  getBitcoinPrice: jest.fn(async () => 50000),
  getSolanaPrice: jest.fn(async () => 100),
  getXRPPrice: jest.fn(async () => 0.5),
  getTonPrice: jest.fn(async () => 2),
  isBitcoinNetworkKey: jest.fn(() => false),
  isSolanaNetworkKey: jest.fn(() => false),
  isXRPNetworkKey: jest.fn(() => false),
  isTonNetworkKey: jest.fn(() => false),
  formatUSDValue: jest.fn((v) => `$${v}`),
  clearPriceCache: jest.fn(),
}));

import { walletBridge } from '../services/WalletBridge';

describe('WalletBridge Filtering', () => {
  beforeEach(async () => {
    await walletBridge.initialize();
    // Simulate unlocked state
    (walletBridge as any)._isUnlocked = true;
    (walletBridge as any).service = {
      getAddress: () => '0xabc',
      getTokensForNetwork: () => [],
      getPortfolioForNetwork: jest.fn(async (net) => ([
        { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' }, balance: '1.0' }
      ])),
    };
    (walletBridge as any).config = {
        network: 'mainnet',
        networks: {
            mainnet: { name: 'Mainnet', chainId: 1, nativeSymbol: 'ETH', isTestnet: false },
            sepolia: { name: 'Sepolia', chainId: 11155111, nativeSymbol: 'ETH', isTestnet: true },
        }
    };
  });

  test('getTokenPrices attempts to fetch prices for testnets (Home screen behavior)', async () => {
    // Switch to testnet
    (walletBridge as any).config.network = 'sepolia';
    
    // It should NOT skip calculation, so mock should return value
    const result = await walletBridge.getTokenPrices([{ 
      token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' },
      balance: '1.0',
      isLoading: false,
      lastUpdated: Date.now()
    }]);

    // Should return result from price service (mocked as 2000 total)
    expect(result.totalValue).toBeGreaterThan(0);
  });

  test('getTokenPrices returns value for mainnets', async () => {
    // Switch to mainnet
    (walletBridge as any).config.network = 'mainnet';
    
    const result = await walletBridge.getTokenPrices([{ 
      token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' },
      balance: '1.0',
      isLoading: false,
      lastUpdated: Date.now()
    }]);
    expect(result.totalValue).toBeGreaterThan(0);
  });

  test('getAllNetworkHoldings skips testnets entirely', async () => {
    const spy = jest.spyOn((walletBridge as any).service, 'getPortfolioForNetwork');

    const result = await walletBridge.getAllNetworkHoldings({ enabledNetworks: ['mainnet', 'sepolia'], force: true });

    // Mainnet is fetched; sepolia is excluded at the source.
    expect(spy).toHaveBeenCalledWith('mainnet');
    expect(spy).not.toHaveBeenCalledWith('sepolia');
    expect(result.totalsByNetwork.sepolia).toBeUndefined();
    expect(result.holdings.every((h: any) => h.networkKey !== 'sepolia')).toBe(true);
  });

  test('getAllNetworkHoldings filters unknown tokens (not in registry) but keeps native + registered', async () => {
    const USDC = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    (walletBridge as any).service.getTokensForNetwork = (net: string) =>
      net === 'mainnet'
        ? [
            { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' },
            { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC },
          ]
        : [];

    (walletBridge as any).service.getPortfolioForNetwork = jest.fn(async () => ([
      { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' }, balance: '1.0' },
      { token: { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC }, balance: '500.0' },
      // Unknown ERC-20 (random address): should be filtered.
      { token: { symbol: 'AIRDROP', name: 'Airdrop', type: 'erc20', decimals: 18, address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, balance: '1000.0' },
    ]));

    const result = await walletBridge.getAllNetworkHoldings({ enabledNetworks: ['mainnet'], force: true });

    const symbols = result.holdings.map((h: any) => h.token.symbol).sort();
    expect(symbols).toEqual(['ETH', 'USDC']);
  });

  test('getAllNetworkHoldings registry filter is case-insensitive for EVM addresses', async () => {
    const USDC_LOWER = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const USDC_CHECKSUM = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    (walletBridge as any).service.getTokensForNetwork = () => [
      { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC_CHECKSUM },
    ];
    (walletBridge as any).service.getPortfolioForNetwork = jest.fn(async () => ([
      // Alchemy returns lowercase; registry has checksum.
      { token: { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC_LOWER }, balance: '10' },
    ]));

    const result = await walletBridge.getAllNetworkHoldings({ enabledNetworks: ['mainnet'], force: true });
    expect(result.holdings.map((h: any) => h.token.symbol)).toContain('USDC');
  });

  test('refreshBalances filters unknown tokens but keeps native + registered', async () => {
    const USDC = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    (walletBridge as any).service.getTokensForNetwork = (net: string) =>
      net === 'mainnet'
        ? [
            { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' },
            { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC },
          ]
        : [];
    (walletBridge as any).service.getPortfolioForNetwork = jest.fn(async () => ([
      { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' }, balance: '1.0' },
      { token: { symbol: 'USDC', name: 'USD Coin', type: 'erc20', decimals: 6, address: USDC }, balance: '500.0' },
      { token: { symbol: 'JUNK', name: 'Junk', type: 'erc20', decimals: 18, address: '0x9999999999999999999999999999999999999999' }, balance: '999' },
    ]));

    const balances = await walletBridge.refreshBalances({ force: true });
    const symbols = balances.map((b) => b.token.symbol).sort();
    expect(symbols).toEqual(['ETH', 'USDC']);
  });
});
