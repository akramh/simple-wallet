/**
 * @fileoverview Mayan Finance client (cross-chain swaps: EVM↔EVM, EVM↔Solana).
 *
 * Wraps @mayanfinance/swap-sdk behind a small injectable surface. The real
 * SDK is loaded lazily via dynamic import on first use so the CLI/extension/
 * mobile bundles only pay for it on the swap path, and tests inject a fake
 * `MayanSdkLike` without ever touching the SDK or the network.
 *
 * Quotes come from price-api.mayan.finance (keyless), execution goes through
 * the SDK (`swapFromEvm` / `swapFromSolana`), and status is polled from the
 * Mayan explorer API by source-chain tx hash.
 *
 * @responsibilities
 * - Normalize SDK quote/execute signatures for WalletAppService
 * - Map Mayan explorer `clientStatus` to the chain-neutral SwapStatusView
 *
 * @security
 * - EVM signing uses the caller-provided ethers Signer; Solana signing runs
 *   inside the caller's sign callback — key material never enters this module.
 * - Gasless (relayer-signed) modes are disabled: quotes are requested with
 *   `gasless: false` so execution always goes through the wallet's own signer
 *   and the standard price/relayer/explorer hosts in ALLOWED_DOMAINS.
 * - Tests must inject `sdk` and `fetchFn` — no live network calls in tests.
 *
 * @module swap/mayan
 */

import type { Signer } from 'ethers';
import type { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import type { SwapStatusView } from '../types/swap.js';

/** Bounded timeout for explorer status polls. */
const STATUS_TIMEOUT_MS = 15_000;

/**
 * A Mayan quote as returned by fetchQuote. Treated as opaque apart from the
 * display fields read by WalletAppService; passed back to the SDK verbatim.
 * Plain JSON — safe to round-trip through chrome messages / route params.
 */
export interface MayanQuote {
  type: string;
  expectedAmountOut: number;
  minAmountOut: number;
  price: number;
  etaSeconds: number;
  clientRelayerFeeSuccess: number | null;
  clientRelayerFeeRefund: number | null;
  /** Unix-seconds deadline (stringified u64) after which the quote is dead. */
  deadline64: string;
  [key: string]: unknown;
}

/** Signs a Solana transaction and returns it; the key stays with the caller. */
export type SolanaSignCallback = <T extends Transaction | VersionedTransaction>(
  tx: T
) => Promise<T>;

/**
 * Structural subset of @mayanfinance/swap-sdk consumed by this module.
 * Tests inject a fake; production resolves the real SDK lazily.
 */
export interface MayanSdkLike {
  fetchQuote(
    params: {
      amountIn64: string;
      fromToken: string;
      fromChain: string;
      toToken: string;
      toChain: string;
      slippageBps: 'auto' | number;
    },
    options?: { gasless?: boolean }
  ): Promise<MayanQuote[]>;
  swapFromEvm(
    quote: MayanQuote,
    swapperAddress: string,
    destinationAddress: string,
    referrerAddresses: null,
    signer: Signer,
    permit: null,
    overrides: null,
    payload: null
  ): Promise<{ hash: string } | string>;
  swapFromSolana(
    quote: MayanQuote,
    swapperWalletAddress: string,
    destinationAddress: string,
    referrerAddresses: null,
    signTransaction: SolanaSignCallback,
    connection: Connection
  ): Promise<{ signature: string }>;
  addresses: { MAYAN_FORWARDER_CONTRACT: string };
}

/** Options for {@link MayanClient}. */
export interface MayanClientOptions {
  /** Injected SDK (test seam). Defaults to a lazy import of the real SDK. */
  sdk?: MayanSdkLike;
  /** Injectable fetch for explorer status polls (test seam). */
  fetchFn?: typeof fetch;
  /** Override explorer base URL (tests only). */
  explorerBaseUrl?: string;
}

/** User-presentable failure from Mayan quoting or status lookup. */
export class MayanApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MayanApiError';
  }
}

/**
 * Client for Mayan cross-chain swaps. One instance serves all chain pairs.
 */
export class MayanClient {
  private sdk: MayanSdkLike | null;
  private readonly fetchFn: typeof fetch;
  private readonly explorerBaseUrl: string;

  constructor(options: MayanClientOptions = {}) {
    this.sdk = options.sdk ?? null;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.explorerBaseUrl = options.explorerBaseUrl ?? 'https://explorer-api.mayan.finance/v3';
  }

  /** Resolve the SDK, importing it on first use. @private */
  private async getSdk(): Promise<MayanSdkLike> {
    if (!this.sdk) {
      // Lazy so bundles without a swap flow never load the SDK.
      this.sdk = (await import('@mayanfinance/swap-sdk')) as unknown as MayanSdkLike;
    }
    return this.sdk;
  }

