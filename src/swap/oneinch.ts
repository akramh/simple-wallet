/**
 * @fileoverview 1inch Classic Swap API v6 client (same-chain EVM swaps).
 *
 * Thin typed wrapper over the REST API at api.1inch.dev. Quotes return output
 * amounts only; ready-to-sign calldata is fetched separately at execute time
 * (getSwapTx) so it is never built from a stale quote. The router (spender)
 * address is cached per chain for the process lifetime — it changes only with
 * a router redeploy.
 *
 * @responsibilities
 * - Build authenticated requests (Bearer ONEINCH_API_KEY) with bounded timeouts
 * - Map 1inch error responses to user-readable messages
 *
 * @security
 * - The API key is held in memory only and never appears in error messages
 *   or logs (it travels in a header, not the URL).
 * - `api.1inch.dev` must stay in ALLOWED_DOMAINS (src/config/network-policy.ts);
 *   the runtime network guard and extension CSP both enforce it.
 * - Tests must inject `fetchFn` — no live network calls in the test suite.
 *
 * @module swap/oneinch
 */

/** Bounded request timeout — quotes are useless if they arrive late anyway. */
const REQUEST_TIMEOUT_MS = 15_000;

// ============================================================================
// Runtime configuration
// ============================================================================

/**
 * Runtime-configurable API key for environments where build-time env
 * inlining isn't used (React Native / extension runtime entry). Mirrors the
 * `setAlchemyApiKey` pattern in src/price-providers/alchemy.ts.
 */
let configuredApiKey: string | undefined;

/**
 * Register the 1inch API key at runtime. Call at app startup in the
 * extension service worker and mobile WalletBridge; the CLI picks up
 * `process.env.ONEINCH_API_KEY` automatically via dotenv.
 *
 * @param apiKey - 1inch key from portal.1inch.dev
 */
export function setOneInchApiKey(apiKey: string | undefined): void {
  configuredApiKey = apiKey;
}

/**
 * Resolve the 1inch key: runtime-configured value first, then `ONEINCH_API_KEY`
 * / `VITE_ONEINCH_API_KEY` from process.env. Undefined disables same-chain
 * swaps (capabilities degrade; nothing throws at startup).
 */
export function resolveOneInchApiKey(): string | undefined {
  if (configuredApiKey) {
    return configuredApiKey;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.ONEINCH_API_KEY || process.env.VITE_ONEINCH_API_KEY || undefined;
  }
  return undefined;
}

/** Options for {@link OneInchClient}. */
export interface OneInchClientOptions {
  /** 1inch API key (portal.1inch.dev). Required for every endpoint. */
  apiKey: string;
  /** Injectable fetch (test seam; defaults to global fetch). */
  fetchFn?: typeof fetch;
  /** Override base URL (tests only). */
  baseUrl?: string;
}

/** Output of the /quote endpoint. */
export interface OneInchQuote {
  /** Expected destination amount in base units (decimal string). */
  dstAmount: string;
  /** Estimated gas units when the API returns them. */
  gas?: number;
}

/** Output of the /swap endpoint — a ready-to-sign transaction. */
export interface OneInchSwapTx {
  to: string;
  data: string;
  /** Native value to attach, base units (decimal string). */
  value: string;
  /** Gas limit suggested by 1inch. */
  gas: number;
  /** Destination amount this calldata was built for, base units. */
  dstAmount: string;
}

/** User-presentable failure from the 1inch API. */
export class OneInchApiError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OneInchApiError';
    this.status = status;
  }
}

/**
 * Minimal client for the 1inch Classic Swap API v6.
 *
 * One instance serves all chains — the chain id is a path parameter.
 */
export class OneInchClient {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  /** Router (spender) address per chain id; stable per deployment. */
  private readonly spenderCache = new Map<number, string>();

  constructor(options: OneInchClientOptions) {
    if (!options.apiKey) {
      throw new Error('OneInchClient requires an API key (set ONEINCH_API_KEY)');
    }
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? 'https://api.1inch.dev/swap/v6.0';
  }

