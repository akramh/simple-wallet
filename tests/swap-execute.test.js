/**
 * @file swap-execute.test.js
 * @description Service-layer tests for WalletAppService swap orchestration —
 *   quote shaping, the approve→wait→swap ordering invariant, native-source
 *   approval skip, the Solana password requirement, quote expiry, and the
 *   active-provider restore invariant. Swap clients and providers are all
 *   injected fakes; no live network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Wallet } from '../dist/wallet.js';
import { WalletAppService } from '../dist/app-service.js';
import { MemoryStorage } from '../dist/storage.js';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

const NATIVE_ETH = { symbol: 'ETH', name: 'Ether', type: 'native', address: '', decimals: 18 };
const USDC = { symbol: 'USDC', name: 'USD Coin', type: 'erc20', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 };
const NATIVE_SOL = { symbol: 'SOL', name: 'Solana', type: 'native', address: '', decimals: 9 };

/** 32-byte ABI-encoded uint256 for allowance responses. */
const encodeUint = (value) => '0x' + value.toString(16).padStart(64, '0');

function buildConfig(network = 'mainnet') {
  return {
    network,
    networks: {
      mainnet: { chainId: 1, rpcUrl: 'https://rpc.mainnet.example', nativeSymbol: 'ETH', nativeName: 'Ether' },
      polygon: { chainId: 137, rpcUrl: 'https://rpc.polygon.example', nativeSymbol: 'POL', nativeName: 'Polygon' },
      'solana-mainnet': { type: 'solana', rpcUrl: 'https://sol.example', nativeSymbol: 'SOL', nativeName: 'Solana' },
    },
  };
}

function makeEvmMockFactory({ allowance = 0n } = {}) {
  return {
    createProvider: (url, chainId) => ({
      url,
      chainId,
      async getBlockNumber() { return 123; },
      async getFeeData() { return { gasPrice: 20n * 10n ** 9n, maxFeePerGas: null, maxPriorityFeePerGas: null }; },
      async call() { return encodeUint(allowance); },
    }),
  };
}

/** Fake signer capturing send order; transaction.ts only needs these members. */
function makeFakeSigner(events, { allowance = 0n } = {}) {
  let txCount = 0;
  return {
    provider: {
      async call() { return encodeUint(allowance); },
    },
    async getAddress() { return '0x1111111111111111111111111111111111111111'; },
    async sendTransaction(tx) {
      const id = `0xtx${++txCount}`;
      events.push({ op: 'send', to: tx.to, data: tx.data, hash: id });
      return {
        hash: id,
        wait: async () => {
          events.push({ op: 'wait', hash: id });
          return { status: 1 };
        },
      };
    },
  };
}

function makeFakeOneInch({ calls = [] } = {}) {
  return {
    calls,
    async getQuote(chainId, src, dst, amount) {
      calls.push({ fn: 'getQuote', chainId, src, dst, amount });
      return { dstAmount: '3412550000', gas: 180000 };
    },
    async getSpender(chainId) {
      calls.push({ fn: 'getSpender', chainId });
      return '0x1111111254eeb25477b68fb85ed929f73a960582';
    },
    async getSwapTx(chainId, src, dst, amount, from, slippage) {
      calls.push({ fn: 'getSwapTx', chainId, src, dst, amount, from, slippage });
      return { to: '0x1111111254eeb25477b68fb85ed929f73a960582', data: '0xswapdata', value: '0', gas: 210000, dstAmount: '3412550000' };
    },
  };
}

function makeFakeMayan({ calls = [] } = {}) {
  return {
    calls,
    async fetchQuote(params) {
      calls.push({ fn: 'fetchQuote', params });
      return {
        type: 'SWIFT',
        expectedAmountOut: 3400.1,
        minAmountOut: 3366.2,
        price: 3400.1,
        etaSeconds: 25,
        clientRelayerFeeSuccess: 0.9,
        clientRelayerFeeRefund: null,
        deadline64: String(Math.floor(Date.now() / 1000) + 600),
      };
    },
    async getForwarderAddress() { return '0x337685fdaB40D39bd02028545a4FfA7D287cC3E2'; },
    async swapFromEvm(quote, swapper, dest, signer) {
      calls.push({ fn: 'swapFromEvm', swapper, dest });
      return { txHash: '0xmayanevm' };
    },
    async swapFromSolana(quote, origin, dest, signTx, connection) {
      calls.push({ fn: 'swapFromSolana', origin, dest, connection });
      return { signature: 'mayansolsig' };
    },
    async getStatus(txId) {
      calls.push({ fn: 'getStatus', txId });
      return { state: 'completed', destTxId: 'dest' };
    },
  };
}

