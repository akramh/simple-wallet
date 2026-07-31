/**
 * @file stake-menu.test.js
 * @description CLI staking flow smoke tests using the prompt-queue idiom
 * from menu.test.js: stakeMenu renders positions and dispatches stake /
 * unstake / withdraw through the chain-neutral WalletAppService API, gating
 * choices on position state. All service methods are monkeypatched; global
 * fetch is stubbed to fail so price lookups degrade — no network traffic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import inquirer from 'inquirer';

process.env.NODE_ENV = 'test';

const app = await import('../dist/index.js');

function withPromptQueue(queue, fn) {
  const originalPrompt = inquirer.prompt;
  inquirer.prompt = async () => queue.shift() || {};
  return fn().finally(() => { inquirer.prompt = originalPrompt; });
}

const VOTE = '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on';
const POSITION = '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z';

function position(state, overrides = {}) {
  return {
    networkKey: 'solana-mainnet',
    chain: 'solana',
    positionId: POSITION,
    validator: { id: VOTE, name: 'Validator A', commissionPercent: 5, apyPercent: 7.2, activatedStakeFormatted: null, delinquent: false },
    amountFormatted: '1.500000000',
    amountBaseUnits: '1500000000',
    reserveFormatted: '0.002282880',
    totalFormatted: '1.502282880',
    state,
    ...overrides,
  };
}

function useSolanaNetwork() {
  app.config.network = 'solana-mainnet';
  app.wallet.config.network = 'solana-mainnet';
  app.wallet.getAddress = () => 'So1anaAddre55111111111111111111111111111111';
  app.walletService.getAddress = () => 'So1anaAddre55111111111111111111111111111111';
  app.wallet.currentAccountIndex = 0;
}

function stubFetchFailure(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  return fn().finally(() => { globalThis.fetch = originalFetch; });
}

test('stakeMenu: empty positions + Back resolves without error', async () => {
  useSolanaNetwork();
  app.walletService.getStakePositions = async () => [];

  await withPromptQueue([{ action: 'back' }], () => app.stakeMenu('TestWallet'));
});

test('stakeMenu: stake flow drives walletService.stake with picked validator and amount', async () => {
  useSolanaNetwork();
  const calls = [];
  app.walletService.getStakePositions = async () => [];
  app.walletService.getStakeValidators = async () => [
    { id: VOTE, name: 'Validator A', commissionPercent: 5, apyPercent: 7.2, activatedStakeFormatted: '430,800', delinquent: false },
  ];
  app.walletService.estimateStakeFee = async () => '0.000005000';
  app.walletService.stake = async (validatorId, amount, password) => {
    calls.push({ validatorId, amount, password });
    return { txId: 'stake-sig', positionId: POSITION, feeFormatted: '0.000005000' };
  };

  const prompts = [
    { action: 'stake_new' },
    { votePubkey: VOTE },
    { amount: '1.5' },
    { confirm: true },
    { password: 'password123' },
    { continue: '' },
  ];

  await stubFetchFailure(() => withPromptQueue(prompts, () => app.stakeMenu('TestWallet')));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].validatorId, VOTE);
  assert.equal(calls[0].amount, '1.5');
  assert.equal(calls[0].password, 'password123');
});

test('stakeMenu: manual vote-address entry path reaches walletService.stake', async () => {
  useSolanaNetwork();
  const calls = [];
  app.walletService.getStakePositions = async () => [];
  app.walletService.getStakeValidators = async () => [];
  app.walletService.estimateStakeFee = async () => '0.000005000';
  app.walletService.stake = async (validatorId, amount) => {
    calls.push({ validatorId, amount });
    return { txId: 'sig-manual', positionId: POSITION, feeFormatted: '0.000005000' };
  };

  const prompts = [
    { action: 'stake_new' },
    { votePubkey: '__manual__' },
    { manualVote: VOTE },
    { amount: '2' },
    { confirm: true },
    // masterPassword is cached module state after the previous test — no
    // password prompt fires here.
    { continue: '' },
  ];

  await stubFetchFailure(() => withPromptQueue(prompts, () => app.stakeMenu('TestWallet')));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].validatorId, VOTE);
  assert.equal(calls[0].amount, '2');
});

test('stakeMenu: unstake action is offered for active positions and dispatches', async () => {
  useSolanaNetwork();
  const calls = [];
  app.walletService.getStakePositions = async () => [position('active')];
  app.walletService.unstake = async (positionId) => {
    calls.push({ positionId });
    return { txId: 'unstake-sig', positionId, feeFormatted: '0.000005000' };
  };

  const prompts = [
    { action: 'unstake:0' },
    { confirm: true },
    { continue: '' },
  ];

  await withPromptQueue(prompts, () => app.stakeMenu('TestWallet'));
  assert.deepEqual(calls, [{ positionId: POSITION }]);
});

test('stakeMenu: withdraw action is offered for withdrawable positions and dispatches', async () => {
  useSolanaNetwork();
  const calls = [];
  app.walletService.getStakePositions = async () => [position('withdrawable')];
  app.walletService.withdrawStake = async (positionId) => {
    calls.push({ positionId });
    return { txId: 'withdraw-sig', positionId, feeFormatted: '0.000005000' };
  };

  const prompts = [
    { action: 'withdraw:0' },
    { confirm: true },
    { continue: '' },
  ];

  await withPromptQueue(prompts, () => app.stakeMenu('TestWallet'));
  assert.deepEqual(calls, [{ positionId: POSITION }]);
});

test('stakeMenu: deactivating positions offer neither unstake nor withdraw', async () => {
  useSolanaNetwork();
  app.walletService.getStakePositions = async () => [position('deactivating')];

  let capturedChoices = null;
  const originalPrompt = inquirer.prompt;
  inquirer.prompt = async (questions) => {
    const q = Array.isArray(questions) ? questions[0] : questions;
    if (q.name === 'action') {
      capturedChoices = q.choices;
      return { action: 'back' };
    }
    return {};
  };
  try {
    await app.stakeMenu('TestWallet');
  } finally {
    inquirer.prompt = originalPrompt;
  }

  assert.ok(capturedChoices, 'staking menu should have rendered');
  const values = capturedChoices.map((c) => c.value);
  assert.ok(values.includes('stake_new'));
  assert.ok(values.includes('back'));
  assert.ok(!values.some((v) => typeof v === 'string' && (v.startsWith('unstake:') || v.startsWith('withdraw:'))));
});

test('stakeMenu: positions load failure shows the error and returns cleanly', async () => {
  useSolanaNetwork();
  app.walletService.getStakePositions = async () => { throw new Error('all RPC endpoints failed'); };

  await withPromptQueue([{ continue: '' }], () => app.stakeMenu('TestWallet'));
});
