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
