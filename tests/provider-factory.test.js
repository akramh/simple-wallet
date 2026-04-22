/**
 * @file provider-factory.test.js
 * @description Regression tests for DefaultProviderFactory pinning a
 *   plugin-stripped static Network on construction — specifically ensuring
 *   ethers v6's built-in Polygon gas-station plugin is removed. Without this,
 *   every `provider.getFeeData()` on a polygon provider fires a fetch to
 *   gasstation.polygon.technology, which our service-worker network guard
 *   blocks and which surfaces as a confusing "polygon gas station" error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefaultProviderFactory, createProviderFactory } from '../dist/providers.js';

const FETCH_URL_FEE_DATA_PLUGIN = 'org.ethers.plugins.network.FetchUrlFeeDataPlugin';

test('createProviderFactory returns a DefaultProviderFactory', () => {
  const factory = createProviderFactory();
  assert.ok(factory instanceof DefaultProviderFactory);
  assert.equal(typeof factory.createProvider, 'function');
});

test('polygon provider (chainId 137): FetchUrlFeeDataPlugin is stripped', async () => {
  const factory = new DefaultProviderFactory();
  const provider = factory.createProvider('https://example.invalid/polygon', 137);

  // getNetwork() on a staticNetwork-pinned provider is synchronous from the
  // cache — no eth_chainId RPC fires. The returned Network must not carry
  // the FetchUrlFeeData plugin or getFeeData() would hit the gas-station URL.
  const network = await provider.getNetwork();
  assert.equal(Number(network.chainId), 137);
  assert.equal(
    network.getPlugin(FETCH_URL_FEE_DATA_PLUGIN),
    null,
    'polygon Network must NOT carry the gas-station plugin'
  );
});

test('mainnet provider (chainId 1): default plugins preserved, no gas-station to strip', async () => {
  const factory = new DefaultProviderFactory();
  const provider = factory.createProvider('https://example.invalid/mainnet', 1);

  const network = await provider.getNetwork();
  assert.equal(Number(network.chainId), 1);
  assert.equal(network.getPlugin(FETCH_URL_FEE_DATA_PLUGIN), null);
  // Mainnet normally carries ENS + GasCost plugins — keep at least one to
  // guard against an accidental wholesale strip.
  assert.ok(network.plugins.length > 0, 'mainnet default plugins preserved');
});

test('unknown chainId: provider builds cleanly (unknown Network, no plugins)', async () => {
  const factory = new DefaultProviderFactory();
  const provider = factory.createProvider('https://example.invalid/custom', 99999999);

  const network = await provider.getNetwork();
  assert.equal(Number(network.chainId), 99999999);
  // No gas-station plugin on an unknown network either.
  assert.equal(network.getPlugin(FETCH_URL_FEE_DATA_PLUGIN), null);
});

test('polygon provider getFeeData() does NOT fire a fetch to gasstation.polygon.technology', async () => {
  // Monkey-patch global fetch to record every URL the provider (or ethers
  // internals) tries to hit during a getFeeData() call. We install a stub
  // `_perform` on the provider so the underlying JSON-RPC path resolves
  // without a real network — the point of the test is to prove the gas
  // station URL specifically is never touched.
  const fetched = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    fetched.push(url);
    // Respond with a shape that avoids ethers exceptions if anything slips through.
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const factory = new DefaultProviderFactory();
    const provider = factory.createProvider('https://example.invalid/polygon', 137);

    // Stub the three RPC methods getFeeData() needs so we don't depend on
    // the (fake) upstream. Returning hex values keeps ethers' big-int parsing happy.
    provider._perform = async (req) => {
      if (req.method === 'getBlock') {
        // latest block → baseFeePerGas triggers the EIP-1559 branch.
        return {
          number: 1,
          hash: '0x' + '11'.repeat(32),
          parentHash: '0x' + '22'.repeat(32),
          timestamp: 0,
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          gasLimit: '0x0',
          gasUsed: '0x0',
          miner: '0x' + '0'.repeat(40),
          extraData: '0x',
          baseFeePerGas: '0x' + (30n * 10n ** 9n).toString(16), // 30 gwei
          transactions: [],
        };
      }
      if (req.method === 'getGasPrice') return '0x' + (40n * 10n ** 9n).toString(16);
      if (req.method === 'getPriorityFee') return '0x' + (2n * 10n ** 9n).toString(16);
      throw new Error(`unexpected _perform method: ${req.method}`);
    };

    await provider.getFeeData();

    const hitGasStation = fetched.some((url) => typeof url === 'string' && url.includes('gasstation.polygon.technology'));
    assert.equal(hitGasStation, false, `must not hit polygon gas station; observed fetches: ${JSON.stringify(fetched)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