async function buildService(network = 'mainnet', { factory, swapClients } = {}) {
  const storage = new MemoryStorage();
  storage.writeJSON('tokens.json', {});
  storage.writeJSON('tokens-user.json', {});
  const config = buildConfig(network);
  const providerFactory = factory ?? makeEvmMockFactory();
  const wallet = new Wallet(config, storage, providerFactory);
  await wallet.initialize();
  wallet.importWallet(TEST_MNEMONIC, 'pw', 0);
  const svc = new WalletAppService(wallet, config, { storage, providerFactory, swapClients });
  await svc.initialize();
  return { svc, wallet, config };
}

function makeRequest(overrides = {}) {
  return {
    fromNetworkKey: 'mainnet',
    fromToken: USDC,
    toNetworkKey: 'mainnet',
    toToken: NATIVE_ETH,
    amount: '100',
    slippagePercent: 1,
    ...overrides,
  };
}

function makeQuoteView(request, overrides = {}) {
  return {
    provider: request.fromNetworkKey === request.toNetworkKey ? 'oneinch' : 'mayan',
    fromNetworkKey: request.fromNetworkKey,
    toNetworkKey: request.toNetworkKey,
    fromTokenSymbol: request.fromToken.symbol,
    toTokenSymbol: request.toToken.symbol,
    amountInFormatted: request.amount,
    amountOutFormatted: '1',
    minAmountOutFormatted: '0.99',
    rateFormatted: '',
    feeFormatted: '',
    needsApproval: false,
    expiresAt: Date.now() + 30_000,
    raw: {},
    request,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

test('same-chain quote routes to 1inch, formats amounts, and flags approval', async () => {
  const oneinch = makeFakeOneInch();
  const { svc } = await buildService('mainnet', {
    factory: makeEvmMockFactory({ allowance: 0n }),
    swapClients: { oneinch, mayan: makeFakeMayan() },
  });

  const quote = await svc.getSwapQuote(makeRequest({ fromToken: USDC, toToken: NATIVE_ETH, amount: '100' }));

  assert.equal(quote.provider, 'oneinch');
  // dstAmount is in the *destination* token decimals (ETH-18 here would be
  // tiny; the fixture uses a USDC-sized number so decimals must come from
  // the request's toToken).
  assert.equal(quote.needsApproval, true, 'zero allowance requires approval');
  assert.equal(quote.approvalSpender, '0x1111111254eeb25477b68fb85ed929f73a960582');
  assert.ok(quote.expiresAt > Date.now());
  const quoteCall = oneinch.calls.find((c) => c.fn === 'getQuote');
  assert.equal(quoteCall.chainId, 1);
  assert.equal(quoteCall.src, USDC.address);
  assert.equal(quoteCall.amount, '100000000', 'amount converted with fromToken decimals');
  assert.equal(
    quoteCall.dst,
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    'native destination uses the 1inch sentinel'
  );
});

test('same-chain quote without a 1inch key fails with guidance', async () => {
  const hadKey = process.env.ONEINCH_API_KEY;
  const hadViteKey = process.env.VITE_ONEINCH_API_KEY;
  delete process.env.ONEINCH_API_KEY;
  delete process.env.VITE_ONEINCH_API_KEY;
  try {
    const { svc } = await buildService('mainnet', { swapClients: { mayan: makeFakeMayan() } });
    await assert.rejects(() => svc.getSwapQuote(makeRequest()), /ONEINCH_API_KEY/);
  } finally {
    if (hadKey !== undefined) process.env.ONEINCH_API_KEY = hadKey;
    if (hadViteKey !== undefined) process.env.VITE_ONEINCH_API_KEY = hadViteKey;
  }
});

test('cross-chain quote routes to Mayan with bps slippage and chain names', async () => {
  const mayan = makeFakeMayan();
  const { svc } = await buildService('mainnet', {
    factory: makeEvmMockFactory({ allowance: 10n ** 30n }),
    swapClients: { oneinch: makeFakeOneInch(), mayan },
  });

  const quote = await svc.getSwapQuote(makeRequest({
    toNetworkKey: 'solana-mainnet',
    toToken: NATIVE_SOL,
    slippagePercent: 0.5,
  }));

  assert.equal(quote.provider, 'mayan');
  assert.equal(quote.needsApproval, false, 'ample allowance needs no approval');
  assert.equal(quote.etaSeconds, 25);
  assert.match(quote.bridgeFeeFormatted, /relayer fee/);
  const call = mayan.calls.find((c) => c.fn === 'fetchQuote');
  assert.equal(call.params.fromChain, 'ethereum');
  assert.equal(call.params.toChain, 'solana');
  assert.equal(call.params.slippageBps, 50, 'percent converted to basis points');
  assert.equal(
    call.params.toToken,
    '0x0000000000000000000000000000000000000000',
    'native destination uses the Mayan zero-address sentinel'
  );
});

test('invalid amounts are rejected before any provider call', async () => {
  const oneinch = makeFakeOneInch();
  const { svc } = await buildService('mainnet', { swapClients: { oneinch, mayan: makeFakeMayan() } });

  await assert.rejects(() => svc.getSwapQuote(makeRequest({ amount: 'abc' })), /Invalid swap amount/);
  await assert.rejects(() => svc.getSwapQuote(makeRequest({ amount: '0' })), /greater than 0/);
  assert.equal(oneinch.calls.length, 0, 'no API traffic for invalid input');
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

test('ERC-20 1inch swap approves, waits, then swaps — in that order', async () => {
  const events = [];
  const phases = [];
  const oneinch = makeFakeOneInch();
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch, mayan: makeFakeMayan() },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events, { allowance: 0n });

  const request = makeRequest();
  const result = await svc.executeSwap(makeQuoteView(request), {
    onProgress: (phase) => phases.push(phase),
  });

  // Two sends: approval to the token contract, then the swap to the router.
  assert.equal(events.filter((e) => e.op === 'send').length, 2);
  assert.equal(events[0].op, 'send');
  assert.equal(events[0].to, USDC.address, 'first send is the approval on the token');
  assert.equal(events[1].op, 'wait', 'approval is mined before the swap is sent');
  assert.equal(events[2].op, 'send');
  assert.equal(events[2].to, '0x1111111254eeb25477b68fb85ed929f73a960582', 'second send is the swap calldata');
  assert.equal(result.provider, 'oneinch');
  assert.equal(result.txId, events[2].hash);
  assert.equal(result.approvalTxId, events[0].hash);
  assert.deepEqual(phases, [
    'checking-allowance', 'approving', 'approval-confirmed', 'submitting-swap', 'swap-submitted',
  ]);
  // Calldata was fetched at execute time, after the approval.
  const order = oneinch.calls.map((c) => c.fn);
  assert.ok(order.indexOf('getSwapTx') > order.indexOf('getSpender'));
});

test('native-source 1inch swap skips approval entirely', async () => {
  const events = [];
  const phases = [];
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch: makeFakeOneInch(), mayan: makeFakeMayan() },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events);

  const request = makeRequest({ fromToken: NATIVE_ETH, toToken: USDC, amount: '1' });
  const result = await svc.executeSwap(makeQuoteView(request), {
    onProgress: (phase) => phases.push(phase),
  });

  assert.equal(events.filter((e) => e.op === 'send').length, 1, 'exactly one tx — the swap');
  assert.equal(result.approvalTxId, undefined);
  assert.deepEqual(phases, ['submitting-swap', 'swap-submitted']);
});

