import { test } from 'node:test';
import assert from 'node:assert/strict';
import inquirer from 'inquirer';

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
  app.wallet.getPortfolio = async (tokens) => tokens.map(t => ({ token: t, balance: '1.0' }));

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

test('checkPortfolioAllNetworks aggregates without error', async () => {
  app.config.network = 'mainnet';
  app.wallet.config.network = 'mainnet';
  const seenNetworks = [];
  app.wallet.setNetwork = async (net) => { seenNetworks.push(net); };
  app.wallet.getAddress = () => '0xabc0000000000000000000000000000000000000';
  app.wallet.currentAccountIndex = 0;
  app.wallet.getPortfolio = async (tokens) => tokens.map(t => ({ token: t, balance: '0' }));

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
