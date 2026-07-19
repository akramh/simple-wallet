import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikeAlchemyKey,
  maskAlchemyKey,
  validateAlchemyKey,
  ALCHEMY_SIGNUP_URL,
  ALCHEMY_VALIDATION_URL
} from '../dist/alchemy-key.js';

const GOOD_KEY = 'gsNk1FAKEFAKEFAKEFAKE';

// ---------------------------------------------------------------------------
// Format check
// ---------------------------------------------------------------------------

test('looksLikeAlchemyKey accepts plausible keys and tolerates whitespace', () => {
  assert.ok(looksLikeAlchemyKey(GOOD_KEY));
  assert.ok(looksLikeAlchemyKey(`  ${GOOD_KEY}  `));
  assert.ok(looksLikeAlchemyKey('abc_DEF-123456789012'));
});

test('looksLikeAlchemyKey rejects obvious paste mistakes', () => {
  assert.ok(!looksLikeAlchemyKey(''));
  assert.ok(!looksLikeAlchemyKey('short'));
  assert.ok(!looksLikeAlchemyKey('https://eth-mainnet.g.alchemy.com/v2/abc'));
  assert.ok(!looksLikeAlchemyKey('"quoted-key-1234567890"'));
  assert.ok(!looksLikeAlchemyKey('has spaces in the middle'));
  assert.ok(!looksLikeAlchemyKey('x'.repeat(65)));
});

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

test('maskAlchemyKey shows only first and last 4 characters', () => {
  assert.equal(maskAlchemyKey('abcdefghijklmnopqrstuvwxyz'), 'abcd…wxyz');
  assert.equal(maskAlchemyKey(`  ${GOOD_KEY} `), maskAlchemyKey(GOOD_KEY));
});

test('maskAlchemyKey fully masks short inputs', () => {
  assert.equal(maskAlchemyKey('12345678'), '…');
  assert.equal(maskAlchemyKey(''), '…');
});

// ---------------------------------------------------------------------------
// Validator (injected fetch — never live)
// ---------------------------------------------------------------------------

function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test('validateAlchemyKey succeeds on a JSON-RPC result', async () => {
  const fetchImpl = fakeFetch(jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x10' }));
  const result = await validateAlchemyKey(GOOD_KEY, fetchImpl);
  assert.deepEqual(result, { ok: true });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, ALCHEMY_VALIDATION_URL + GOOD_KEY);
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.method, 'eth_blockNumber');
});

test('validateAlchemyKey rejects malformed keys without a network call', async () => {
  const fetchImpl = fakeFetch(jsonResponse({ result: '0x1' }));
  const result = await validateAlchemyKey('not a key', fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'invalid-format' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('validateAlchemyKey maps HTTP 401/403 to unauthorized', async () => {
  for (const status of [401, 403]) {
    const result = await validateAlchemyKey(GOOD_KEY, fakeFetch(jsonResponse({}, status)));
    assert.deepEqual(result, { ok: false, reason: 'unauthorized' });
  }
});

test('validateAlchemyKey maps JSON-RPC auth errors to unauthorized', async () => {
  const fetchImpl = fakeFetch(
    jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Must be authenticated!' } })
  );
  const result = await validateAlchemyKey(GOOD_KEY, fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'unauthorized' });
});

test('validateAlchemyKey maps non-auth HTTP errors and malformed bodies to bad-response', async () => {
  assert.deepEqual(await validateAlchemyKey(GOOD_KEY, fakeFetch(jsonResponse({}, 500))), {
    ok: false,
    reason: 'bad-response'
  });

  const unparseable = {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not json');
    }
  };
  assert.deepEqual(await validateAlchemyKey(GOOD_KEY, fakeFetch(unparseable)), {
    ok: false,
    reason: 'bad-response'
  });

  assert.deepEqual(await validateAlchemyKey(GOOD_KEY, fakeFetch(jsonResponse({ unexpected: true }))), {
    ok: false,
    reason: 'bad-response'
  });
});

test('validateAlchemyKey maps fetch rejection to network-error', async () => {
  const result = await validateAlchemyKey(GOOD_KEY, fakeFetch(new TypeError('fetch failed')));
  assert.deepEqual(result, { ok: false, reason: 'network-error' });
});

test('validateAlchemyKey maps aborts to timeout', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const result = await validateAlchemyKey(GOOD_KEY, fakeFetch(abortError));
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
});

test('no validation result ever contains the key', async () => {
  const scenarios = [
    jsonResponse({ result: '0x1' }),
    jsonResponse({}, 401),
    jsonResponse({ error: { message: `bad key ${GOOD_KEY}` } }),
    jsonResponse({}, 500),
    new TypeError(`fetch failed for ${GOOD_KEY}`)
  ];
  for (const scenario of scenarios) {
    const result = await validateAlchemyKey(GOOD_KEY, fakeFetch(scenario));
    assert.ok(!JSON.stringify(result).includes(GOOD_KEY), 'result leaked the key');
  }
});

test('signup URL points at the Alchemy dashboard', () => {
  assert.equal(ALCHEMY_SIGNUP_URL, 'https://dashboard.alchemy.com/');
});
