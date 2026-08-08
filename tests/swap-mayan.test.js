/**
 * @file swap-mayan.test.js
 * @description Unit tests for MayanClient — quote selection and gasless
 *   opt-out, EVM/Solana execution result mapping, and the explorer
 *   clientStatus → SwapStatusView mapping. SDK and HTTP are both injected
 *   fakes; no live network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MayanClient, MayanApiError } from '../dist/swap/mayan.js';

const QUOTE = {
  type: 'SWIFT',
  expectedAmountOut: 3412.55,
  minAmountOut: 3378.42,
  price: 3412.55,
  etaSeconds: 30,
  clientRelayerFeeSuccess: 1.25,
  clientRelayerFeeRefund: null,
  deadline64: String(Math.floor(Date.now() / 1000) + 600),
};

function makeSdk(overrides = {}) {
  const calls = [];
  const sdk = {
    async fetchQuote(params, options) {
      calls.push({ fn: 'fetchQuote', params, options });
      return [QUOTE];
    },
    async swapFromEvm(...args) {
      calls.push({ fn: 'swapFromEvm', args });
      return { hash: '0xevmhash' };
    },
    async swapFromSolana(...args) {
      calls.push({ fn: 'swapFromSolana', args });
      return { signature: 'solsig' };
    },
    addresses: { MAYAN_FORWARDER_CONTRACT: '0x337685fdaB40D39bd02028545a4FfA7D287cC3E2' },
    ...overrides,
  };
  return { sdk, calls };
}

test('fetchQuote returns the best (first) quote and disables gasless mode', async () => {
  const { sdk, calls } = makeSdk();
  const client = new MayanClient({ sdk });

  const quote = await client.fetchQuote({
    amountIn64: '1000000000000000000',
    fromToken: '0x0000000000000000000000000000000000000000',
    fromChain: 'ethereum',
    toToken: '0x0000000000000000000000000000000000000000',
    toChain: 'solana',
    slippageBps: 100,
  });

  assert.equal(quote, QUOTE);
  assert.equal(calls[0].options.gasless, false, 'gasless must stay off — wallet signs everything');
  assert.equal(calls[0].params.slippageBps, 100);
});

test('fetchQuote maps an empty route list to a friendly error', async () => {
  const { sdk } = makeSdk({ async fetchQuote() { return []; } });
  const client = new MayanClient({ sdk });

  await assert.rejects(
    () => client.fetchQuote({ amountIn64: '1', fromToken: 'a', fromChain: 'ethereum', toToken: 'b', toChain: 'solana', slippageBps: 'auto' }),
    (err) => err instanceof MayanApiError && /No route/i.test(err.message)
  );
});

test('swapFromEvm returns the tx hash and rejects unexpected gasless strings', async () => {
  const { sdk, calls } = makeSdk();
  const client = new MayanClient({ sdk });
  const signer = { fake: true };

  const result = await client.swapFromEvm(QUOTE, '0xSWAPPER', '0xDEST', signer);
  assert.equal(result.txHash, '0xevmhash');
  // Positional SDK contract: quote, swapper, dest, referrers, signer, permit, overrides, payload.
  const args = calls.find((c) => c.fn === 'swapFromEvm').args;
  assert.equal(args[1], '0xSWAPPER');
  assert.equal(args[2], '0xDEST');
  assert.equal(args[4], signer);

  const gasless = makeSdk({ async swapFromEvm() { return 'order-signature'; } });
  const gaslessClient = new MayanClient({ sdk: gasless.sdk });
  await assert.rejects(
    () => gaslessClient.swapFromEvm(QUOTE, '0xS', '0xD', signer),
    /gasless/i
  );
});

test('swapFromSolana passes the sign callback through and returns the signature', async () => {
  const { sdk, calls } = makeSdk();
  const client = new MayanClient({ sdk });
  const signTx = async (tx) => tx;
  const connection = { fake: true };

  const result = await client.swapFromSolana(QUOTE, 'SolAddr', '0xDEST', signTx, connection);
  assert.equal(result.signature, 'solsig');
  const args = calls.find((c) => c.fn === 'swapFromSolana').args;
  assert.equal(args[4], signTx, 'signing stays in the caller-provided callback');
  assert.equal(args[5], connection);
});

test('getForwarderAddress exposes the SDK forwarder constant', async () => {
  const { sdk } = makeSdk();
  const client = new MayanClient({ sdk });
  assert.equal(await client.getForwarderAddress(), '0x337685fdaB40D39bd02028545a4FfA7D287cC3E2');
});

test('getStatus maps explorer clientStatus to chain-neutral states', async () => {
  const bodies = [
    { status: 200, body: { clientStatus: 'INPROGRESS' } },
    { status: 200, body: { clientStatus: 'COMPLETED', fulfillTxHash: 'destsig' } },
    { status: 200, body: { clientStatus: 'REFUNDED' } },
    { status: 404, body: {} },
    { status: 200, body: { clientStatus: 'SOMETHING_NEW' } },
  ];
  const fetchFn = async (url) => {
    const next = bodies.shift();
    return { ok: next.status === 200, status: next.status, json: async () => next.body, url };
  };
  const client = new MayanClient({ sdk: makeSdk().sdk, fetchFn });

  assert.equal((await client.getStatus('tx1')).state, 'pending');
  const completed = await client.getStatus('tx2');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.destTxId, 'destsig');
  assert.equal((await client.getStatus('tx3')).state, 'refunded');
  // Not-yet-indexed transactions are pending, not failures.
  assert.equal((await client.getStatus('tx4')).state, 'pending');
  // Unknown vocabulary degrades to pending rather than a false failure.
  assert.equal((await client.getStatus('tx5')).state, 'pending');
});

test('getStatus surfaces transport failures as errors', async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = new MayanClient({ sdk: makeSdk().sdk, fetchFn });
  await assert.rejects(() => client.getStatus('tx'), /HTTP 500/);
});
