import { test } from 'node:test';
import assert from 'node:assert/strict';
import inquirer from 'inquirer';
import { deriveTonAddress } from '../dist/ton/index.js';

process.env.NODE_ENV = 'test';

const app = await import('../dist/index.js');

function withPromptQueue(queue, fn) {
  const originalPrompt = inquirer.prompt;
  inquirer.prompt = async () => queue.shift() || {};
  return fn().finally(() => { inquirer.prompt = originalPrompt; });
}

test('checkBalance shows portfolio without throwing', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;
  // WalletAppService.getPortfolioForNetwork routes through EthereumProvider for EVM networks.
  app.wallet.ethereumProvider.getPortfolioForNetwork = async (tokens) =>
    tokens.map((t) => ({ token: t, balance: '1.0' }));

  await withPromptQueue([{ continue: '' }], () => app.checkBalance('TestWallet'));
});

test('sendCrypto confirm path executes without error', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;
  app.wallet.sendToken = async () => ({ hash: '0xhash', blockNumber: 1, gasUsed: '21000' });

  const prompts = [
    { tokenSymbol: 'ETH' },
    { toAddress: '0x0000000000000000000000000000000000000001' },
    { amount: '0.1' },
    { confirm: true },
    { continue: '' }
  ];

  await withPromptQueue(prompts, () => app.sendCrypto('TestWallet'));
});

test('sendCrypto handles TON send flow without error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ quotes: { USD: { price: 2.5, percent_change_24h: 0 } } })
  });

  const { address } = deriveTonAddress('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 0);

  try {
    app.config.network = 'ton-mainnet';
    app.wallet.config.network = 'ton-mainnet';
    app.wallet.getAddress = () => address;
    app.wallet.currentAccountIndex = 0;
    app.walletService.getGasEstimate = async () => ({
      gasLimit: '1',
      gasPrice: '0',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '0',
      estimatedCostNative: '0',
      nativeSymbol: 'TON',
      supportsEIP1559: false,
      network: 'ton-mainnet'
    });
    app.walletService.sendTonTransaction = async () => ({ hash: 'tonhash' });

    const prompts = [
      { toAddress: address },
      { amount: '1.2' },
      { comment: 'hello' },
      { confirm: true },
      { password: 'password123' },
      { continue: '' }
    ];

    await withPromptQueue(prompts, () => app.sendCrypto('TestWallet'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkPortfolioAllNetworks aggregates without error', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  const seenNetworks = [];
  app.wallet.setNetwork = async (net) => { seenNetworks.push(net); };
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;
  // WalletAppService.getPortfolioForNetwork routes through EthereumProvider for EVM networks.
  app.wallet.ethereumProvider.getPortfolioForNetwork = async (tokens) =>
    tokens.map((t) => ({ token: t, balance: '0' }));

  await withPromptQueue([{ continue: '' }], () => app.checkPortfolioAllNetworks('TestWallet'));

  assert.ok(seenNetworks.length > 0, 'setNetwork should be called for each network');
});

test('changeNetwork switches wallet without exiting', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  let switched = false;
  app.wallet.setNetwork = async () => { switched = true; };

  await withPromptQueue([{ network: 'mainnet' }, { continue: '' }], () => app.changeNetwork());

  assert.ok(switched, 'wallet.setNetwork should be invoked');
});

test('swapMenu happy path: quote, confirm, execute, status', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;

  const calls = [];
  app.walletService.getSwapCapabilities = () => ({
    canSwap: true, sameChain: true, crossChain: true,
    destinationNetworkKeys: ['mainnet', 'polygon', 'solana-mainnet'],
  });
  app.walletService.getSwapQuote = async (request) => {
    calls.push({ fn: 'quote', request });
    return {
      provider: 'oneinch',
      fromNetworkKey: request.fromNetworkKey,
      toNetworkKey: request.toNetworkKey,
      fromTokenSymbol: request.fromToken.symbol,
      toTokenSymbol: request.toToken.symbol,
      amountInFormatted: request.amount,
      amountOutFormatted: '3412.55',
      minAmountOutFormatted: '3378.42',
      rateFormatted: '1 ETH ≈ 3412.55 USDC',
      feeFormatted: '~0.001 ETH',
      needsApproval: false,
      expiresAt: Date.now() + 45_000,
      raw: {},
      request,
    };
  };
  app.walletService.executeSwap = async (quote, options) => {
    calls.push({ fn: 'execute', quote });
    options?.onProgress?.('submitting-swap');
    options?.onProgress?.('swap-submitted');
    return { provider: 'oneinch', txId: '0xswap', fromNetworkKey: 'mainnet', toNetworkKey: 'mainnet' };
  };
  app.walletService.getSwapStatus = async (query) => {
    calls.push({ fn: 'status', query });
    return { state: 'completed', destTxId: '0xswap' };
  };

  const prompts = [
    { fromSymbol: 'ETH' },
    { toNetworkKey: 'mainnet' },
    { toSymbol: 'USDC' },
    { amount: '1' },
    { confirm: true },
    { continue: '' },
  ];
  await withPromptQueue(prompts, () => app.swapMenu('TestWallet'));

  assert.equal(calls.filter((c) => c.fn === 'quote').length, 1, 'one quote fetched');
  assert.equal(calls.filter((c) => c.fn === 'execute').length, 1, 'swap executed');
  assert.equal(calls.filter((c) => c.fn === 'status').length, 1, 'status checked once in test mode');
  const request = calls.find((c) => c.fn === 'quote').request;
  assert.equal(request.fromNetworkKey, 'mainnet');
  assert.equal(request.toNetworkKey, 'mainnet');
  assert.equal(request.amount, '1');
});

test('swapMenu cancel at confirm sends nothing', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;

  let executed = false;
  app.walletService.getSwapCapabilities = () => ({
    canSwap: true, sameChain: true, crossChain: true,
    destinationNetworkKeys: ['mainnet', 'polygon'],
  });
  app.walletService.getSwapQuote = async (request) => ({
    provider: 'oneinch',
    fromNetworkKey: request.fromNetworkKey,
    toNetworkKey: request.toNetworkKey,
    fromTokenSymbol: request.fromToken.symbol,
    toTokenSymbol: request.toToken.symbol,
    amountInFormatted: request.amount,
    amountOutFormatted: '1',
    minAmountOutFormatted: '0.99',
    rateFormatted: '',
    feeFormatted: '',
    needsApproval: true,
    approvalSpender: '0x1111111254eeb25477b68fb85ed929f73a960582',
    expiresAt: Date.now() + 45_000,
    raw: {},
    request,
  });
  app.walletService.executeSwap = async () => { executed = true; return {}; };

  const prompts = [
    { fromSymbol: 'ETH' },
    { toNetworkKey: 'mainnet' },
    { toSymbol: 'USDC' },
    { amount: '1' },
    { confirm: false },
  ];
  await withPromptQueue(prompts, () => app.swapMenu('TestWallet'));

  assert.equal(executed, false, 'declining the confirmation must not execute the swap');
});

test('swapMenu on an unsupported network explains and exits cleanly', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;

  let quoted = false;
  app.walletService.getSwapCapabilities = () => ({
    canSwap: false, sameChain: false, crossChain: false,
    destinationNetworkKeys: [],
    unsupportedReason: 'Swaps are not supported on Bitcoin',
  });
  app.walletService.getSwapQuote = async () => { quoted = true; return {}; };

  await withPromptQueue([{ continue: '' }], () => app.swapMenu('TestWallet'));
  assert.equal(quoted, false, 'no quote is fetched on an unsupported network');
});