  /**
   * Fetch the best route for a cross-chain pair. Returns the first quote —
   * Mayan orders quotes best-first.
   *
   * @param params.amountIn64 - Input amount in base units (decimal string)
   * @param params.fromToken / toToken - Provider addresses (see toMayanAddress)
   * @param params.fromChain / toChain - Mayan chain names (see MAYAN_NETWORKS)
   * @param params.slippageBps - Basis points, or 'auto'
   * @throws {MayanApiError} when no route exists or the API errors
   * @async
   */
  async fetchQuote(params: {
    amountIn64: string;
    fromToken: string;
    fromChain: string;
    toToken: string;
    toChain: string;
    slippageBps: 'auto' | number;
  }): Promise<MayanQuote> {
    const sdk = await this.getSdk();
    let quotes: MayanQuote[];
    try {
      quotes = await sdk.fetchQuote(params, { gasless: false });
    } catch (err) {
      throw new MayanApiError(describeQuoteFailure(err));
    }
    if (!quotes || quotes.length === 0) {
      throw new MayanApiError('No route found for this pair — try a different amount or token');
    }
    return quotes[0];
  }

  /** Address that must be approved to spend ERC-20 inputs on EVM chains. */
  async getForwarderAddress(): Promise<string> {
    const sdk = await this.getSdk();
    return sdk.addresses.MAYAN_FORWARDER_CONTRACT;
  }

  /**
   * Execute a swap whose source chain is EVM. The SDK builds and sends the
   * transaction through `signer`; ERC-20 allowance for the Forwarder must
   * already be in place (WalletAppService handles approval).
   *
   * @returns The source-chain transaction hash
   * @async
   */
  async swapFromEvm(
    quote: MayanQuote,
    swapperAddress: string,
    destinationAddress: string,
    signer: Signer
  ): Promise<{ txHash: string }> {
    const sdk = await this.getSdk();
    const result = await sdk.swapFromEvm(
      quote,
      swapperAddress,
      destinationAddress,
      null,
      signer,
      null,
      null,
      null
    );
    // Gasless mode is disabled, so the SDK returns a TransactionResponse;
    // the string branch exists only for gasless order signatures.
    if (typeof result === 'string') {
      throw new MayanApiError('Unexpected gasless response from Mayan — swap not submitted');
    }
    return { txHash: result.hash };
  }

  /**
   * Execute a swap whose source chain is Solana. Signing happens inside
   * `signTx`; this module never sees the keypair.
   *
   * @returns The source-chain transaction signature
   * @async
   */
  async swapFromSolana(
    quote: MayanQuote,
    originAddress: string,
    destinationAddress: string,
    signTx: SolanaSignCallback,
    connection: Connection
  ): Promise<{ signature: string }> {
    const sdk = await this.getSdk();
    const result = await sdk.swapFromSolana(
      quote,
      originAddress,
      destinationAddress,
      null,
      signTx,
      connection
    );
    return { signature: result.signature };
  }

  /**
   * Point-in-time swap status by source-chain tx hash/signature.
   * Unknown transactions report as `pending` — Mayan's indexer can lag the
   * chain by a few seconds, and "not found yet" is not a failure.
   *
   * @throws {MayanApiError} on transport errors (not on not-found)
   * @async
   */
  async getStatus(txId: string): Promise<SwapStatusView> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.explorerBaseUrl}/swap/trx/${encodeURIComponent(txId)}`,
        { signal: controller.signal }
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MayanApiError('Mayan status request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return { state: 'pending', detail: 'Waiting for Mayan to index the transaction' };
    }
    if (!response.ok) {
      throw new MayanApiError(`Mayan status request failed (HTTP ${response.status})`);
    }

    const body = (await response.json()) as {
      clientStatus?: string;
      fulfillTxHash?: string;
      toTxHash?: string;
      statusUpdatedAt?: string;
    };
    const destTxId = body.fulfillTxHash || body.toTxHash || undefined;
    switch (body.clientStatus) {
      case 'COMPLETED':
        return { state: 'completed', destTxId };
      case 'REFUNDED':
        return {
          state: 'refunded',
          destTxId,
          detail: 'The swap could not complete; funds were returned on the source chain',
        };
      case 'INPROGRESS':
        return { state: 'pending' };
      default:
        // Unknown status vocabulary — treat as still in flight rather than
        // scaring the user with a false failure.
        return { state: 'pending', detail: body.clientStatus };
    }
  }
}

/** Map SDK/API quote failures to a user-readable message. @private */
function describeQuoteFailure(err: unknown): string {
  const message =
    err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
      ? err.message
      : '';
  const lower = message.toLowerCase();
  if (lower.includes('amount') && (lower.includes('small') || lower.includes('min'))) {
    return 'Amount is below the minimum for this route — try a larger amount';
  }
  if (lower.includes('route') || lower.includes('not supported') || lower.includes('no quote')) {
    return 'No route found for this pair — try a different amount or token';
  }
  return message ? `Mayan quote failed: ${message}` : 'Mayan quote failed — try again';
}
