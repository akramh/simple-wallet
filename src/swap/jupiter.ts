/**
 * @fileoverview Jupiter Swap V2 client for same-chain Solana swaps.
 *
 * Uses Jupiter's meta-aggregator `/order` + `/execute` flow: eligible routers
 * compete for the quote, the wallet signs the returned versioned
 * transaction locally, and Jupiter manages submission/confirmation. Quote
 * display requests omit the taker; execution always fetches a fresh order.
 *
 * @responsibilities
 * - Build authenticated Jupiter Swap V2 order/execute requests
 * - Deserialize versioned transactions without exposing signing material
 * - Map provider failures to concise, user-presentable errors
 *
 * @security
 * - The API key travels only in the x-api-key header and is never logged.
 * - Private keys never enter this module; callers provide a signing callback.
 * - Tests inject fetch and signing seams; no live network calls are allowed.
 *
 * @module swap/jupiter
 */

import { VersionedTransaction } from '@solana/web3.js';

const REQUEST_TIMEOUT_MS = 15_000;

/** Wrapped SOL mint used by Jupiter for the native SOL asset. */
export const JUPITER_NATIVE_MINT = 'So11111111111111111111111111111111111111112';

let configuredApiKey: string | undefined;

/**
 * Register the Jupiter API key for browser/mobile runtimes.
 *
 * @param apiKey - Jupiter developer portal key, or undefined to disable.
 * @returns Nothing.
 */
export function setJupiterApiKey(apiKey: string | undefined): void {
  configuredApiKey = apiKey?.trim() || undefined;
}

/**
 * Resolve the configured Jupiter key, falling back to Node environment vars.
 *
 * @returns Jupiter API key or undefined when same-chain Solana is disabled.
 */
export function resolveJupiterApiKey(): string | undefined {
  if (configuredApiKey) return configuredApiKey;
  if (typeof process !== 'undefined' && process.env) {
    return process.env.JUPITER_API_KEY || process.env.VITE_JUPITER_API_KEY || undefined;
  }
  return undefined;
}

/** JSON response returned by Jupiter Swap V2 `/order`. */
export interface JupiterOrder {
  transaction: string | null;
  requestId: string;
  inAmount: string;
  outAmount: string;
  /** Minimum output encoded by Jupiter after applying the order's slippage. */
  otherAmountThreshold: string;
  slippageBps: number;
  router: string;
  mode: string;
  feeBps: number;
  feeMint?: string;
  expireAt?: string;
  lastValidBlockHeight?: number;
  errorCode?: number;
  errorMessage?: string;
}

/** Parameters for a Jupiter exact-input order. */
export interface JupiterOrderParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  /** Wallet address; omit for display-only pricing. */
  taker?: string;
}

/** Successful Jupiter managed-execution response. */
export interface JupiterExecuteResult {
  status: 'Success';
  signature: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
}

/** Options for {@link JupiterClient}. */
export interface JupiterClientOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

/** User-presentable Jupiter API failure. */
export class JupiterApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'JupiterApiError';
  }
}

/**
 * Minimal Jupiter Swap V2 client. Signing remains in WalletAppService.
 */
export class JupiterClient {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: JupiterClientOptions) {
    if (!options.apiKey) {
      throw new Error('JupiterClient requires an API key (set JUPITER_API_KEY)');
    }
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? 'https://api.jup.ag/swap/v2';
  }

  /**
   * Fetch a quote or executable order. A taker produces a transaction; omitting
   * it returns pricing only.
   *
   * @param params - Token mints, exact input amount, slippage bps, and taker.
   * @returns Jupiter order response.
   * @throws {JupiterApiError} For transport, authentication, or route errors.
   * @async
   */
  async fetchOrder(params: JupiterOrderParams): Promise<JupiterOrder> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(params.slippageBps),
    });
    if (params.taker) query.set('taker', params.taker);

    const order = await this.request<JupiterOrder>(`${this.baseUrl}/order?${query}`);
    if (
      !order.outAmount || !/^\d+$/.test(order.outAmount)
      || !order.otherAmountThreshold || !/^\d+$/.test(order.otherAmountThreshold)
    ) {
      throw new JupiterApiError('Jupiter returned an invalid quote', 502);
    }
    if (params.taker && !order.transaction) {
      const detail = order.errorMessage ? `: ${order.errorMessage}` : '';
      throw new JupiterApiError(`Jupiter could not build this swap${detail}`, 400);
    }
    return order;
  }

  /**
   * Sign and execute a previously fetched executable order.
   *
   * @param order - Fresh order containing a base64 versioned transaction.
   * @param signTransaction - Wallet-owned signing callback.
   * @returns Confirmed Jupiter transaction signature and settled amounts.
   * @throws {JupiterApiError} If signing input is incomplete or execution fails.
   * @async
   */
  async executeOrder(
    order: JupiterOrder,
    signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>
  ): Promise<JupiterExecuteResult> {
    if (!order.transaction || !order.requestId) {
      throw new JupiterApiError('Jupiter order is not executable');
    }

    let transaction: VersionedTransaction;
    try {
      transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    } catch {
      throw new JupiterApiError('Jupiter returned an invalid transaction', 502);
    }
    const signed = await signTransaction(transaction);
    const signedTransaction = Buffer.from(signed.serialize()).toString('base64');
    const result = await this.request<{
      status: 'Success' | 'Failed';
      signature?: string;
      code?: number;
      error?: string;
      totalInputAmount?: string;
      totalOutputAmount?: string;
    }>(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
    });

    if (result.status !== 'Success' || !result.signature) {
      const detail = result.error || (result.code !== undefined ? `code ${result.code}` : 'unknown error');
      throw new JupiterApiError(`Jupiter swap failed: ${detail}`);
    }
    return {
      status: 'Success',
      signature: result.signature,
      totalInputAmount: result.totalInputAmount,
      totalOutputAmount: result.totalOutputAmount,
    };
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(url, {
        ...init,
        headers: {
          'x-api-key': this.apiKey,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      let body: unknown = {};
      try {
        body = await response.json();
      } catch {
        // Error mapping below handles non-JSON responses without leaking text.
      }
      if (!response.ok) {
        throw new JupiterApiError(mapJupiterHttpError(response.status, body), response.status);
      }
      return body as T;
    } catch (error) {
      if (error instanceof JupiterApiError) throw error;
      if ((error as Error)?.name === 'AbortError') {
        throw new JupiterApiError('Jupiter request timed out — try again', 408);
      }
      throw new JupiterApiError('Jupiter request failed — try again');
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapJupiterHttpError(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return 'Jupiter rejected the API key — check JUPITER_API_KEY';
  }
  if (status === 429) {
    return 'Jupiter rate limit reached — wait a moment and try again';
  }
  const message = typeof body === 'object' && body !== null
    ? String((body as { error?: unknown; errorMessage?: unknown }).errorMessage
      ?? (body as { error?: unknown }).error
      ?? '')
    : '';
  if (/route|liquidity|not found/i.test(message)) {
    return 'No Jupiter route found for this token pair and amount';
  }
  return message ? `Jupiter error: ${message}` : `Jupiter request failed (HTTP ${status})`;
}
