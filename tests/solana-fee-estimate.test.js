/**
 * @file solana-fee-estimate.test.js
 * @description Regression tests for the upgraded Solana fee estimator.
 *
 * Covers the pure helpers (`pickPriorityFeePercentile`, `priorityFeeLamports`,
 * `buildSolTransfer` with/without priority-fee opt-in) and the
 * `SolanaProvider.estimateFee` flow: happy path (getFeeForMessage +
 * getRecentPrioritizationFees), null base fee, RPC failure, and the
 * params-omitted fallback to the fixed BASE_FEE_LAMPORTS constant.
 *
 * All tests are hermetic — the `Connection` that SolanaProvider holds is
 * replaced with a stub, no real network traffic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SolanaProvider,
  BASE_FEE_LAMPORTS,
  DEFAULT_SOL_TRANSFER_CU_LIMIT,
  pickPriorityFeePercentile,
  priorityFeeLamports,
  buildSolTransfer,
} from '../dist/solana/index.js';
import { PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';

const FROM = '4Nd1m7n4oxTSGEcRcqDfvpL5YqKymhvPf4VQnppshR9z';
const TO = '3QQebGUmzpbBZfwsXKNHJCMw9MSy6Ej3uVG9kUxs7yYp';

function buildProviderWithStubConnection(stub) {
  const provider = new SolanaProvider({
    networkKey: 'solana-mainnet',
    rpcUrls: ['https://stub'],
  });
  // Swap the ctor-built Connection for our stub. The test exercises only the
  // three methods estimateFee needs; anything else would throw.
  provider.connections = [stub];
  return provider;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('pickPriorityFeePercentile: 75th percentile via nearest-rank', () => {
  // Sorted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; rank = ceil(0.75 × 10) = 8 → 8
  assert.equal(pickPriorityFeePercentile([5, 1, 8, 3, 10, 2, 7, 4, 6, 9], 75), 8);
});

test('pickPriorityFeePercentile: returns 0 for empty input', () => {
  assert.equal(pickPriorityFeePercentile([]), 0);
});

test('pickPriorityFeePercentile: clamps out-of-range percentile', () => {
  // percentile 150 should behave like 100 → highest value
  assert.equal(pickPriorityFeePercentile([1, 2, 3], 150), 3);
  // percentile -10 should behave like 0 → lowest value (rank clamped to 1)
  assert.equal(pickPriorityFeePercentile([1, 2, 3], -10), 1);
});

test('priorityFeeLamports: ceil division, protects against under-reporting', () => {
  // 100 microLamports/CU × 1000 CU = 100_000 microLamports = 0.1 lamports ⇒ ceil = 1
  assert.equal(priorityFeeLamports(100, 1000), 1);
  // 1_000_000 × 1_000 = 1 billion microLamports = 1000 lamports (exact)
  assert.equal(priorityFeeLamports(1_000_000, 1000), 1000);
  // Zero inputs ⇒ zero cost
  assert.equal(priorityFeeLamports(0, 1000), 0);
  assert.equal(priorityFeeLamports(1000, 0), 0);
});

test('priorityFeeLamports: BigInt path handles large values without precision loss', () => {
  // 2^53 is the Number-precision edge; microLamports × CU can exceed it.
  // Here we intentionally pick values whose product > Number.MAX_SAFE_INTEGER
  // to verify the BigInt intermediate.
  const microLamports = 1_000_000_000; // 1e9
  const cuLimit = 1_400_000; // Solana max CU per tx
  // product = 1.4e15 microLamports → 1.4e9 lamports. Exact; ceil no-op.
  assert.equal(priorityFeeLamports(microLamports, cuLimit), 1_400_000_000);
});

// ---------------------------------------------------------------------------
// buildSolTransfer
// ---------------------------------------------------------------------------

test('buildSolTransfer: no priority fee ⇒ single SystemProgram.transfer instruction', () => {
  const tx = buildSolTransfer({
    fromPubkey: new PublicKey(FROM),
    toPubkey: new PublicKey(TO),
    lamports: 1_000_000,
    recentBlockhash: 'J4M8...'.padEnd(44, '1'),
    lastValidBlockHeight: 1,
  });
  assert.equal(tx.instructions.length, 1, 'bare transfer has 1 instruction');
  assert.ok(
    tx.instructions[0].programId.equals(SystemProgram.programId),
    'the only instruction is a SystemProgram call'
  );
});

test('buildSolTransfer: priority fee set ⇒ prepends setComputeUnitLimit + setComputeUnitPrice', () => {
  const tx = buildSolTransfer({
    fromPubkey: new PublicKey(FROM),
    toPubkey: new PublicKey(TO),
    lamports: 1_000_000,
    recentBlockhash: 'J4M8...'.padEnd(44, '1'),
    lastValidBlockHeight: 1,
    priorityFeeMicroLamports: 5000,
    computeUnitLimit: 1200,
  });
  assert.equal(tx.instructions.length, 3, 'priority transfer has 3 instructions');
  assert.ok(
    tx.instructions[0].programId.equals(ComputeBudgetProgram.programId),
    'first instruction is Compute Budget (CU limit)'
  );
  assert.ok(
    tx.instructions[1].programId.equals(ComputeBudgetProgram.programId),
    'second instruction is Compute Budget (CU price)'
  );
  assert.ok(
    tx.instructions[2].programId.equals(SystemProgram.programId),
    'transfer comes last so it executes after the budget is set'
  );
});

test('buildSolTransfer: priority fee present without computeUnitLimit uses default', () => {
  const tx = buildSolTransfer({
    fromPubkey: new PublicKey(FROM),
    toPubkey: new PublicKey(TO),
    lamports: 1_000_000,
    recentBlockhash: 'J4M8...'.padEnd(44, '1'),
    lastValidBlockHeight: 1,
    priorityFeeMicroLamports: 5000,
    // computeUnitLimit intentionally omitted
  });
  // The first instruction should be the CU-limit one. Decode its u32 limit
  // field to confirm we wrote DEFAULT_SOL_TRANSFER_CU_LIMIT into it.
  // Layout: [discriminator:u8 = 2][units:u32 LE] = 5 bytes total.
  const cuLimitIx = tx.instructions[0];
  assert.equal(cuLimitIx.data.length, 5, 'setComputeUnitLimit payload is 5 bytes');
  assert.equal(cuLimitIx.data[0], 2, 'discriminator 2 = SetComputeUnitLimit');
  const units = cuLimitIx.data.readUInt32LE(1);
  assert.equal(units, DEFAULT_SOL_TRANSFER_CU_LIMIT, 'uses the documented default');
});

// ---------------------------------------------------------------------------
// SolanaProvider.estimateFee
// ---------------------------------------------------------------------------

test('estimateFee() without params ⇒ fallback to BASE_FEE_LAMPORTS', async () => {
  const provider = buildProviderWithStubConnection({
    // No methods called — confirming the no-param path short-circuits.
    getLatestBlockhash: async () => {
      throw new Error('should not be called');
    },
  });
  const estimate = await provider.estimateFee();
  assert.equal(estimate.feeLamports, BASE_FEE_LAMPORTS);
  assert.equal(estimate.baseFeeLamports, BASE_FEE_LAMPORTS);
  assert.equal(estimate.priorityFeeLamports, 0);
  assert.equal(estimate.priorityFeeMicroLamports, 0);
  assert.equal(estimate.computeUnitLimit, 0);
});

test('estimateFee({...}) combines getFeeForMessage base fee + sampled priority fee', async () => {
  const calls = [];
  const stub = {
    async getLatestBlockhash() {
      calls.push('getLatestBlockhash');
      return { blockhash: 'J4M8'.padEnd(44, '1'), lastValidBlockHeight: 100 };
    },
    async getRecentPrioritizationFees(cfg) {
      calls.push({ op: 'getRecentPrioritizationFees', locked: cfg.lockedWritableAccounts.map((k) => k.toBase58()) });
      // Samples whose 75th percentile (nearest-rank on length 4) is at rank 3
      // → sorted[2] = 750. So we expect the provider to pick 750.
      return [
        { slot: 1, prioritizationFee: 100 },
        { slot: 2, prioritizationFee: 500 },
        { slot: 3, prioritizationFee: 750 },
        { slot: 4, prioritizationFee: 2000 },
      ];
    },
    async getFeeForMessage() {
      calls.push('getFeeForMessage');
      // Typical mainnet value for a 1-sig tx with compute budget instructions
      return { context: { slot: 1 }, value: 5000 };
    },
  };
  const provider = buildProviderWithStubConnection(stub);

  const estimate = await provider.estimateFee({
    fromAddress: FROM,
    toAddress: TO,
    lamports: 1_000_000,
  });

  // 75th percentile on [100, 500, 750, 2000] = 750 microLamports/CU.
  // priorityFeeLamports = ceil(750 × DEFAULT_SOL_TRANSFER_CU_LIMIT / 1e6).
  const expectedPriority = Math.ceil((750 * DEFAULT_SOL_TRANSFER_CU_LIMIT) / 1_000_000);
  assert.equal(estimate.priorityFeeMicroLamports, 750);
  assert.equal(estimate.computeUnitLimit, DEFAULT_SOL_TRANSFER_CU_LIMIT);
  assert.equal(estimate.baseFeeLamports, 5000);
  assert.equal(estimate.priorityFeeLamports, expectedPriority);
  assert.equal(estimate.feeLamports, 5000 + expectedPriority);

  // The priority-fee sample MUST be locked on the fee payer so the result
  // reflects fees recently paid to write this account, not global noise.
  const sampleCall = calls.find((c) => c && c.op === 'getRecentPrioritizationFees');
  assert.deepEqual(sampleCall.locked, [FROM]);
});

test('estimateFee({...}) with no recent priority fees ⇒ base fee only, no CU instructions assumed', async () => {
  const stub = {
    async getLatestBlockhash() {
      return { blockhash: 'J4M8'.padEnd(44, '1'), lastValidBlockHeight: 100 };
    },
    async getRecentPrioritizationFees() {
      return []; // quiet network
    },
    async getFeeForMessage() {
      return { context: { slot: 1 }, value: 5000 };
    },
  };
  const provider = buildProviderWithStubConnection(stub);
  const estimate = await provider.estimateFee({ fromAddress: FROM, toAddress: TO, lamports: 1_000_000 });
  assert.equal(estimate.priorityFeeMicroLamports, 0);
  assert.equal(estimate.priorityFeeLamports, 0);
  assert.equal(estimate.computeUnitLimit, 0, 'no CU limit claimed when priority fee is zero');
  assert.equal(estimate.feeLamports, 5000);
});

test('estimateFee({...}) falls back to BASE_FEE_LAMPORTS when getFeeForMessage returns null', async () => {
  const stub = {
    async getLatestBlockhash() {
      return { blockhash: 'J4M8'.padEnd(44, '1'), lastValidBlockHeight: 100 };
    },
    async getRecentPrioritizationFees() {
      return [{ slot: 1, prioritizationFee: 1000 }];
    },
    async getFeeForMessage() {
      // Solana returns null for an expired blockhash / malformed message.
      return { context: { slot: 1 }, value: null };
    },
  };
  const provider = buildProviderWithStubConnection(stub);
  const estimate = await provider.estimateFee({ fromAddress: FROM, toAddress: TO, lamports: 1_000_000 });
  assert.equal(estimate.feeLamports, BASE_FEE_LAMPORTS, 'null base fee ⇒ fallback constant');
  assert.equal(estimate.priorityFeeLamports, 0);
  assert.equal(estimate.priorityFeeMicroLamports, 0);
});

test('estimateFee({...}) falls back when all RPC endpoints fail', async () => {
  const boomStub = {
    async getLatestBlockhash() {
      throw new Error('network down');
    },
    async getRecentPrioritizationFees() {
      throw new Error('network down');
    },
    async getFeeForMessage() {
      throw new Error('network down');
    },
  };
  const provider = buildProviderWithStubConnection(boomStub);
  const estimate = await provider.estimateFee({ fromAddress: FROM, toAddress: TO, lamports: 1_000_000 });
  assert.equal(estimate.feeLamports, BASE_FEE_LAMPORTS);
  assert.equal(estimate.baseFeeLamports, BASE_FEE_LAMPORTS);
});

test('estimateFee({...}) rejects bad input with fallback instead of throwing', async () => {
  const provider = buildProviderWithStubConnection({
    getLatestBlockhash: async () => {
      throw new Error('should not be called');
    },
  });
  const estimate = await provider.estimateFee({ fromAddress: 'not-a-key', toAddress: TO, lamports: 1_000_000 });
  assert.equal(estimate.feeLamports, BASE_FEE_LAMPORTS, 'invalid address ⇒ fallback');
});
