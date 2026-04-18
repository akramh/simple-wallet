/**
 * @fileoverview Alchemy Portfolio API client.
 *
 * A single `POST /assets/tokens/by-address` call returns native + ERC-20 + SPL
 * balances, prices, and metadata for up to 2 addresses × 5 networks each.
 * This replaces our per-chain fan-out (~24 s for 12 chains) with one or two
 * batched round-trips (~2 – 3 s for the 9 EVM + Solana chains this API
 * covers). Bitcoin / XRP / TON aren't supported and stay on their existing
 * per-chain providers.
 *
 * @responsibilities
 * - Map our internal network keys to Alchemy's network slugs
 * - Batch requests respecting the 2-address × 5-network limit
 * - Parse the hex balance + optional USD price out of each response entry
 * - Return a flat list keyed by (networkKey, tokenKey) the caller can merge
 *   into the existing `balanceCache`
 *
 * @security
 * - URL-embedded API key. Redact via `src/utils/redact-logs.ts` (already
 *   registered in the extension service worker on startup).
 * - No write endpoints touched.
 */

const PORTFOLIO_BASE = 'https://api.g.alchemy.com/data/v1';
const TOKENS_BY_ADDRESS_PATH = '/assets/tokens/by-address';

/** Max networks per address-entry the Portfolio tokens endpoint accepts. */
const MAX_NETWORKS_PER_ADDRESS = 5;

/** Max address-entries per request the Portfolio tokens endpoint accepts. */
const MAX_ADDRESSES_PER_REQUEST = 2;

/** Default fetch timeout — generous because the API fans out to 5 chains. */
const REQUEST_TIMEOUT_MS = 15_000;

// ============================================================================
// Network slug mapping
// ============================================================================

/**
 * Our internal network keys → Alchemy network slugs accepted by the Portfolio
 * tokens endpoint. Anything not in this map is unsupported (BTC / XRP / TON
 * always, plus any testnets we haven't verified).
 */
export const NETWORK_KEY_TO_PORTFOLIO_SLUG: Record<string, string> = {
  mainnet: 'eth-mainnet',
  sepolia: 'eth-sepolia',
  base: 'base-mainnet',
  arbitrum: 'arb-mainnet',
  optimism: 'opt-mainnet',
  polygon: 'polygon-mainnet',
  bsc: 'bnb-mainnet',
  avalanche: 'avax-mainnet',
  linea: 'linea-mainnet',
  'solana-mainnet': 'sol-mainnet',
};

const PORTFOLIO_SLUG_TO_NETWORK_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(NETWORK_KEY_TO_PORTFOLIO_SLUG).map(([k, v]) => [v, k])
);

/** True when this network is served by the Portfolio API. */
export function isPortfolioSupported(networkKey: string): boolean {
  return networkKey in NETWORK_KEY_TO_PORTFOLIO_SLUG;
}

// ============================================================================
// Request / response types
// ============================================================================

/**
 * One wallet-address + its networks that go into a single Portfolio request.
 * Callers (e.g. the service worker) build one of these per chain family:
 * the EVM address with its 8 networks, and — if applicable — the Solana
 * address with `solana-mainnet`.
 */
export interface PortfolioAddressGroup {
  address: string;
  /** Our internal network keys; the client maps them to Alchemy slugs. */
  networkKeys: string[];
}

/**
 * Parsed portfolio entry keyed back to our internal shape.
 * `balance` is a raw decimal string in **display units** (already divided by
 * `10^decimals`), matching what we store in `balanceCache[network][tokenKey]`.
 */
export interface PortfolioEntry {
  networkKey: string;
  /** `'native'` for native tokens, lowercase contract address otherwise. */
  tokenKey: string;
  balance: string;
  decimals: number;
  /** USD price per 1 token, or `null` when Alchemy didn't return one. */
  priceUsd: number | null;
  symbol?: string;
  name?: string;
  logoUrl?: string;
}

/**
 * One raw entry out of `POST /assets/tokens/by-address`. Kept loose — the
 * Portfolio API occasionally omits fields for exotic tokens (e.g. missing
 * metadata), so each field is narrowed defensively in the parser.
 */