  /**
   * Fetch the expected output for a swap. No calldata — display only.
   *
   * @param chainId - EIP-155 chain id
   * @param src - Source token address (native = 0xEeee… sentinel)
   * @param dst - Destination token address
   * @param amountBaseUnits - Input amount in base units (decimal string)
   * @throws {OneInchApiError} on HTTP or liquidity errors
   * @async
   */
  async getQuote(
    chainId: number,
    src: string,
    dst: string,
    amountBaseUnits: string
  ): Promise<OneInchQuote> {
    const body = await this.request(chainId, 'quote', {
      src,
      dst,
      amount: amountBaseUnits,
      includeGas: 'true',
    });
    return {
      dstAmount: String((body as { dstAmount: string }).dstAmount),
      gas: typeof (body as { gas?: number }).gas === 'number' ? (body as { gas: number }).gas : undefined,
    };
  }

  /**
   * Fetch ready-to-sign swap calldata. Call at execute time, never at quote
   * time — 1inch builds calldata against current prices.
   *
   * @param chainId - EIP-155 chain id
   * @param src - Source token address
   * @param dst - Destination token address
   * @param amountBaseUnits - Input amount in base units (decimal string)
   * @param fromAddress - The wallet address sending the swap
   * @param slippagePercent - Max slippage in percent (e.g. 1 = 1%)
   * @throws {OneInchApiError} on HTTP or liquidity errors
   * @async
   */
  async getSwapTx(
    chainId: number,
    src: string,
    dst: string,
    amountBaseUnits: string,
    fromAddress: string,
    slippagePercent: number
  ): Promise<OneInchSwapTx> {
    const body = (await this.request(chainId, 'swap', {
      src,
      dst,
      amount: amountBaseUnits,
      from: fromAddress,
      origin: fromAddress,
      slippage: String(slippagePercent),
    })) as { tx: { to: string; data: string; value: string; gas: number }; dstAmount: string };
    if (!body.tx?.to || !body.tx?.data) {
      throw new OneInchApiError('1inch returned an incomplete transaction', 502);
    }
    return {
      to: body.tx.to,
      data: body.tx.data,
      value: String(body.tx.value ?? '0'),
      gas: body.tx.gas,
      dstAmount: String(body.dstAmount),
    };
  }

  /**
   * Router address that must be approved to spend ERC-20 inputs.
   * Cached per chain for the process lifetime.
   *
   * @param chainId - EIP-155 chain id
   * @throws {OneInchApiError} on HTTP errors
   * @async
   */
  async getSpender(chainId: number): Promise<string> {
    const cached = this.spenderCache.get(chainId);
    if (cached) {
      return cached;
    }
    const body = (await this.request(chainId, 'approve/spender', {})) as { address: string };
    if (!body.address) {
      throw new OneInchApiError('1inch returned no spender address', 502);
    }
    this.spenderCache.set(chainId, body.address);
    return body.address;
  }

  /**
   * Perform a GET against the API and map failures to user-readable errors.
   * @private
   */
  private async request(
    chainId: number,
    path: string,
    params: Record<string, string>
  ): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${chainId}/${path}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OneInchApiError('1inch request timed out — try again', 408);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new OneInchApiError(await this.describeFailure(response), response.status);
    }
    return response.json();
  }

  /**
   * Turn an error response into a message safe and useful to show a user.
   * Never includes the API key (it is never part of the URL or body).
   * @private
   */
  private async describeFailure(response: Response): Promise<string> {
    if (response.status === 429) {
      return '1inch rate limit reached — wait a moment and try again';
    }
    if (response.status === 401 || response.status === 403) {
      return '1inch rejected the API key — check ONEINCH_API_KEY';
    }
    let detail = '';
    try {
      const body = (await response.json()) as { description?: string; error?: string };
      detail = body.description || body.error || '';
    } catch {
      // Non-JSON error body; fall through to the generic message.
    }
    const lower = detail.toLowerCase();
    if (lower.includes('insufficient liquidity')) {
      return 'Not enough liquidity for this pair — try a smaller amount';
    }
    if (lower.includes('cannot estimate')) {
      return '1inch could not build this swap — check the amount and token balance';
    }
    return detail
      ? `1inch error: ${detail}`
      : `1inch request failed (HTTP ${response.status})`;
  }
}
