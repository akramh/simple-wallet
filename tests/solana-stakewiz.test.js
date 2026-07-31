/**
 * @file solana-stakewiz.test.js
 * @description Tests for the Stakewiz validator-metadata client. The
 * degradation invariant is the core contract: every failure mode (HTTP
 * error, thrown fetch, malformed body) must resolve to an EMPTY map and
 * never throw — Stakewiz must never block staking. Fetch is injected;
 * no network traffic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchStakewizValidators, STAKEWIZ_API_BASE } from '../dist/solana/index.js';

const VALIDATORS_BODY = [
  {
    vote_identity: 'vote-a',
    name: 'Validator A',
    total_apy: 7.4,
    rank: 1,
    commission: 5,
  },
  {
    vote_identity: 'vote-b',
    name: '  ',
    apy_estimate: 6.1,
    commission: 0,
  },
  { name: 'missing vote identity — skipped' },
];

function okFetch(body) {
  return async (url) => {
    assert.ok(String(url).startsWith(STAKEWIZ_API_BASE));
    return { ok: true, json: async () => body };
  };
}

test('fetchStakewizValidators: parses and indexes by vote pubkey', async () => {
  const map = await fetchStakewizValidators(okFetch(VALIDATORS_BODY));

  assert.equal(map.size, 2);
  assert.deepEqual(map.get('vote-a'), {
    votePubkey: 'vote-a',
    name: 'Validator A',
    apyPercent: 7.4,
    rank: 1,
    commissionPercent: 5,
  });
  // Blank name normalizes to null; apy_estimate is the fallback APY field.
  const b = map.get('vote-b');
  assert.equal(b.name, null);
  assert.equal(b.apyPercent, 6.1);
  assert.equal(b.rank, null);
});

test('fetchStakewizValidators: HTTP error degrades to empty map', async () => {
  const map = await fetchStakewizValidators(async () => ({ ok: false, status: 500 }));
  assert.equal(map.size, 0);
});

test('fetchStakewizValidators: thrown fetch degrades to empty map', async () => {
  const map = await fetchStakewizValidators(async () => {
    throw new Error('network unreachable');
  });
  assert.equal(map.size, 0);
});

test('fetchStakewizValidators: malformed JSON degrades to empty map', async () => {
  const map = await fetchStakewizValidators(async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  }));
  assert.equal(map.size, 0);
});

test('fetchStakewizValidators: non-array body degrades to empty map', async () => {
  const map = await fetchStakewizValidators(okFetch({ error: 'rate limited' }));
  assert.equal(map.size, 0);
});
