import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BitcoinExplorer } from '../dist/bitcoin/explorer.js';

test('BitcoinExplorer.getNormalizedTransactions uses outputs-to-others for sends (excludes change)', async () => {
  const myAddress = 'bc1qmyaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const recipient = 'bc1qrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

  const txs = [
    {
      txid: 'tx-send-1',
      version: 2,
      locktime: 0,
      vin: [
        {
          txid: 'prev',
          vout: 0,
          prevout: {
            scriptpubkey: '0014deadbeef',
            scriptpubkey_address: myAddress,
            scriptpubkey_type: 'v0_p2wpkh',
            value: 10000
          },
          scriptsig: '',
          witness: [],
          is_coinbase: false,
          sequence: 0
        }
      ],
      vout: [
        {
          scriptpubkey: '0014recipient',
          scriptpubkey_address: recipient,
          scriptpubkey_type: 'v0_p2wpkh',
          value: 6900
        },
        {
          scriptpubkey: '0014change',
          scriptpubkey_address: myAddress,
          scriptpubkey_type: 'v0_p2wpkh',
          value: 3000
        }
      ],
      size: 200,
      weight: 800,
      fee: 100,
      status: { confirmed: true, block_height: 123, block_time: 1700000000 }
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes(`/address/${myAddress}/txs`)) {
      return new Response(JSON.stringify(txs), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const explorer = new BitcoinExplorer('mainnet', 'https://example.test/api');
    const normalized = await explorer.getNormalizedTransactions(myAddress, 10);

    assert.equal(normalized.length, 1);
    const tx = normalized[0];
    assert.equal(tx.type, 'send');
    assert.equal(tx.from, myAddress);
    assert.equal(tx.to, recipient);
    assert.equal(tx.value, '6900', 'send value should exclude change and fee');
    assert.equal(tx.fee, '100');
    assert.equal(tx.status, 'confirmed');
    assert.equal(tx.network, 'bitcoin-mainnet');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BitcoinExplorer.getNormalizedTransactions uses outputs-to-me for receives', async () => {
  const myAddress = 'bc1qmyaddressyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';
  const sender = 'bc1qsenderyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';

  const txs = [
    {
      txid: 'tx-recv-1',
      version: 2,
      locktime: 0,
      vin: [
        {
          txid: 'prev',
          vout: 0,
          prevout: {
            scriptpubkey: '0014sender',
            scriptpubkey_address: sender,
            scriptpubkey_type: 'v0_p2wpkh',
            value: 8000
          },
          scriptsig: '',
          witness: [],
          is_coinbase: false,
          sequence: 0
        }
      ],
      vout: [
        {
          scriptpubkey: '0014to-me',
          scriptpubkey_address: myAddress,
          scriptpubkey_type: 'v0_p2wpkh',
          value: 5000
        },
        {
          scriptpubkey: '0014change',
          scriptpubkey_address: sender,
          scriptpubkey_type: 'v0_p2wpkh',
          value: 2900
        }
      ],
      size: 200,
      weight: 800,
      fee: 100,
      status: { confirmed: false }
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.includes(`/address/${myAddress}/txs`)) {
      return new Response(JSON.stringify(txs), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const explorer = new BitcoinExplorer('mainnet', 'https://example.test/api');
    const normalized = await explorer.getNormalizedTransactions(myAddress, 10);

    assert.equal(normalized.length, 1);
    const tx = normalized[0];
    assert.equal(tx.type, 'receive');
    assert.equal(tx.from, sender);
    assert.equal(tx.to, myAddress);
    assert.equal(tx.value, '5000', 'receive value should be outputs to address');
    assert.equal(tx.fee, '100');
    assert.equal(tx.status, 'pending');
    assert.equal(tx.network, 'bitcoin-mainnet');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

