import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAddress, menuChoice } from '../dist/ui-helpers.js';

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

test('formatAddress preserves address casing (Solana base58)', () => {
  const address = 'fdNZeYv2gRahWhEcoK4brXwgz5aBKVemNcuxucG5wQW';
  const formatted = formatAddress(address);
  assert.ok(
    formatted.includes(address),
    'formatAddress should not change casing for case-sensitive address formats'
  );
});

test('menuChoice does not exceed a safe terminal width', () => {
  const columns = typeof process.stdout?.columns === 'number' ? process.stdout.columns : 80;
  const safeWidth = Math.max(40, columns - 10);

  const choice = menuChoice(
    'metamask-long-wallet-name-that-would-wrap',
    '0x37c11fe495... (123 accounts)'
  );

  assert.equal(typeof choice.name, 'string');
  assert.ok(stripAnsi(choice.name).length <= safeWidth);
});