interface AlchemyPortfolioTokenRaw {
  network?: string;
  address?: string;
  tokenAddress?: string | null;
  tokenBalance?: string | null;
  tokenMetadata?: {
    name?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    logo?: string | null;
  } | null;
  tokenPrices?: Array<{ currency?: string; value?: string }> | null;
}

interface AlchemyPortfolioResponseRaw {
  data?: {
    tokens?: AlchemyPortfolioTokenRaw[];
    pageKey?: string | null;
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch a batched cross-chain portfolio.
 *
 * Splits the input groups into requests that respect Alchemy's 2-address ×
 * 5-network-each limit, awaits them sequentially (the API is fast enough
 * that parallelism isn't worth the extra rate-limit pressure), and returns
 * a flat list of entries whose network keys are our internal keys — not
 * Alchemy's slugs. Unsupported `networkKeys` are silently dropped; the
 * caller is expected to handle them on a separate code path.
 *
 * Returns an empty array on total failure so the caller can fall back to
 * per-chain fetching without the whole refresh throwing.
 *
 * @param apiKey - Alchemy API key (same one used for RPC + Prices).
 * @param groups - Address groups to query. Must be non-empty.
 */
export async function fetchAlchemyPortfolio(
  apiKey: string,
  groups: PortfolioAddressGroup[],
): Promise<PortfolioEntry[]> {
  if (!apiKey || groups.length === 0) return [];

  const requests = buildRequestBodies(groups);
  const entries: PortfolioEntry[] = [];

  for (const body of requests) {
    try {
      const raw = await callPortfolioEndpoint(apiKey, body);
      entries.push(...parsePortfolioResponse(raw));
    } catch (err) {
      console.warn('[PortfolioAPI] request failed:', err);
      // Keep going — partial results are better than no results.
    }
  }

  return entries;
}

// ============================================================================
// Request building
// ============================================================================

interface PortfolioRequestBody {
  addresses: Array<{ address: string; networks: string[] }>;
}

/**
 * Split address groups into request bodies that each fit within the API's
 * 2-address × 5-network-each limit.
 *
 * Strategy:
 *   1. For each group, if `networkKeys.length > 5`, split that group's
 *      networks into chunks of 5.
 *   2. Pack chunks into requests, up to 2 chunks (addresses) per request.
 *   3. Unsupported network keys are dropped here, not later, so the
 *      response parser doesn't have to know about the mapping.
 *
 * Exported for unit testing — the packing math is easy to get wrong.
 */
export function buildRequestBodies(
  groups: PortfolioAddressGroup[],
): PortfolioRequestBody[] {
  const chunks: Array<{ address: string; networks: string[] }> = [];

  for (const group of groups) {
    const supportedSlugs = group.networkKeys
      .map((key) => NETWORK_KEY_TO_PORTFOLIO_SLUG[key])
      .filter((slug): slug is string => Boolean(slug));
    if (supportedSlugs.length === 0 || !group.address) continue;

    for (let i = 0; i < supportedSlugs.length; i += MAX_NETWORKS_PER_ADDRESS) {
      chunks.push({
        address: group.address,
        networks: supportedSlugs.slice(i, i + MAX_NETWORKS_PER_ADDRESS),
      });
    }
  }

  const requests: PortfolioRequestBody[] = [];
  for (let i = 0; i < chunks.length; i += MAX_ADDRESSES_PER_REQUEST) {
    requests.push({
      addresses: chunks.slice(i, i + MAX_ADDRESSES_PER_REQUEST),
    });
  }

  return requests;
}

// ============================================================================
// HTTP layer
// ============================================================================

async function callPortfolioEndpoint(
  apiKey: string,
  body: PortfolioRequestBody,
): Promise<AlchemyPortfolioResponseRaw> {
  const url = `${PORTFOLIO_BASE}/${apiKey}${TOKENS_BY_ADDRESS_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        withMetadata: true,
        withPrices: true,
        includeNativeTokens: true,
        includeErc20Tokens: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Portfolio API ${response.status}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as AlchemyPortfolioResponseRaw;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Response parsing
// ============================================================================

/**
 * Parse an Alchemy Portfolio response into our internal entry shape.
 *
 * Key normalizations:
 *   - `network` (Alchemy slug) → our `networkKey` via {@link PORTFOLIO_SLUG_TO_NETWORK_KEY}.
 *   - `tokenAddress: null | undefined` → `tokenKey: 'native'`.
 *   - `tokenAddress: string` → lowercased (EVM checksums collapse; Solana
 *     mints are also lowercased for consistency with `balanceCache` keys).
 *   - Raw hex balance + decimals → decimal string in display units.
 *   - `tokenPrices[currency=usd].value` → `priceUsd: number | null`.
 *
 * Exported for unit testing.
 */
export function parsePortfolioResponse(
  response: AlchemyPortfolioResponseRaw,
): PortfolioEntry[] {
  const tokens = response?.data?.tokens;
  if (!Array.isArray(tokens)) return [];

  const out: PortfolioEntry[] = [];
  for (const raw of tokens) {
    const entry = parseToken(raw);
    if (entry) out.push(entry);
  }
  return out;
}

function parseToken(raw: AlchemyPortfolioTokenRaw): PortfolioEntry | null {
  if (!raw?.network) return null;
  const networkKey = PORTFOLIO_SLUG_TO_NETWORK_KEY[raw.network];
  if (!networkKey) return null;

  // Native tokens have no contract address in Alchemy's response.
  const tokenKey =
    !raw.tokenAddress || raw.tokenAddress === null
      ? 'native'
      : raw.tokenAddress.toLowerCase();

  // Solana native price is reported under tokenAddress=null with decimals 9
  // (see Alchemy docs); everything else carries the token's decimals in
  // metadata. When decimals are missing we can't convert the hex balance —
  // native tokens default to 18 (EVM) or 9 (Solana); others are skipped.
  const decimals = resolveDecimals(networkKey, tokenKey, raw);
  if (decimals === null) return null;

  const balance = parseHexBalance(raw.tokenBalance, decimals);
  const priceUsd = parseUsdPrice(raw.tokenPrices);

  return {
    networkKey,
    tokenKey,
    balance,
    decimals,
    priceUsd,
    symbol: raw.tokenMetadata?.symbol ?? undefined,
    name: raw.tokenMetadata?.name ?? undefined,
    logoUrl: raw.tokenMetadata?.logo ?? undefined,
  };
}

/**
 * Native decimals fallback — metadata is often absent for native tokens.
 * Solana native is 9 lamports; every EVM chain we support is 18.
 */
const NATIVE_DECIMALS: Record<string, number> = {
  mainnet: 18, sepolia: 18, base: 18, arbitrum: 18, optimism: 18,
  polygon: 18, bsc: 18, avalanche: 18, linea: 18,
  'solana-mainnet': 9,
};

function resolveDecimals(
  networkKey: string,
  tokenKey: string,
  raw: AlchemyPortfolioTokenRaw,
): number | null {
  const fromMeta = raw.tokenMetadata?.decimals;
  if (typeof fromMeta === 'number' && Number.isFinite(fromMeta)) return fromMeta;
  if (tokenKey === 'native') return NATIVE_DECIMALS[networkKey] ?? null;
  return null;
}

/**
 * Convert a raw hex balance (`0x...`) to a display-unit decimal string,
 * matching what `balanceCache` stores (e.g. `"1.234"` for 1.234 ETH).
 *
 * Uses `BigInt` for exactness on the integer part and only defers to
 * string math for the fractional part — no floating-point rounding
 * regardless of the balance size.
 */
export function parseHexBalance(hex: string | null | undefined, decimals: number): string {
  if (!hex || typeof hex !== 'string') return '0';
  let raw = hex.toLowerCase();
  if (!raw.startsWith('0x')) raw = '0x' + raw;
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return '0';
  }
  if (value === 0n) return '0';
  if (decimals <= 0) return value.toString();

  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fractional = value % divisor;
  if (fractional === 0n) return whole.toString();

  const fracStr = fractional.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function parseUsdPrice(
  entries: Array<{ currency?: string; value?: string }> | null | undefined,
): number | null {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (entry?.currency?.toLowerCase() !== 'usd') continue;
    const n = Number(entry.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
