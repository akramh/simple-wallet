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

  test('getAllNetworkHoldings fetches testnets (for visibility)', async () => {
    const spy = jest.spyOn((walletBridge as any).service, 'getPortfolioForNetwork');
    
    await walletBridge.getAllNetworkHoldings({ enabledNetworks: ['mainnet', 'sepolia'], force: true });
    
    // Should be called for both (visibility required)
    expect(spy).toHaveBeenCalledWith('mainnet');
    expect(spy).toHaveBeenCalledWith('sepolia');
  });

  test('getAllNetworkHoldings filters out test tokens', async () => {
    (walletBridge as any).service.getPortfolioForNetwork = jest.fn(async () => ([
      { token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' }, balance: '1.0' },
      { token: { symbol: 'TST', name: 'Test Token', type: 'erc20', decimals: 18, address: '0x123' }, balance: '100.0' },
      { token: { symbol: 'DUM', name: 'Dummy', type: 'erc20', decimals: 18, address: '0x456' }, balance: '50.0' }
    ]));

    const result = await walletBridge.getAllNetworkHoldings({ enabledNetworks: ['mainnet'], force: true });
    
    // Should only have ETH
    expect(result.holdings.length).toBe(1);
    expect(result.holdings[0].token.symbol).toBe('ETH');
  });
});
