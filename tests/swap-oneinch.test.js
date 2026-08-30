/**
 * @file swap-oneinch.test.js
 * @description Unit tests for OneInchClient — request shape (auth header,
 *   URL construction, native sentinel pass-through), spender caching, and the
 *   error mapping for rate limits / no-liquidity responses. All HTTP goes
 *   through an injected fetchFn; no live network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OneInchClient, OneInchApiError } from '../dist/swap/oneinch.js';

/** fetch stub that records requests and replies from a scripted queue. */
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

test('constructor requires an API key', () => {
  assert.throws(() => new OneInchClient({ apiKey: '' }), /ONEINCH_API_KEY/);
});

test('getQuote sends a Bearer-authenticated request and maps the response', async () => {
  const { fetchFn, calls } = makeFetch([
    { status: 200, body: { dstAmount: '3412550000', gas: 180000 } },
  ]);
  const client = new OneInchClient({ apiKey: 'k3y', fetchFn });

  const quote = await client.getQuote(1, '0xSRC', '0xDST', '1000000000000000000');

  assert.equal(quote.dstAmount, '3412550000');
  assert.equal(quote.gas, 180000);
  const call = calls[0];
  assert.ok(call.url.startsWith('https://api.1inch.dev/swap/v6.0/1/quote?'));
  assert.match(call.url, /src=0xSRC/);
  assert.match(call.url, /dst=0xDST/);
  assert.match(call.url, /amount=1000000000000000000/);
  assert.equal(call.init.headers.Authorization, 'Bearer k3y');
});

test('getSwapTx returns calldata and rejects an incomplete tx payload', async () => {
  const { fetchFn, calls } = makeFetch([
    {
      status: 200,
      body: { tx: { to: '0xRouter', data: '0xabcdef', value: '0', gas: 210000 }, dstAmount: '99' },
    },
    { status: 200, body: { tx: { to: '', data: '' }, dstAmount: '99' } },
  ]);
  const client = new OneInchClient({ apiKey: 'k3y', fetchFn });

  const tx = await client.getSwapTx(137, '0xSRC', '0xDST', '5', '0xME', 1);
  assert.equal(tx.to, '0xRouter');
  assert.equal(tx.data, '0xabcdef');
  assert.equal(tx.gas, 210000);
  assert.match(calls[0].url, /\/137\/swap\?/);
  assert.match(calls[0].url, /from=0xME/);
  assert.match(calls[0].url, /slippage=1/);

  await assert.rejects(
    () => client.getSwapTx(137, '0xSRC', '0xDST', '5', '0xME', 1),
    /incomplete transaction/i
  );
});

test('getSpender caches the router address per chain', async () => {
  const { fetchFn, calls } = makeFetch([
    { status: 200, body: { address: '0x1111111254EEB25477B68fb85Ed929f73A960582' } },
  ]);
  const client = new OneInchClient({ apiKey: 'k3y', fetchFn });

  const first = await client.getSpender(1);
  const second = await client.getSpender(1);
  assert.equal(first, second);
  assert.equal(calls.length, 1, 'second lookup served from cache');
});

test('429 maps to a rate-limit message with status preserved', async () => {
  const { fetchFn } = makeFetch([{ status: 429, body: {} }]);
  const client = new OneInchClient({ apiKey: 'k3y', fetchFn });

  await assert.rejects(
    () => client.getQuote(1, '0xA', '0xB', '1'),
    (err) => {
      assert.ok(err instanceof OneInchApiError);
      assert.equal(err.status, 429);
      assert.match(err.message, /rate limit/i);
      return true;
    }
  );
});

test('insufficient-liquidity responses map to a friendly message', async () => {
  const { fetchFn } = makeFetch([
    { status: 400, body: { description: 'insufficient liquidity' } },
  ]);
  const client = new OneInchClient({ apiKey: 'k3y', fetchFn });

  await assert.rejects(
    () => client.getQuote(1, '0xA', '0xB', '1'),
    /Not enough liquidity/i
  );
});

test('auth failures point at the API key without echoing it', async () => {
  const { fetchFn } = makeFetch([{ status: 401, body: {} }]);
  const client = new OneInchClient({ apiKey: 'secret-key-value', fetchFn });

  await assert.rejects(
    () => client.getQuote(1, '0xA', '0xB', '1'),
    (err) => {
      assert.match(err.message, /ONEINCH_API_KEY/);
      assert.ok(!err.message.includes('secret-key-value'), 'key never appears in errors');
      return true;
    }
  );
});
