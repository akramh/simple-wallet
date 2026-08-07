/**
 * @fileoverview Unit tests for WalletBridge staking passthrough.
 *
 * Verifies the chain-neutral staking methods route to WalletAppService with
 * the in-memory session password injected (the UI never supplies one), the
 * locked-wallet invariant, and the fetch-methods-degrade-to-empty contract.
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
      sepolia: {
        name: 'Sepolia',
        chainId: 11155111,
        nativeSymbol: 'ETH',
      },
    },
  }),
  getBundledTokens: () => ({}),
  getCoingeckoApiKey: () => undefined,
  getAlchemyApiKey: () => undefined,
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

const mockGetStakePositions = jest.fn(async () => [
  {
    networkKey: 'solana-mainnet',
    chain: 'solana',
    positionId: 'StakeAccount111',
    validator: { id: 'Vote111', name: 'Validator A', commissionPercent: 5, apyPercent: 7.2, activatedStakeFormatted: null, delinquent: false },
    amountFormatted: '1.500000000',
    amountBaseUnits: '1500000000',
    totalFormatted: '1.502282880',
    state: 'active',
    activationEpoch: 5,
    currentEpoch: 10,
  },
]);
const mockGetStakeValidators = jest.fn(async () => [
  { id: 'Vote111', name: 'Validator A', commissionPercent: 5, apyPercent: 7.2, activatedStakeFormatted: '123', delinquent: false },
]);
const mockStake = jest.fn(async () => ({ txId: 'stake_sig', positionId: 'StakeAccount111', feeFormatted: '0.000005' }));
const mockUnstake = jest.fn(async () => ({ txId: 'unstake_sig', positionId: 'StakeAccount111', feeFormatted: '0.000005' }));
const mockWithdrawStake = jest.fn(async () => ({ txId: 'withdraw_sig', positionId: 'StakeAccount111', feeFormatted: '0.000005' }));
const mockIsStakingSupported = jest.fn(() => true);
const mockGetStakingCapabilities = jest.fn(() => ({
  canStake: true,
  canUnstake: true,
  canWithdraw: true,
  minStakeFormatted: '0.01',
  activationNote: 'activates at epoch boundary',
  deactivationNote: 'withdraw after epoch boundary',
}));

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
      return [{ symbol: 'SOL', name: 'Solana', type: 'native', decimals: 9 }];
    }
    getCurrentAccountIndex() {
      return 0;
    }
    getStakePositions = mockGetStakePositions;
    getStakeValidators = mockGetStakeValidators;
    stake = mockStake;
    unstake = mockUnstake;
    withdrawStake = mockWithdrawStake;
    isStakingSupported = mockIsStakingSupported;
    getStakingCapabilities = mockGetStakingCapabilities;
    estimateStakeFee = jest.fn(async () => '0.000005000');
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

describe('WalletBridge staking (unlocked)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await walletBridge.initialize();
    await walletBridge.createWallet('testpassword', 'test');
  });

  afterEach(async () => {
    await walletBridge.lockWallet();
  });

  test('stake injects the session password and target network passthrough', async () => {
    const result = await walletBridge.stake('Vote111', '1.5');

    expect(result.txId).toBe('stake_sig');
    expect(result.positionId).toBe('StakeAccount111');
    // Session password injected by the bridge — never supplied by the UI.
    expect(mockStake).toHaveBeenCalledWith('Vote111', '1.5', 'testpassword', undefined);

    await walletBridge.stake('Vote111', '2', 'solana-mainnet');
    expect(mockStake).toHaveBeenLastCalledWith('Vote111', '2', 'testpassword', 'solana-mainnet');
  });

  test('unstake and withdrawStake inject the session password', async () => {
    await walletBridge.unstake('StakeAccount111');
    expect(mockUnstake).toHaveBeenCalledWith('StakeAccount111', 'testpassword', undefined);

    await walletBridge.withdrawStake('StakeAccount111');
    expect(mockWithdrawStake).toHaveBeenCalledWith('StakeAccount111', 'testpassword', undefined);
  });

  test('getStakePositions returns SDK positions', async () => {
    const positions = await walletBridge.getStakePositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].positionId).toBe('StakeAccount111');
    expect(positions[0].state).toBe('active');
    expect(positions[0].activationEpoch).toBe(5);
  });

  test('getStakePositions degrades to empty array on SDK failure', async () => {
    mockGetStakePositions.mockRejectedValueOnce(new Error('rpc down'));
    const positions = await walletBridge.getStakePositions();
    expect(positions).toEqual([]);
  });

  test('getStakeValidators degrades to empty array on SDK failure', async () => {
    mockGetStakeValidators.mockRejectedValueOnce(new Error('rpc down'));
    const validators = await walletBridge.getStakeValidators();
    expect(validators).toEqual([]);
  });

  test('isStakingSupported and capabilities pass through when unlocked', () => {
    expect(walletBridge.isStakingSupported('solana-mainnet')).toBe(true);
    expect(walletBridge.getStakingCapabilities().minStakeFormatted).toBe('0.01');
  });
});

describe('WalletBridge staking (locked invariants)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await walletBridge.initialize();
    await walletBridge.createWallet('testpassword', 'test');
    await walletBridge.lockWallet();
  });

  test('signing and fetch methods reject when locked', async () => {
    await expect(walletBridge.stake('Vote111', '1')).rejects.toThrow(/locked/i);
    await expect(walletBridge.unstake('StakeAccount111')).rejects.toThrow(/locked/i);
    await expect(walletBridge.withdrawStake('StakeAccount111')).rejects.toThrow(/locked/i);
    await expect(walletBridge.getStakePositions()).rejects.toThrow(/locked/i);
    await expect(walletBridge.getStakeValidators()).rejects.toThrow(/locked/i);
    expect(mockStake).not.toHaveBeenCalled();
  });

  test('isStakingSupported returns false (never throws) when locked', () => {
    expect(walletBridge.isStakingSupported('solana-mainnet')).toBe(false);
  });
});
