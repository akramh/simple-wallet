/**
 * @file swap-jupiter.test.js
 * @description Unit tests for JupiterClient request authentication, quote/order
 *   shaping, local versioned-transaction signing, execution mapping, and safe
 *   error messages. HTTP is fully injected; no live network calls occur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import { JupiterClient, JupiterApiError } from '../dist/swap/jupiter.js';

function makeFetch(responses) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('fetch stub exhausted');
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { fetchFn, calls };
}

function makeTransaction() {
  const signer = Keypair.generate();
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  return {
    signer,
    base64: Buffer.from(transaction.serialize()).toString('base64'),
  };
}

test('constructor requires an API key', () => {
  assert.throws(() => new JupiterClient({ apiKey: '' }), /JUPITER_API_KEY/);
});

test('fetchOrder authenticates in a header and supports quote-only requests', async () => {
  const { fetchFn, calls } = makeFetch([{ status: 200, body: {
    transaction: null,
    requestId: 'req-1',
    inAmount: '1000000000',
    outAmount: '25000000',
    otherAmountThreshold: '24750000',
    slippageBps: 100,
    router: 'metis',
    mode: 'manual',
    feeBps: 2,
  } }]);
  const client = new JupiterClient({ apiKey: 'jup-key', fetchFn });

  const order = await client.fetchOrder({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'USDCMint',
    amount: '1000000000',
    slippageBps: 50,
  });

  assert.equal(order.outAmount, '25000000');
  assert.match(calls[0].url, /^https:\/\/api\.jup\.ag\/swap\/v2\/order\?/);
  assert.match(calls[0].url, /amount=1000000000/);
  assert.match(calls[0].url, /slippageBps=50/);
  assert.ok(!calls[0].url.includes('taker='));
  assert.equal(calls[0].init.headers['x-api-key'], 'jup-key');
  assert.ok(!calls[0].url.includes('jup-key'), 'API key never appears in the URL');
});

test('executeOrder signs locally and submits only serialized signed bytes', async () => {
  const { signer, base64 } = makeTransaction();
  const { fetchFn, calls } = makeFetch([{ status: 200, body: {
    status: 'Success',
    signature: 'sol-signature',
    totalInputAmount: '1000000000',
    totalOutputAmount: '24990000',
  } }]);
  const client = new JupiterClient({ apiKey: 'jup-key', fetchFn });
  let signed = false;

  const result = await client.executeOrder({
    transaction: base64,
    requestId: 'req-2',
    inAmount: '1000000000',
    outAmount: '25000000',
    otherAmountThreshold: '24750000',
    slippageBps: 100,
    router: 'metis',
    mode: 'manual',
    feeBps: 2,
  }, async (transaction) => {
    transaction.sign([signer]);
    signed = true;
    return transaction;
  });

  assert.equal(signed, true);
  assert.equal(result.signature, 'sol-signature');
  assert.equal(calls[0].url, 'https://api.jup.ag/swap/v2/execute');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.requestId, 'req-2');
  assert.equal(typeof body.signedTransaction, 'string');
  assert.notEqual(body.signedTransaction, base64, 'payer signature changed serialized bytes');
});

test('execution failures and auth errors are user-readable without leaking keys', async () => {
  const { signer, base64 } = makeTransaction();
  const failed = makeFetch([{ status: 200, body: {
    status: 'Failed', signature: 'failed-sig', code: -2003, error: 'quote expired',
  } }]);
  const client = new JupiterClient({ apiKey: 'secret-jupiter-key', fetchFn: failed.fetchFn });
  await assert.rejects(
    () => client.executeOrder({
      transaction: base64, requestId: 'req', inAmount: '1', outAmount: '1',
      otherAmountThreshold: '1', slippageBps: 100,
      router: 'jupiterz', mode: 'ultra', feeBps: 0,
    }, async (transaction) => {
      transaction.sign([signer]);
      return transaction;
    }),
    /quote expired/i
  );

  const unauthorized = makeFetch([{ status: 401, body: {} }]);
  const unauthorizedClient = new JupiterClient({ apiKey: 'secret-jupiter-key', fetchFn: unauthorized.fetchFn });
  await assert.rejects(
    () => unauthorizedClient.fetchOrder({
      inputMint: 'a', outputMint: 'b', amount: '1', slippageBps: 100,
    }),
    (error) => {
      assert.ok(error instanceof JupiterApiError);
      assert.match(error.message, /JUPITER_API_KEY/);
      assert.ok(!error.message.includes('secret-jupiter-key'));
      return true;
    }
  );
});
