/**
 * @file swap-routing.test.js
 * @description Invariant tests for swap routing and capabilities — same-EVM
 *   pairs route to 1inch, distinct Mayan-served pairs route to Mayan, and
 *   everything else (Solana↔Solana, BTC/XRP/TON, testnets, unknown networks)
 *   is rejected with a reason. Also locks the provider address-mapping
 *   sentinels and the missing-ONEINCH_API_KEY capability degradation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ONEINCH_NETWORKS,
  MAYAN_NETWORKS,
  ONEINCH_NATIVE_ADDRESS,
  MAYAN_NATIVE_ADDRESS,
  toOneInchAddress,
  toMayanAddress,
  classifySwapPair,
} from '../dist/swap/chains.js';
import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

function buildConfig(network = 'mainnet') {
  return {
    network,
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.mainnet.example', nativeSymbol: 'ETH', nativeName: 'Ether' },
      sepolia: { chainId: 11155111, rpcUrl: 'https://rpc.sepolia.example', nativeSymbol: 'ETH', nativeName: 'Sepolia Ether', isTestnet: true },
      polygon: { chainId: 137, rpcUrl: 'https://rpc.polygon.example', nativeSymbol: 'POL', nativeName: 'Polygon' },
      linea: { chainId: 59144, rpcUrl: 'https://rpc.linea.example', nativeSymbol: 'ETH', nativeName: 'Linea Ether' },
      'solana-mainnet': { type: 'solana', rpcUrl: 'https://sol.example', nativeSymbol: 'SOL', nativeName: 'Solana' },
      'solana-devnet': { type: 'solana', rpcUrl: 'https://sol-devnet.example', nativeSymbol: 'SOL', nativeName: 'Solana Devnet', isTestnet: true },
      'bitcoin-mainnet': { type: 'bitcoin', rpcUrl: 'https://btc.example', nativeSymbol: 'BTC', nativeName: 'Bitcoin', btcNetwork: 'mainnet' },
      'xrp-mainnet': { type: 'xrp', rpcUrl: 'https://xrp.example', nativeSymbol: 'XRP', nativeName: 'XRP' },
      'ton-mainnet': { type: 'ton', rpcUrl: 'https://ton.example', nativeSymbol: 'TON', nativeName: 'TON', tonNetwork: 'mainnet' },
    },
  };
}

async function buildService(network = 'mainnet', { swapClients } = {}) {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig(network);
  const factory = { createProvider: () => ({ async getBlockNumber() { return 1; } }) };
  const wallet = new Wallet(config, storage, factory);
  await wallet.initialize();
  wallet.importWallet(TEST_MNEMONIC, 'pw', 0);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: factory, swapClients });
  await svc.initialize();
  return { svc, wallet, config };
}

/** A 1inch client stand-in — presence alone enables same-chain capability. */
const fakeOneInch = {};

// ---------------------------------------------------------------------------
// classifySwapPair
// ---------------------------------------------------------------------------

test('same EVM network routes to 1inch with its chain id', () => {
  const config = buildConfig();
  assert.deepEqual(classifySwapPair('mainnet', 'mainnet', config), { kind: 'same-evm', chainId: 1 });
  assert.deepEqual(classifySwapPair('polygon', 'polygon', config), { kind: 'same-evm', chainId: 137 });
});

test('distinct Mayan-served networks route to Mayan', () => {
  const config = buildConfig();
  assert.deepEqual(classifySwapPair('mainnet', 'polygon', config), { kind: 'cross-chain' });
  assert.deepEqual(classifySwapPair('mainnet', 'solana-mainnet', config), { kind: 'cross-chain' });
  assert.deepEqual(classifySwapPair('solana-mainnet', 'mainnet', config), { kind: 'cross-chain' });
});

test('Solana↔Solana is unsupported (needs Jupiter — future work)', () => {
  const result = classifySwapPair('solana-mainnet', 'solana-mainnet', buildConfig());
  assert.equal(result.kind, 'unsupported');
  assert.match(result.reason, /Solana/i);
});

test('Bitcoin, XRP, and TON legs are unsupported', () => {
  const config = buildConfig();
  for (const key of ['bitcoin-mainnet', 'xrp-mainnet', 'ton-mainnet']) {
    assert.equal(classifySwapPair(key, 'mainnet', config).kind, 'unsupported', `${key} as source`);
    assert.equal(classifySwapPair('mainnet', key, config).kind, 'unsupported', `${key} as destination`);
  }
});

test('testnet legs are unsupported', () => {
  const config = buildConfig();
  assert.equal(classifySwapPair('sepolia', 'sepolia', config).kind, 'unsupported');
  assert.equal(classifySwapPair('mainnet', 'solana-devnet', config).kind, 'unsupported');
});

test('unknown networks are unsupported with a clear reason', () => {
  const result = classifySwapPair('mainnet', 'nope', buildConfig());
  assert.equal(result.kind, 'unsupported');
  assert.match(result.reason, /Unknown network/i);
});

// ---------------------------------------------------------------------------
// Address mapping
// ---------------------------------------------------------------------------

