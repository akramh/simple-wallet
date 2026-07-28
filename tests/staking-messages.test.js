/**
 * @file staking-messages.test.js
 * @description Contract tests for the extension's staking message plumbing.
 *
 * The MV3 service worker cannot be imported under Node (chrome.* globals), so
 * following the repo idiom for extension logic (see messaging.test.js /
 * dapp-approval.test.js) the dispatch logic of the STAKE / UNSTAKE /
 * WITHDRAW_STAKE handler is reimplemented here verbatim and tested for its
 * contract: locked-wallet rejection, session-password requirement,
 * unknown-network rejection, and routing to the right WalletAppService
 * method with the payload's networkKey.
 *
 * Keep in sync with extension/background/service-worker.ts (staking cases).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- Reimplementation of the service worker's staking action handler -------
async function handleStakingAction(type, payload, ctx) {
  const { isUnlocked, walletService, getSessionPassword } = ctx;
  if (!isUnlocked) throw new Error('Wallet is locked');
  if (!walletService) throw new Error('Wallet not initialized');

  const stakePassword = getSessionPassword();
  if (!stakePassword) {
    throw new Error('Session password not available. Please unlock wallet again.');
  }

  const stakeNetwork = (payload?.networkKey && typeof payload.networkKey === 'string')
    ? payload.networkKey
    : walletService.config.network;
  const stakeNetConfig = walletService.config.networks[stakeNetwork];
  if (!stakeNetConfig) {
    throw new Error(`Unknown network: ${stakeNetwork}`);
  }

  const result = type === 'STAKE'
    ? await walletService.stake(payload.validatorId, payload.amount, stakePassword, stakeNetwork)
    : type === 'UNSTAKE'
      ? await walletService.unstake(payload.positionId, stakePassword, stakeNetwork)
      : await walletService.withdrawStake(payload.positionId, stakePassword, stakeNetwork);

  return { result };
}
// ---------------------------------------------------------------------------

function makeCtx(overrides = {}) {
  const calls = [];
  return {
    calls,
    isUnlocked: true,
    getSessionPassword: () => 'session-pw',
    walletService: {
      config: {
        network: 'solana-mainnet',
        networks: { 'solana-mainnet': { type: 'solana' }, 'solana-devnet': { type: 'solana' } },
      },
      stake: async (...args) => { calls.push(['stake', ...args]); return { txId: 's', positionId: 'p', feeFormatted: '0' }; },
      unstake: async (...args) => { calls.push(['unstake', ...args]); return { txId: 'u', feeFormatted: '0' }; },
      withdrawStake: async (...args) => { calls.push(['withdrawStake', ...args]); return { txId: 'w', feeFormatted: '0' }; },
    },
    ...overrides,
  };
}

test('staking actions reject when the wallet is locked', async () => {
  const ctx = makeCtx({ isUnlocked: false });
  await assert.rejects(() => handleStakingAction('STAKE', {}, ctx), /Wallet is locked/);
});

test('staking actions reject without a session password', async () => {
  const ctx = makeCtx({ getSessionPassword: () => null });
  await assert.rejects(() => handleStakingAction('UNSTAKE', { positionId: 'p' }, ctx), /Session password not available/);
});

test('staking actions reject an unknown networkKey', async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => handleStakingAction('STAKE', { validatorId: 'v', amount: '1', networkKey: 'nope' }, ctx),
    /Unknown network: nope/
  );
});

test('STAKE routes to walletService.stake with payload networkKey', async () => {
  const ctx = makeCtx();
  const { result } = await handleStakingAction('STAKE', { validatorId: 'vote-a', amount: '1.5', networkKey: 'solana-devnet' }, ctx);
  assert.equal(result.txId, 's');
  assert.deepEqual(ctx.calls, [['stake', 'vote-a', '1.5', 'session-pw', 'solana-devnet']]);
});

test('UNSTAKE and WITHDRAW_STAKE route with the active network by default', async () => {
  const ctx = makeCtx();
  await handleStakingAction('UNSTAKE', { positionId: 'pos-1' }, ctx);
  await handleStakingAction('WITHDRAW_STAKE', { positionId: 'pos-1' }, ctx);
  assert.deepEqual(ctx.calls, [
    ['unstake', 'pos-1', 'session-pw', 'solana-mainnet'],
    ['withdrawStake', 'pos-1', 'session-pw', 'solana-mainnet'],
  ]);
});