test('sufficient allowance skips the approval tx but reports the check', async () => {
  const events = [];
  const phases = [];
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch: makeFakeOneInch(), mayan: makeFakeMayan() },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events, { allowance: 10n ** 30n });

  const result = await svc.executeSwap(makeQuoteView(makeRequest()), {
    onProgress: (phase) => phases.push(phase),
  });

  assert.equal(events.filter((e) => e.op === 'send').length, 1);
  assert.equal(result.approvalTxId, undefined);
  assert.deepEqual(phases, ['checking-allowance', 'submitting-swap', 'swap-submitted']);
});

test('expired quotes are refused before any signing', async () => {
  const events = [];
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch: makeFakeOneInch(), mayan: makeFakeMayan() },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events);

  const stale = makeQuoteView(makeRequest(), { expiresAt: Date.now() - 1 });
  await assert.rejects(() => svc.executeSwap(stale), /expired/i);
  assert.equal(events.length, 0, 'nothing was signed or sent');
});

test('Solana-source swaps require a password before any traffic', async () => {
  const mayan = makeFakeMayan();
  const { svc } = await buildService('solana-mainnet', { swapClients: { mayan } });

  const request = makeRequest({
    fromNetworkKey: 'solana-mainnet',
    fromToken: NATIVE_SOL,
    toNetworkKey: 'mainnet',
    toToken: NATIVE_ETH,
    amount: '2',
  });
  await assert.rejects(() => svc.executeSwap(makeQuoteView(request)), /Password required/i);
  assert.equal(mayan.calls.length, 0);
});

