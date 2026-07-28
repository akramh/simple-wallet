/**
 * @file solana-stake.test.js
 * @description Unit tests for the pure Solana staking module
 * (dist/solana/stake.js): seed-derived address determinism, transaction
 * builder instruction contents, signing round-trip, the deriveStakeState
 * truth table (including the u64 "no deactivation" sentinel), and
 * parseStakeAccount over jsonParsed fixtures.
 *
 * All tests are hermetic — no network, no RPC.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAKE_ACCOUNT_SPACE,
  STAKE_SEED_PREFIX,
  EPOCH_U64_SENTINEL,
  deriveStakeAccountAddress,
  buildCreateAndDelegateStakeTx,
  buildDeactivateStakeTx,
  buildWithdrawStakeTx,
  signStakeTx,
  deriveStakeState,
  parseStakeAccount,
} from '../dist/solana/index.js';
import {
  Keypair,
  PublicKey,
  StakeProgram,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';

const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k';
const LAST_VALID = 150;
const VOTE_PUBKEY = new PublicKey('5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on');

function walletKeypair() {
  // Deterministic keypair so derived addresses are stable across runs.
  return Keypair.fromSeed(new Uint8Array(32).fill(7));
}

// ---------------------------------------------------------------------------
// Seed-derived addresses
// ---------------------------------------------------------------------------

test('deriveStakeAccountAddress is deterministic and seed-sensitive', async () => {
  const wallet = walletKeypair().publicKey;
  const a0 = await deriveStakeAccountAddress(wallet, `${STAKE_SEED_PREFIX}0`);
  const a0again = await deriveStakeAccountAddress(wallet, `${STAKE_SEED_PREFIX}0`);
  const a1 = await deriveStakeAccountAddress(wallet, `${STAKE_SEED_PREFIX}1`);

  assert.equal(a0.toBase58(), a0again.toBase58());
  assert.notEqual(a0.toBase58(), a1.toBase58());
});

// ---------------------------------------------------------------------------
// Transaction builders
// ---------------------------------------------------------------------------

test('buildCreateAndDelegateStakeTx: createAccountWithSeed + initialize + delegate', async () => {
  const wallet = walletKeypair().publicKey;
  const stakeAccount = await deriveStakeAccountAddress(wallet, 'stake:0');

  const tx = buildCreateAndDelegateStakeTx({
    walletPubkey: wallet,
    stakeAccountPubkey: stakeAccount,
    seed: 'stake:0',
    lamports: 1_500_000_000,
    votePubkey: VOTE_PUBKEY,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID,
  });

  // No priority fee → exactly the three stake-setup instructions.
  assert.equal(tx.instructions.length, 3);
  assert.equal(tx.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
  assert.equal(tx.instructions[1].programId.toBase58(), StakeProgram.programId.toBase58());
  assert.equal(tx.instructions[2].programId.toBase58(), StakeProgram.programId.toBase58());
  assert.equal(tx.feePayer.toBase58(), wallet.toBase58());

  // The delegate instruction references the stake account and the vote account.
  const delegateKeys = tx.instructions[2].keys.map((k) => k.pubkey.toBase58());
  assert.ok(delegateKeys.includes(stakeAccount.toBase58()));
  assert.ok(delegateKeys.includes(VOTE_PUBKEY.toBase58()));
});

test('buildCreateAndDelegateStakeTx: priority fee prepends compute-budget instructions', async () => {
  const wallet = walletKeypair().publicKey;
  const stakeAccount = await deriveStakeAccountAddress(wallet, 'stake:0');

  const tx = buildCreateAndDelegateStakeTx({
    walletPubkey: wallet,
    stakeAccountPubkey: stakeAccount,
    seed: 'stake:0',
    lamports: 1_000_000_000,
    votePubkey: VOTE_PUBKEY,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID,
    priorityFeeMicroLamports: 1000,
    computeUnitLimit: 20_000,
  });

  assert.equal(tx.instructions.length, 5);
  assert.equal(tx.instructions[0].programId.toBase58(), ComputeBudgetProgram.programId.toBase58());
  assert.equal(tx.instructions[1].programId.toBase58(), ComputeBudgetProgram.programId.toBase58());
});

test('buildCreateAndDelegateStakeTx: rejects non-positive lamports', async () => {
  const wallet = walletKeypair().publicKey;
  const stakeAccount = await deriveStakeAccountAddress(wallet, 'stake:0');
  const base = {
    walletPubkey: wallet,
    stakeAccountPubkey: stakeAccount,
    seed: 'stake:0',
    votePubkey: VOTE_PUBKEY,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID,
  };

  assert.throws(() => buildCreateAndDelegateStakeTx({ ...base, lamports: 0 }), /greater than 0/);
  assert.throws(() => buildCreateAndDelegateStakeTx({ ...base, lamports: -5 }), /greater than 0/);
});

test('buildDeactivateStakeTx and buildWithdrawStakeTx target the stake program', async () => {
  const wallet = walletKeypair().publicKey;
  const stakeAccount = await deriveStakeAccountAddress(wallet, 'stake:0');
  const params = {
    walletPubkey: wallet,
    stakeAccountPubkey: stakeAccount,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID,
  };

  const deactivate = buildDeactivateStakeTx(params);
  assert.equal(deactivate.instructions.length, 1);
  assert.equal(deactivate.instructions[0].programId.toBase58(), StakeProgram.programId.toBase58());

  const withdraw = buildWithdrawStakeTx(params, 2_000_000_000);
  assert.equal(withdraw.instructions.length, 1);
  assert.equal(withdraw.instructions[0].programId.toBase58(), StakeProgram.programId.toBase58());
  const withdrawKeys = withdraw.instructions[0].keys.map((k) => k.pubkey.toBase58());
  assert.ok(withdrawKeys.includes(wallet.toBase58()));

  assert.throws(() => buildWithdrawStakeTx(params, 0), /greater than 0/);
});

test('signStakeTx: single wallet signature produces sendable bytes', async () => {
  const wallet = walletKeypair();
  const stakeAccount = await deriveStakeAccountAddress(wallet.publicKey, 'stake:0');

  const tx = buildCreateAndDelegateStakeTx({
    walletPubkey: wallet.publicKey,
    stakeAccountPubkey: stakeAccount,
    seed: 'stake:0',
    lamports: 1_000_000_000,
    votePubkey: VOTE_PUBKEY,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID,
  });

  const signed = signStakeTx(tx, wallet);
  assert.ok(signed.serialized.length > 0);
  assert.ok(signed.signature.length > 0);
  // createAccountWithSeed requires only the base (wallet) signature — the
  // derived stake account never signs.
  assert.equal(signed.transaction.signatures.length, 1);
});

// ---------------------------------------------------------------------------
// State derivation truth table
// ---------------------------------------------------------------------------

test('deriveStakeState truth table', () => {
  // Never delegated
  assert.equal(deriveStakeState({ activationEpoch: null, deactivationEpoch: null }, 10), 'inactive');
  // Delegated this epoch → warming up
  assert.equal(deriveStakeState({ activationEpoch: 10, deactivationEpoch: null }, 10), 'activating');
  // Delegated in a past epoch → earning
  assert.equal(deriveStakeState({ activationEpoch: 9, deactivationEpoch: null }, 10), 'active');
  // Deactivation requested this epoch → cooling down
  assert.equal(deriveStakeState({ activationEpoch: 5, deactivationEpoch: 10 }, 10), 'deactivating');
  // Deactivation completed at a past epoch boundary → claimable
  assert.equal(deriveStakeState({ activationEpoch: 5, deactivationEpoch: 9 }, 10), 'withdrawable');
  // Deactivated in the same epoch it was created, boundary passed → claimable
  assert.equal(deriveStakeState({ activationEpoch: 8, deactivationEpoch: 8 }, 10), 'withdrawable');
});

// ---------------------------------------------------------------------------
// parseStakeAccount fixtures
// ---------------------------------------------------------------------------

const WALLET_B58 = walletKeypair().publicKey.toBase58();

function delegatedFixture({ deactivationEpoch = EPOCH_U64_SENTINEL, activationEpoch = '5' } = {}) {
  return {
    pubkey: '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z',
    account: {
      lamports: 1_502_282_880,
      data: {
        program: 'stake',
        parsed: {
          type: 'delegated',
          info: {
            meta: {
              rentExemptReserve: '2282880',
              authorized: { staker: WALLET_B58, withdrawer: WALLET_B58 },
            },
            stake: {
              delegation: {
                voter: VOTE_PUBKEY.toBase58(),
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

test('parseStakeAccount: active delegated account with u64 sentinel', () => {
  const position = parseStakeAccount(delegatedFixture(), 10);
  assert.ok(position);
  assert.equal(position.state, 'active');
  assert.equal(position.votePubkey, VOTE_PUBKEY.toBase58());
  assert.equal(position.delegatedLamports, 1_500_000_000);
  assert.equal(position.rentExemptReserveLamports, 2_282_880);
  assert.equal(position.totalLamports, 1_502_282_880);
  assert.equal(position.deactivationEpoch, null); // sentinel → null
  assert.equal(position.withdrawerAuthority, WALLET_B58);
});

test('parseStakeAccount: deactivating and withdrawable', () => {
  const deactivating = parseStakeAccount(delegatedFixture({ deactivationEpoch: '10' }), 10);
  assert.equal(deactivating.state, 'deactivating');

  const withdrawable = parseStakeAccount(delegatedFixture({ deactivationEpoch: '9' }), 10);
  assert.equal(withdrawable.state, 'withdrawable');
});

test('parseStakeAccount: initialized-but-undelegated account is inactive', () => {
  const fixture = {
    pubkey: '3QQebGUmzpbBZfwsXKNHJCMw9MSy6Ej3uVG9kUxs7yYp',
    account: {
      lamports: 2_282_880,
      data: {
        program: 'stake',
        parsed: {
          type: 'initialized',
          info: {
            meta: {
              rentExemptReserve: '2282880',
              authorized: { staker: WALLET_B58, withdrawer: WALLET_B58 },
            },
            stake: null,
          },
        },
      },
    },
  };

  const position = parseStakeAccount(fixture, 10);
  assert.ok(position);
  assert.equal(position.state, 'inactive');
  assert.equal(position.votePubkey, null);
  assert.equal(position.delegatedLamports, 0);
});

test('parseStakeAccount: returns null for unrecognized shapes', () => {
  assert.equal(parseStakeAccount(null, 10), null);
  assert.equal(parseStakeAccount({}, 10), null);
  assert.equal(
    parseStakeAccount({ pubkey: 'x', account: { data: { program: 'spl-token', parsed: {} } } }, 10),
    null
  );
});

test('STAKE_ACCOUNT_SPACE matches web3.js StakeProgram.space', () => {
  assert.equal(STAKE_ACCOUNT_SPACE, StakeProgram.space);
});
