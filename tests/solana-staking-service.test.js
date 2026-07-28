/**
 * @file solana-staking-service.test.js
 * @description WalletAppService staking API tests: chain-neutral dispatch
 * (isStakingSupported / stake / unstake / withdrawStake), the Solana
 * implementation (positions mapping, validator merge, stake lifecycle
 * guards, seed-collision handling), the Stakewiz degradation invariant, and
 * the devnet no-USD policy.
 *
 * Hermetic: the Solana provider is replaced with an in-memory mock at the
 * service layer (same idiom as send-cross-network.test.js); Stakewiz is
 * either overridden or exercised through a stubbed global fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';
import { deriveStakeAccountAddress } from '../dist/solana/index.js';
import { PublicKey } from '@solana/web3.js';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const VOTE_PUBKEY = '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on';
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';

function buildConfig(network = 'solana-mainnet') {
  return {
    network,
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.mainnet.example', nativeSymbol: 'ETH', nativeName: 'Ether' },
      polygon: { chainId: 137, rpcUrl: 'https://rpc.polygon.example', nativeSymbol: 'POL', nativeName: 'Polygon' },
      'solana-mainnet': { type: 'solana', rpcUrl: 'https://sol.example', nativeSymbol: 'SOL', nativeName: 'Solana' },
      'solana-devnet': { type: 'solana', rpcUrl: 'https://sol-devnet.example', nativeSymbol: 'SOL', nativeName: 'Solana Devnet', isTestnet: true },
      'bitcoin-mainnet': { type: 'bitcoin', rpcUrl: 'https://btc.example', nativeSymbol: 'BTC', nativeName: 'Bitcoin', btcNetwork: 'mainnet' },
      'xrp-mainnet': { type: 'xrp', rpcUrl: 'https://xrp.example', nativeSymbol: 'XRP', nativeName: 'XRP' },
      'ton-mainnet': { type: 'ton', rpcUrl: 'https://ton.example', nativeSymbol: 'TON', nativeName: 'TON', tonNetwork: 'mainnet' },
    },
  };
}

function delegatedFixture(stakeAccountAddress, withdrawer, { activationEpoch = '5', deactivationEpoch = '18446744073709551615' } = {}) {
  return {
    pubkey: stakeAccountAddress,
    account: {
      lamports: 1_502_282_880,
      data: {
        program: 'stake',
        parsed: {
          type: 'delegated',
          info: {
            meta: {
              rentExemptReserve: '2282880',
              authorized: { staker: withdrawer, withdrawer },
            },
            stake: {
              delegation: {
                voter: VOTE_PUBKEY,
                stake: '1500000000',
                activationEpoch,
                deactivationEpoch,
              },
            },
          },
        },
      },
    },
  };
}

function makeStakeProvider(networkKey, overrides = {}) {
  const calls = [];
  return {
    calls,
    getNetworkKey: () => networkKey,
    async getParsedStakeAccountsByWithdrawer(withdrawer) {
      calls.push({ op: 'scan', withdrawer });
      return [];
    },
    async getEpochInfo() { return { epoch: 10, slotIndex: 0, slotsInEpoch: 432000 }; },
    async getInflationRewardLamports(addresses) { return addresses.map(() => null); },
    async getVoteAccountsSummary() { return []; },
    async getStakeRentExemptLamports() { return 2_282_880; },
    async accountExists() { return false; },
    async estimateFee() {
      return { feeLamports: 5000, feeSol: '0.000005000', baseFeeLamports: 5000, priorityFeeLamports: 0, priorityFeeMicroLamports: 0, computeUnitLimit: 0 };
    },
    async getBalanceLamports() { return 10_000_000_000; },
    async getRecentBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 100 }; },
    async sendTransaction(serialized) {
      calls.push({ op: 'send', bytes: serialized.length });
      return { signature: 'stake-sig' };
    },
    ...overrides,
  };
}

async function buildService(network = 'solana-mainnet', { providerOverrides = {}, stakewizMap = new Map() } = {}) {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig(network);
  const factory = { createProvider: () => ({ async getBlockNumber() { return 1; } }) };
  const wallet = new Wallet(config, storage, factory);
  await wallet.initialize();
  wallet.importWallet(TEST_MNEMONIC, 'pw', 0);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory: factory });
  await svc.initialize();

  const provider = makeStakeProvider(network, providerOverrides);
  svc.getSolanaProviderForNetwork = () => provider;
  // Keep metadata + price hermetic by default; individual tests override.
  svc.getStakewizMap = async () => stakewizMap;
  svc.getSolUsdPrice = async () => null;

  const solAddress = wallet.getSolanaAddress(0).address;
  return { svc, wallet, config, provider, solAddress };
}

// ---------------------------------------------------------------------------
// Chain-neutral dispatch
// ---------------------------------------------------------------------------

test('isStakingSupported: true only for Solana networks', async () => {
  const { svc } = await buildService();
  assert.equal(svc.isStakingSupported('solana-mainnet'), true);
  assert.equal(svc.isStakingSupported('solana-devnet'), true);
  assert.equal(svc.isStakingSupported('mainnet'), false);
  assert.equal(svc.isStakingSupported('polygon'), false);
  assert.equal(svc.isStakingSupported('bitcoin-mainnet'), false);
  assert.equal(svc.isStakingSupported('xrp-mainnet'), false);
  assert.equal(svc.isStakingSupported('ton-mainnet'), false);
  assert.equal(svc.isStakingSupported('nope'), false);
});

test('generic staking methods reject unsupported networks with a clear error', async () => {
  const { svc } = await buildService();
  await assert.rejects(() => svc.stake(VOTE_PUBKEY, '1', 'pw', 'polygon'), /Staking is not supported on polygon/);
  await assert.rejects(() => svc.unstake('addr', 'pw', 'mainnet'), /Staking is not supported on mainnet/);
  await assert.rejects(() => svc.withdrawStake('addr', 'pw', 'bitcoin-mainnet'), /Staking is not supported/);
  await assert.rejects(() => svc.getStakePositions('ton-mainnet'), /Staking is not supported/);
  await assert.rejects(() => svc.getStakeValidators('xrp-mainnet'), /Staking is not supported/);
  assert.throws(() => svc.getStakingCapabilities('polygon'), /Staking is not supported/);
});

test('getStakingCapabilities returns Solana semantics', async () => {
  const { svc } = await buildService();
  const caps = svc.getStakingCapabilities('solana-mainnet');
  assert.equal(caps.canStake, true);
  assert.equal(caps.canUnstake, true);
  assert.equal(caps.canWithdraw, true);
  assert.equal(caps.minStakeFormatted, '0.01');
  assert.match(caps.activationNote, /epoch boundary/);
  assert.match(caps.deactivationNote, /withdrawable/);
});

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

test('getStakePositions maps parsed accounts to chain-neutral views', async () => {
  const stakewizMap = new Map([[VOTE_PUBKEY, { votePubkey: VOTE_PUBKEY, name: 'Validator A', apyPercent: 7.2, rank: 1, commissionPercent: 5 }]]);
  const { svc, solAddress, provider } = await buildService('solana-mainnet', { stakewizMap });
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture('4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z', solAddress),
  ];
  svc.getSolUsdPrice = async () => 100;

  const positions = await svc.getStakePositions('solana-mainnet');
  assert.equal(positions.length, 1);
  const p = positions[0];
  assert.equal(p.networkKey, 'solana-mainnet');
  assert.equal(p.chain, 'solana');
  assert.equal(p.positionId, '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z');
  assert.equal(p.state, 'active');
  assert.equal(p.validator.id, VOTE_PUBKEY);
  assert.equal(p.validator.name, 'Validator A');
  assert.equal(p.validator.apyPercent, 7.2);
  assert.equal(p.amountFormatted, '1.500000000');
  assert.equal(p.amountBaseUnits, '1500000000');
  assert.equal(p.reserveFormatted, '0.002282880');
  assert.equal(p.totalFormatted, '1.502282880');
  // 1.50228288 SOL × $100
  assert.ok(Math.abs(p.usdValue - 150.22828) < 0.01);
});

test('getStakePositions: devnet positions never carry USD values', async () => {
  const { svc, solAddress, provider } = await buildService('solana-devnet');
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture('4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z', solAddress),
  ];
  // Restore the real price gate (isTestnet short-circuits before any fetch).
  delete svc.getSolUsdPrice;

  const positions = await svc.getStakePositions('solana-devnet');
  assert.equal(positions.length, 1);
  assert.equal(positions[0].usdValue, undefined);
});

test('getStakePositions succeeds with null names when Stakewiz is down (degradation)', async () => {
  const { svc, solAddress, provider } = await buildService('solana-mainnet');
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture('4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z', solAddress),
  ];
  // Exercise the real getStakewizMap path with an unreachable network.
  delete svc.getStakewizMap;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network unreachable'); };
  try {
    const positions = await svc.getStakePositions('solana-mainnet');
    assert.equal(positions.length, 1);
    assert.equal(positions[0].validator.name, null);
    assert.equal(positions[0].validator.id, VOTE_PUBKEY);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getStakePositions: rewards RPC failure is soft', async () => {
  const { svc, solAddress, provider } = await buildService('solana-mainnet');
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture('4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z', solAddress),
  ];
  provider.getInflationRewardLamports = async () => { throw new Error('unsupported'); };

  const positions = await svc.getStakePositions('solana-mainnet');
  assert.equal(positions.length, 1);
  assert.equal(positions[0].lastRewardFormatted, undefined);
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

test('getStakeValidators merges Stakewiz metadata and sorts sensibly', async () => {
  const stakewizMap = new Map([
    ['vote-ranked-2', { votePubkey: 'vote-ranked-2', name: 'Second', apyPercent: 7.0, rank: 2, commissionPercent: 5 }],
    ['vote-ranked-1', { votePubkey: 'vote-ranked-1', name: 'First', apyPercent: 7.5, rank: 1, commissionPercent: 0 }],
  ]);
  const { svc, provider } = await buildService('solana-mainnet', { stakewizMap });
  provider.getVoteAccountsSummary = async () => [
    { votePubkey: 'vote-unranked', commission: 10, activatedStakeLamports: 9_000_000_000_000, delinquent: false },
    { votePubkey: 'vote-ranked-2', commission: 5, activatedStakeLamports: 2_000_000_000_000, delinquent: false },
    { votePubkey: 'vote-delinquent', commission: 0, activatedStakeLamports: 8_000_000_000_000, delinquent: true },
    { votePubkey: 'vote-ranked-1', commission: 0, activatedStakeLamports: 1_000_000_000_000, delinquent: false },
  ];

  const validators = await svc.getStakeValidators('solana-mainnet', 3);
  assert.equal(validators.length, 3);
  // Ranked validators first (rank asc), then unranked by stake; delinquent
  // fell off the limited list entirely.
  assert.deepEqual(validators.map((v) => v.id), ['vote-ranked-1', 'vote-ranked-2', 'vote-unranked']);
  assert.equal(validators[0].name, 'First');
  assert.equal(validators[0].apyPercent, 7.5);
  assert.equal(validators[2].name, null);
  assert.ok(!validators.some((v) => v.delinquent));
  // The internal sort key must not leak into the chain-neutral shape.
  assert.equal('rank' in validators[0], false);
});

// ---------------------------------------------------------------------------
// Stake
// ---------------------------------------------------------------------------

test('stake: happy path funds amount + rent and returns the derived position id', async () => {
  const { svc, provider, solAddress } = await buildService();
  const result = await svc.stake(VOTE_PUBKEY, '1.5', 'pw', 'solana-mainnet');

  assert.equal(result.txId, 'stake-sig');
  assert.equal(result.feeFormatted, '0.000005000');
  const expected = await deriveStakeAccountAddress(new PublicKey(solAddress), 'stake:0');
  assert.equal(result.positionId, expected.toBase58());
  assert.ok(provider.calls.some((c) => c.op === 'send'));
});

test('stake: seed collision advances to the next free index', async () => {
  const { svc, provider, solAddress } = await buildService();
  const taken = (await deriveStakeAccountAddress(new PublicKey(solAddress), 'stake:0')).toBase58();
  provider.accountExists = async (address) => address === taken;

  const result = await svc.stake(VOTE_PUBKEY, '1', 'pw', 'solana-mainnet');
  const expected = await deriveStakeAccountAddress(new PublicKey(solAddress), 'stake:1');
  assert.equal(result.positionId, expected.toBase58());
});

test('stake: enforces the minimum stake', async () => {
  const { svc } = await buildService();
  await assert.rejects(() => svc.stake(VOTE_PUBKEY, '0.001', 'pw', 'solana-mainnet'), /Minimum stake is 0.010000000 SOL/);
});

test('stake: rejects insufficient balance including rent + fee', async () => {
  const { svc, provider } = await buildService();
  provider.getBalanceLamports = async () => 1_000_000_000; // 1 SOL

  await assert.rejects(() => svc.stake(VOTE_PUBKEY, '1', 'pw', 'solana-mainnet'), /Insufficient SOL balance/);
});

test('stake: rejects an invalid vote address', async () => {
  const { svc } = await buildService();
  await assert.rejects(() => svc.stake('not-base58!!', '1', 'pw', 'solana-mainnet'), /Invalid validator vote address/);
});

test('stake: refused for non-Solana private-key wallets', async () => {
  const { svc, wallet } = await buildService();
  wallet.importType = 'privateKey';
  wallet.privateKeyType = 'evm';

  await assert.rejects(() => svc.stake(VOTE_PUBKEY, '1', 'pw', 'solana-mainnet'), /does not support Solana staking/);
});

// ---------------------------------------------------------------------------
// Unstake / withdraw lifecycle guards
// ---------------------------------------------------------------------------

const POSITION_ADDR = '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z';

test('unstake: succeeds for an active position', async () => {
  const { svc, provider, solAddress } = await buildService();
  provider.getParsedStakeAccountsByWithdrawer = async () => [delegatedFixture(POSITION_ADDR, solAddress)];

  const result = await svc.unstake(POSITION_ADDR, 'pw', 'solana-mainnet');
  assert.equal(result.txId, 'stake-sig');
  assert.equal(result.positionId, POSITION_ADDR);
});

test('unstake: rejected for a withdrawable position', async () => {
  const { svc, provider, solAddress } = await buildService();
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture(POSITION_ADDR, solAddress, { deactivationEpoch: '8' }),
  ];

  await assert.rejects(() => svc.unstake(POSITION_ADDR, 'pw', 'solana-mainnet'), /Cannot unstake a position in state 'withdrawable'/);
});

test('withdraw: rejected while the position is still active or deactivating', async () => {
  const { svc, provider, solAddress } = await buildService();
  provider.getParsedStakeAccountsByWithdrawer = async () => [delegatedFixture(POSITION_ADDR, solAddress)];
  await assert.rejects(() => svc.withdrawStake(POSITION_ADDR, 'pw', 'solana-mainnet'), /not withdrawable yet \(state: 'active'\)/);

  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture(POSITION_ADDR, solAddress, { deactivationEpoch: '10' }),
  ];
  await assert.rejects(() => svc.withdrawStake(POSITION_ADDR, 'pw', 'solana-mainnet'), /state: 'deactivating'/);
});

test('withdraw: succeeds once the position is withdrawable', async () => {
  const { svc, provider, solAddress } = await buildService();
  provider.getParsedStakeAccountsByWithdrawer = async () => [
    delegatedFixture(POSITION_ADDR, solAddress, { deactivationEpoch: '8' }),
  ];

  const result = await svc.withdrawStake(POSITION_ADDR, 'pw', 'solana-mainnet');
  assert.equal(result.txId, 'stake-sig');
  assert.ok(provider.calls.some((c) => c.op === 'send'));
});

test('unstake/withdraw: foreign stake accounts are rejected (ownership via withdrawer scan)', async () => {
  const { svc, provider } = await buildService();
  provider.getParsedStakeAccountsByWithdrawer = async () => []; // wallet owns nothing

  await assert.rejects(() => svc.unstake(POSITION_ADDR, 'pw', 'solana-mainnet'), /Stake account not found for this wallet/);
  await assert.rejects(() => svc.withdrawStake(POSITION_ADDR, 'pw', 'solana-mainnet'), /Stake account not found for this wallet/);
});
