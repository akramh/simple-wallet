/**
 * @file swap-messages.test.js
 * @description Contract tests for the extension's swap message plumbing.
 *
 * The MV3 service worker cannot be imported under Node (chrome.* globals), so
 * following the repo idiom for extension logic (see staking-messages.test.js /
 * dapp-approval.test.js) the EXECUTE_SWAP dispatch logic is reimplemented here
 * verbatim and tested for its contract: locked-wallet rejection, the
 * password asymmetry (session password demanded for Solana sources only),
 * unknown-network rejection, and SwapQuoteView serializability across the
 * chrome.runtime message boundary.
 *
 * Keep in sync with extension/background/service-worker.ts (EXECUTE_SWAP case).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- Reimplementation of the service worker's EXECUTE_SWAP handler ---------
async function handleExecuteSwap(payload, ctx) {
  const { isUnlocked, walletService, getSessionPassword, onProgress } = ctx;
  if (!isUnlocked) throw new Error('Wallet is locked');
  if (!walletService) throw new Error('Wallet not initialized');

  const swapQuote = payload?.quote;
  if (!swapQuote?.request) {
    throw new Error('A swap quote is required');
  }
  const swapNetwork = swapQuote.request.fromNetworkKey;
  const swapNetConfig = walletService.config.networks[swapNetwork];
  if (!swapNetConfig) {
    throw new Error(`Unknown network: ${swapNetwork}`);
  }

  let swapPassword;
  if (walletService.isNetworkSolana(swapNetwork)) {
    const sessionPassword = getSessionPassword();
    if (!sessionPassword) {
      throw new Error('Session password not available. Please unlock wallet again.');
    }
    swapPassword = sessionPassword;
  }

  const swapResult = await walletService.executeSwap(swapQuote, {
    password: swapPassword,
    onProgress,
  });
  return { result: swapResult };
}
// ---------------------------------------------------------------------------

function makeQuote(overrides = {}) {
  const request = {
    fromNetworkKey: 'mainnet',
    fromToken: { symbol: 'USDC', name: 'USD Coin', type: 'erc20', address: '0xa0b8', decimals: 6 },
    toNetworkKey: 'mainnet',
    toToken: { symbol: 'ETH', name: 'Ether', type: 'native', address: '', decimals: 18 },
    amount: '100',
    slippagePercent: 1,
    ...(overrides.request || {}),
  };
  return {
    provider: 'oneinch',
    fromNetworkKey: request.fromNetworkKey,
    toNetworkKey: request.toNetworkKey,
    fromTokenSymbol: request.fromToken.symbol,
    toTokenSymbol: request.toToken.symbol,
    amountInFormatted: '100',
    amountOutFormatted: '0.029',
    minAmountOutFormatted: '0.0287',
    rateFormatted: '1 USDC ≈ 0.00029 ETH',
    feeFormatted: '~0.001 ETH',
    needsApproval: true,
    approvalSpender: '0x1111111254eeb25477b68fb85ed929f73a960582',
    expiresAt: Date.now() + 45_000,
    raw: { dstAmount: '29000000000000000', gas: 180000 },
    ...overrides,
    request,
  };
}

function makeCtx(overrides = {}) {
  const calls = [];
  return {
    calls,
    isUnlocked: true,
    getSessionPassword: () => 'session-pw',
    walletService: {
      config: {
        network: 'mainnet',
        networks: {
          mainnet: { chainId: 1 },
          polygon: { chainId: 137 },
          'solana-mainnet': { type: 'solana' },
        },
      },
      isNetworkSolana: (key) => key === 'solana-mainnet',
      executeSwap: async (quote, options) => {
        calls.push(['executeSwap', quote, options?.password]);
        return {
          provider: quote.provider,
          txId: '0xswap',
          approvalTxId: quote.needsApproval ? '0xapproval' : undefined,
          fromNetworkKey: quote.request.fromNetworkKey,
          toNetworkKey: quote.request.toNetworkKey,
        };
      },
    },
    ...overrides,
  };
}

test('EXECUTE_SWAP rejects when the wallet is locked', async () => {
  const ctx = makeCtx({ isUnlocked: false });
  await assert.rejects(() => handleExecuteSwap({ quote: makeQuote() }, ctx), /Wallet is locked/);
});

test('EXECUTE_SWAP rejects a payload without a quote', async () => {
  const ctx = makeCtx();
  await assert.rejects(() => handleExecuteSwap({}, ctx), /swap quote is required/i);
  assert.equal(ctx.calls.length, 0);
});

test('EXECUTE_SWAP rejects an unknown source network', async () => {
  const ctx = makeCtx();
  const quote = makeQuote({ request: { fromNetworkKey: 'nope' } });
  await assert.rejects(() => handleExecuteSwap({ quote }, ctx), /Unknown network: nope/);
});

test('EVM-source swaps execute without demanding a session password', async () => {
  // The EVM signer is already unlocked in memory — asking for a password here
  // would be a UX regression and a needless secret hop.
  const ctx = makeCtx({
    getSessionPassword: () => {
      throw new Error('getSessionPassword must not be called for EVM sources');
    },
  });
  const { result } = await handleExecuteSwap({ quote: makeQuote() }, ctx);
  assert.equal(result.txId, '0xswap');
  assert.equal(ctx.calls[0][2], undefined, 'no password passed for EVM sources');
});

test('Solana-source swaps inject the session password', async () => {
  const ctx = makeCtx();
  const quote = makeQuote({
    provider: 'mayan',
    request: {
      fromNetworkKey: 'solana-mainnet',
      fromToken: { symbol: 'SOL', name: 'Solana', type: 'native', address: '', decimals: 9 },
      toNetworkKey: 'mainnet',
    },
  });
  const { result } = await handleExecuteSwap({ quote }, ctx);
  assert.equal(result.provider, 'mayan');
  assert.equal(ctx.calls[0][2], 'session-pw', 'session password injected for Solana sources');
});

test('Solana-source swaps reject when the session password is missing', async () => {
  const ctx = makeCtx({ getSessionPassword: () => null });
  const quote = makeQuote({
    request: {
      fromNetworkKey: 'solana-mainnet',
      fromToken: { symbol: 'SOL', name: 'Solana', type: 'native', address: '', decimals: 9 },
      toNetworkKey: 'mainnet',
    },
  });
  await assert.rejects(() => handleExecuteSwap({ quote }, ctx), /Session password not available/);
  assert.equal(ctx.calls.length, 0, 'nothing executed without the password');
});

test('progress callbacks are forwarded to the service layer', async () => {
  const phases = [];
  const ctx = makeCtx({ onProgress: (phase) => phases.push(phase) });
  ctx.walletService.executeSwap = async (quote, options) => {
    options.onProgress?.('checking-allowance');
    options.onProgress?.('swap-submitted');
    return { provider: 'oneinch', txId: '0x1', fromNetworkKey: 'mainnet', toNetworkKey: 'mainnet' };
  };
  await handleExecuteSwap({ quote: makeQuote() }, ctx);
  assert.deepEqual(phases, ['checking-allowance', 'swap-submitted']);
});

test('SwapQuoteView survives the chrome.runtime message round-trip', async () => {
  // The popup passes the quote back verbatim; anything non-serializable in
  // `raw` would silently arrive as {} and execute the wrong swap.
  const quote = makeQuote();
  const roundTripped = JSON.parse(JSON.stringify(quote));
  assert.deepEqual(roundTripped, quote);

  const ctx = makeCtx();
  const { result } = await handleExecuteSwap({ quote: roundTripped }, ctx);
  assert.equal(result.txId, '0xswap');
  assert.equal(result.approvalTxId, '0xapproval');
  assert.deepEqual(ctx.calls[0][1].raw, quote.raw, 'opaque provider payload preserved');
});
