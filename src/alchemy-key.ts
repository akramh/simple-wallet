/**
 * @fileoverview Shared helpers for handling a user-supplied Alchemy API key:
 * format sanity check, display masking, and live validation via a JSON-RPC
 * `eth_blockNumber` call. Used by the CLI, extension, and mobile
 * getting-started flows.
 *
 * @responsibilities
 * - Provide the canonical Alchemy signup / validation URLs
 * - Sanity-check pasted keys before any network call
 * - Validate a key against Alchemy with a bounded-timeout fetch
 * - Mask keys for display (`abcd…wxyz`) — the ONLY form UIs may render
 *
 * @security The raw key must never appear in any error message, log line,
 * or result object other than the caller-held input. `validateAlchemyKey`
 * deliberately returns coarse reason codes and never echoes the key or the
 * request URL (which embeds the key). Tests must inject `fetchImpl` — no
 * live network calls in the test suite.
 */

/** Where users sign up for / manage an Alchemy API key. */
export const ALCHEMY_SIGNUP_URL = 'https://dashboard.alchemy.com/';

/**
 * Base URL used to validate a key. Ethereum mainnet is used because every
 * Alchemy key has access to it. Host is already present in the network
 * policy allowlist (src/config/network-policy.ts) and extension CSP.
 */
export const ALCHEMY_VALIDATION_URL = 'https://eth-mainnet.g.alchemy.com/v2/';

/** Validation timeout in milliseconds. */
const VALIDATION_TIMEOUT_MS = 10_000;

/** Result of {@link validateAlchemyKey}. Discriminated on `ok`. */
export type AlchemyKeyValidation =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid-format' | 'unauthorized' | 'bad-response' | 'network-error' | 'timeout';
    };

/**
 * Loose shape check for a pasted Alchemy key. Deliberately permissive on
 * length/charset (Alchemy's exact format is not a public contract) — the
 * goal is catching obvious paste mistakes (URLs, whitespace, quotes, empty
 * strings) before making a network call.
 *
 * @param key - Raw user input (leading/trailing whitespace is tolerated).
 * @returns true when the trimmed input plausibly looks like an API key.
 */
export function looksLikeAlchemyKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(key.trim());
}

/**
 * Masks a key for display as `abcd…wxyz` (first 4 + last 4 characters).
 * Any UI surface showing a stored key must show this form, never the raw
 * value. Short inputs mask fully rather than leaking most of the key.
 *
 * @param key - The raw key.
 * @returns The masked display form.
 */
export function maskAlchemyKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '…';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/**
 * Validates a key by POSTing an `eth_blockNumber` JSON-RPC request to
 * Ethereum mainnet through Alchemy. Never throws; always resolves to a
 * discriminated {@link AlchemyKeyValidation}.
 *
 * Reason mapping:
 * - malformed input → `invalid-format` (no network call made)
 * - HTTP 401/403, or a JSON-RPC error mentioning auth → `unauthorized`
 * - HTTP 2xx with an unparseable / result-less body → `bad-response`
 * - fetch rejection (DNS, offline, CORS) → `network-error`
 * - abort after the internal timeout → `timeout`
 *
 * @param key - The raw key to validate.
 * @param fetchImpl - Injectable fetch (test seam; defaults to global fetch).
 * @returns The validation outcome. The result never contains the key.
 * @async
 */
export async function validateAlchemyKey(
  key: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<AlchemyKeyValidation> {
  const trimmed = key.trim();
  if (!looksLikeAlchemyKey(trimmed)) {
    return { ok: false, reason: 'invalid-format' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetchImpl(ALCHEMY_VALIDATION_URL + trimmed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'unauthorized' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'bad-response' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'bad-response' };
    }

    const rpc = body as { result?: unknown; error?: { message?: unknown } };
    if (typeof rpc.result === 'string') {
      return { ok: true };
    }
    if (rpc.error) {
      const message = typeof rpc.error.message === 'string' ? rpc.error.message.toLowerCase() : '';
      if (message.includes('auth') || message.includes('key') || message.includes('unauthorized')) {
        return { ok: false, reason: 'unauthorized' };
      }
    }
    return { ok: false, reason: 'bad-response' };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network-error' };
  } finally {
    clearTimeout(timer);
  }
}
