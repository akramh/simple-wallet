import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAddress } from '../dist/ui-helpers.js';

test('formatAddress preserves address casing (Solana base58)', () => {
  const address = 'fdNZeYv2gRahWhEcoK4brXwgz5aBKVemNcuxucG5wQW';
  const formatted = formatAddress(address);
  assert.ok(
    formatted.includes(address),
    'formatAddress should not change casing for case-sensitive address formats'
  );
});

