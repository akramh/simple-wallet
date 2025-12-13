import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';

test('Solana addresses are case-sensitive (different case => different key)', () => {
  const lower = 'fdnzeyv2grahwhecok4brxwgz5abkvemncuxucg5wqw';
  const mixed = 'fdNZeYv2gRahWhEcoK4brXwgz5aBKVemNcuxucG5wQW';

  const pkLower = new PublicKey(lower);
  const pkMixed = new PublicKey(mixed);

  assert.notEqual(pkLower.toBase58(), pkMixed.toBase58());
  assert.ok(!Buffer.from(pkLower.toBytes()).equals(Buffer.from(pkMixed.toBytes())));
});

