/**
 * @fileoverview Stakewiz API client — validator names, APY, and ranking.
 *
 * Stakewiz (https://api.stakewiz.com) is the one external, non-Alchemy API
 * used by staking: validator display metadata (name, APY, rank) is not
 * available on-chain. It is free, unauthenticated, and mainnet-only.
 *
 * Degradation is a hard invariant: every failure mode (network error, HTTP
 * error, timeout, malformed JSON) resolves to an EMPTY map, and callers must
 * render on-chain data (vote pubkey, commission from getVoteAccounts) when a
 * validator has no entry. Stakewiz must never block or fail a staking action.
 *
 * @responsibilities
 * - Fetch and normalize the Stakewiz validator list
 *
 * @security
 * - Read-only GET; no key, no wallet data is ever sent
 * - Host must stay in ALLOWED_DOMAINS (src/config/network-policy.ts) or the
 *   runtime network guard blocks it
 *
 * @module solana/stakewiz
 */

/** Normalized Stakewiz validator metadata, keyed by vote pubkey. */
export interface StakewizValidatorEntry {
  votePubkey: string;
  name: string | null;
  /** Estimated total APY percentage as reported by Stakewiz. */
  apyPercent: number | null;
  /** Stakewiz ranking (1 = best); null when absent. */
  rank: number | null;
  commissionPercent: number | null;
}

export const STAKEWIZ_API_BASE = 'https://api.stakewiz.com';

/** Timeout for the validators fetch — Stakewiz is auxiliary, never blocking. */
export const STAKEWIZ_TIMEOUT_MS = 8000;

/**
 * Fetch the Stakewiz validator list and index it by vote pubkey.
 *
 * @param fetchFn - Injection seam for tests; defaults to global fetch
 * @returns Map of vote pubkey → metadata. EMPTY on any failure (never throws).
 * @async
 */
export async function fetchStakewizValidators(
  fetchFn: typeof fetch = fetch
): Promise<Map<string, StakewizValidatorEntry>> {
  const result = new Map<string, StakewizValidatorEntry>();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STAKEWIZ_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchFn(`${STAKEWIZ_API_BASE}/validators`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return result;

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) return result;

    for (const raw of body) {
      const v = raw as {
        vote_identity?: string;
        name?: string | null;
        total_apy?: number;
        apy_estimate?: number;
        rank?: number;
        commission?: number;
      };
      if (!v?.vote_identity || typeof v.vote_identity !== 'string') continue;
      result.set(v.vote_identity, {
        votePubkey: v.vote_identity,
        name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : null,
        apyPercent:
          typeof v.total_apy === 'number'
            ? v.total_apy
            : typeof v.apy_estimate === 'number'
              ? v.apy_estimate
              : null,
        rank: typeof v.rank === 'number' ? v.rank : null,
        commissionPercent: typeof v.commission === 'number' ? v.commission : null,
      });
    }
  } catch {
    // Degradation invariant: swallow everything, return what we have (empty).
  }

  return result;
}
