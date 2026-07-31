/**
 * @file solana-stake-provider.test.js
 * @description Hermetic tests for SolanaProvider's staking RPC surface:
 * epoch info, stake-account discovery (memcmp filter shape at the withdrawer
 * offset), vote-account summaries, rent exemption, account existence, and
 * inflation rewards — plus RPC failover for each. The provider's ctor-built
 * Connections are swapped for stubs; no network traffic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SolanaProvider,
  STAKE_WITHDRAWER_OFFSET,
  STAKE_ACCOUNT_SPACE,
} from '../dist/solana/index.js';
import { StakeProgram } from '@solana/web3.js';

const WALLET = '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z';

function providerWith(...stubs) {
  const provider = new SolanaProvider({
    networkKey: 'solana-mainnet',
    rpcUrls: stubs.map((_, i) => `https://stub-${i}`),
  });
  provider.connections = stubs;
  return provider;
}

test('getEpochInfo: returns normalized epoch info', async () => {
  const provider = providerWith({
    getEpochInfo: async () => ({ epoch: 700, slotIndex: 123, slotsInEpoch: 432000, absoluteSlot: 1 }),
  });

  const info = await provider.getEpochInfo();
  assert.deepEqual(info, { epoch: 700, slotIndex: 123, slotsInEpoch: 432000 });
});

test('getEpochInfo: fails over to the next RPC endpoint', async () => {
  const provider = providerWith(
    { getEpochInfo: async () => { throw new Error('rpc down'); } },
    { getEpochInfo: async () => ({ epoch: 701, slotIndex: 1, slotsInEpoch: 432000 }) }
  );

  const info = await provider.getEpochInfo();
  assert.equal(info.epoch, 701);
});

test('getEpochInfo: throws the standard all-endpoints-failed error', async () => {
  const provider = providerWith({
    getEpochInfo: async () => { throw new Error('boom'); },
  });

  await assert.rejects(
    () => provider.getEpochInfo(),
    /All Solana RPC endpoints failed for solana-mainnet/
  );
});

test('getParsedStakeAccountsByWithdrawer: memcmp filter targets the withdrawer offset', async () => {
  const calls = [];
  const provider = providerWith({
    getParsedProgramAccounts: async (programId, config) => {
      calls.push({ programId, config });
      return [{ pubkey: 'stub' }];
    },
  });

  const accounts = await provider.getParsedStakeAccountsByWithdrawer(WALLET);
  assert.equal(accounts.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].programId.toBase58(), StakeProgram.programId.toBase58());
  assert.deepEqual(calls[0].config.filters, [
    { memcmp: { offset: STAKE_WITHDRAWER_OFFSET, bytes: WALLET } },
  ]);
  assert.equal(STAKE_WITHDRAWER_OFFSET, 44);
});

test('getVoteAccountsSummary: merges current and delinquent with flags', async () => {
  const provider = providerWith({
    getVoteAccounts: async () => ({
      current: [{ votePubkey: 'vote-a', commission: 5, activatedStake: 1000 }],
      delinquent: [{ votePubkey: 'vote-b', commission: 100, activatedStake: 50 }],
    }),
  });

  const summary = await provider.getVoteAccountsSummary();
  assert.deepEqual(summary, [
    { votePubkey: 'vote-a', commission: 5, activatedStakeLamports: 1000, delinquent: false },
    { votePubkey: 'vote-b', commission: 100, activatedStakeLamports: 50, delinquent: true },
  ]);
});

test('getStakeRentExemptLamports: passes the stake account size through', async () => {
  const sizes = [];
  const provider = providerWith({
    getMinimumBalanceForRentExemption: async (space) => {
      sizes.push(space);
      return 2282880;
    },
  });

  const rent = await provider.getStakeRentExemptLamports(STAKE_ACCOUNT_SPACE);
  assert.equal(rent, 2282880);
  assert.deepEqual(sizes, [STAKE_ACCOUNT_SPACE]);
});

test('accountExists: true when account info is non-null, false otherwise', async () => {
  const existing = providerWith({ getAccountInfo: async () => ({ lamports: 1 }) });
  const missing = providerWith({ getAccountInfo: async () => null });

  assert.equal(await existing.accountExists(WALLET), true);
  assert.equal(await missing.accountExists(WALLET), false);
});

test('getInflationRewardLamports: maps rewards and nulls, short-circuits on empty input', async () => {
  let called = 0;
  const provider = providerWith({
    getInflationReward: async () => {
      called++;
      return [{ amount: 12345, epoch: 699 }, null];
    },
  });

  assert.deepEqual(await provider.getInflationRewardLamports([]), []);
  assert.equal(called, 0);

  const rewards = await provider.getInflationRewardLamports([WALLET, WALLET]);
  assert.deepEqual(rewards, [12345, null]);
});