test('native tokens map to each provider sentinel; others pass through', () => {
  const native = { symbol: 'ETH', name: 'Ether', type: 'native', address: '', decimals: 18 };
  const erc20 = { symbol: 'USDC', name: 'USD Coin', type: 'erc20', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 };
  const spl = { symbol: 'USDC', name: 'USD Coin', type: 'spl', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 };

  assert.equal(toOneInchAddress(native), ONEINCH_NATIVE_ADDRESS);
  assert.equal(toOneInchAddress(erc20), erc20.address);
  assert.equal(toMayanAddress(native), MAYAN_NATIVE_ADDRESS);
  assert.equal(toMayanAddress(erc20), erc20.address);
  // SPL mints are case-sensitive and must never be normalized.
  assert.equal(toMayanAddress(spl), spl.address);
});

test('support matrices cover the expected networks', () => {
  assert.equal(ONEINCH_NETWORKS.mainnet, 1);
  assert.equal(ONEINCH_NETWORKS.linea, 59144);
  assert.ok(!('sepolia' in ONEINCH_NETWORKS), 'no testnets in the 1inch matrix');
  assert.ok(!('solana-mainnet' in ONEINCH_NETWORKS), 'no Solana in the 1inch matrix');
  assert.equal(MAYAN_NETWORKS['solana-mainnet'], 'solana');
  assert.equal(MAYAN_NETWORKS.mainnet, 'ethereum');
  assert.ok(!('bitcoin-mainnet' in MAYAN_NETWORKS));
});

// ---------------------------------------------------------------------------
// WalletAppService capabilities
// ---------------------------------------------------------------------------

test('capabilities on an EVM mainnet with a 1inch client: both kinds, self first', async () => {
  const { svc } = await buildService('mainnet', { swapClients: { oneinch: fakeOneInch } });
  const caps = svc.getSwapCapabilities();
  assert.equal(caps.canSwap, true);
  assert.equal(caps.sameChain, true);
  assert.equal(caps.crossChain, true);
  assert.equal(caps.destinationNetworkKeys[0], 'mainnet', 'self is the first destination');
  assert.ok(caps.destinationNetworkKeys.includes('polygon'));
  assert.ok(caps.destinationNetworkKeys.includes('solana-mainnet'));
  assert.ok(!caps.destinationNetworkKeys.includes('sepolia'), 'testnets never appear');
  assert.ok(!caps.destinationNetworkKeys.includes('bitcoin-mainnet'));
});

test('capabilities degrade without a 1inch key: cross-chain only, with reason', async () => {
  const hadKey = process.env.ONEINCH_API_KEY;
  const hadViteKey = process.env.VITE_ONEINCH_API_KEY;
  delete process.env.ONEINCH_API_KEY;
  delete process.env.VITE_ONEINCH_API_KEY;
  try {
    const { svc } = await buildService('mainnet');
    const caps = svc.getSwapCapabilities();
    assert.equal(caps.canSwap, true, 'cross-chain still works');
    assert.equal(caps.sameChain, false);
    assert.equal(caps.crossChain, true);
    assert.match(caps.unsupportedReason, /ONEINCH_API_KEY/);
    assert.ok(!caps.destinationNetworkKeys.includes('mainnet'), 'self excluded without same-chain');
  } finally {
    if (hadKey !== undefined) process.env.ONEINCH_API_KEY = hadKey;
    if (hadViteKey !== undefined) process.env.VITE_ONEINCH_API_KEY = hadViteKey;
  }
});

test('capabilities on Solana mainnet: cross-chain only, no self destination', async () => {
  const { svc } = await buildService('solana-mainnet', { swapClients: { oneinch: fakeOneInch } });
  const caps = svc.getSwapCapabilities();
  assert.equal(caps.canSwap, true);
  assert.equal(caps.sameChain, false, 'no same-chain Solana swaps');
  assert.equal(caps.crossChain, true);
  assert.ok(!caps.destinationNetworkKeys.includes('solana-mainnet'));
  assert.ok(caps.destinationNetworkKeys.includes('mainnet'));
});

test('unsupported chains and testnets are gated off entirely', async () => {
  const { svc } = await buildService('mainnet', { swapClients: { oneinch: fakeOneInch } });
  for (const key of ['bitcoin-mainnet', 'xrp-mainnet', 'ton-mainnet', 'sepolia', 'solana-devnet']) {
    const caps = svc.getSwapCapabilities(key);
    assert.equal(caps.canSwap, false, `${key} must not swap`);
    assert.equal(caps.destinationNetworkKeys.length, 0);
    assert.ok(caps.unsupportedReason, `${key} carries a reason`);
    assert.equal(svc.isSwapSupported(key), false);
  }
});

test('destination networks absent from config are omitted', async () => {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig('mainnet');
  delete config.networks.polygon;
  const factory = { createProvider: () => ({ async getBlockNumber() { return 1; } }) };
  const wallet = new Wallet(config, storage, factory);
  await wallet.initialize();
  wallet.importWallet(TEST_MNEMONIC, 'pw', 0);
  const svc = new WalletAppService(wallet, config, {
    storage, providerFactory: factory, swapClients: { oneinch: fakeOneInch },
  });
  await svc.initialize();

  const caps = svc.getSwapCapabilities();
  assert.ok(!caps.destinationNetworkKeys.includes('polygon'), 'unconfigured networks omitted');
});