test('Mayan swap from Solana signs with the derived keypair and self-addresses', async () => {
  const mayan = makeFakeMayan();
  const { svc, wallet } = await buildService('solana-mainnet', { swapClients: { mayan } });
  const fakeConnection = { fake: true };
  svc.getSolanaProviderForNetwork = () => ({
    getNetworkKey: () => 'solana-mainnet',
    getPrimaryConnection: () => fakeConnection,
    async estimateFee() { return { feeLamports: 5000, feeSol: '0.000005' }; },
  });

  const request = makeRequest({
    fromNetworkKey: 'solana-mainnet',
    fromToken: NATIVE_SOL,
    toNetworkKey: 'mainnet',
    toToken: NATIVE_ETH,
    amount: '2',
  });
  const result = await svc.executeSwap(makeQuoteView(request), { password: 'pw' });

  assert.equal(result.provider, 'mayan');
  assert.equal(result.txId, 'mayansolsig');
  const call = mayan.calls.find((c) => c.fn === 'swapFromSolana');
  assert.equal(call.origin, wallet.getSolanaAddress(0).address, 'origin is this wallet');
  assert.equal(call.dest.toLowerCase(), wallet.getAddress(), 'destination is this wallet on EVM');
  assert.equal(call.connection, fakeConnection);
});

test('Mayan swap from EVM approves the Forwarder then swaps', async () => {
  const events = [];
  const mayan = makeFakeMayan();
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch: makeFakeOneInch(), mayan },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events, { allowance: 0n });

  const request = makeRequest({ toNetworkKey: 'solana-mainnet', toToken: NATIVE_SOL });
  const result = await svc.executeSwap(makeQuoteView(request));

  assert.equal(events[0].to, USDC.address, 'approval targets the token contract');
  assert.equal(events[1].op, 'wait');
  const call = mayan.calls.find((c) => c.fn === 'swapFromEvm');
  assert.ok(call, 'Mayan executed the swap');
  assert.equal(result.txId, '0xmayanevm');
  assert.equal(result.approvalTxId, events[0].hash);
});

test('active-network provider is restored after an EVM swap on another chain', async () => {
  const events = [];
  const { svc, wallet } = await buildService('mainnet', {
    swapClients: { oneinch: makeFakeOneInch(), mayan: makeFakeMayan() },
  });
  wallet.getEvmSignerForNetwork = async () => makeFakeSigner(events);

  const request = makeRequest({
    fromNetworkKey: 'polygon',
    toNetworkKey: 'polygon',
    fromToken: { ...NATIVE_ETH, symbol: 'POL' },
    toToken: USDC,
    amount: '5',
  });
  await svc.executeSwap(makeQuoteView(request));

  assert.equal(wallet.provider.chainId, 1, 'active-network (mainnet) provider restored');
});

test('getSwapStatus maps 1inch receipts and delegates Mayan lookups', async () => {
  const mayan = makeFakeMayan();
  let receipt = null;
  const factory = {
    createProvider: (url, chainId) => ({
      url, chainId,
      async getBlockNumber() { return 1; },
      async getTransactionReceipt() { return receipt; },
    }),
  };
  const { svc } = await buildService('mainnet', { factory, swapClients: { mayan } });

  assert.equal(
    (await svc.getSwapStatus({ provider: 'oneinch', txId: '0x1', fromNetworkKey: 'mainnet' })).state,
    'pending'
  );
  receipt = { status: 1 };
  assert.equal(
    (await svc.getSwapStatus({ provider: 'oneinch', txId: '0x1', fromNetworkKey: 'mainnet' })).state,
    'completed'
  );
  receipt = { status: 0 };
  assert.equal(
    (await svc.getSwapStatus({ provider: 'oneinch', txId: '0x1', fromNetworkKey: 'mainnet' })).state,
    'failed'
  );

  const mayanStatus = await svc.getSwapStatus({ provider: 'mayan', txId: 'sig', fromNetworkKey: 'solana-mainnet' });
  assert.equal(mayanStatus.state, 'completed');
  assert.ok(mayan.calls.some((c) => c.fn === 'getStatus' && c.txId === 'sig'));
});
