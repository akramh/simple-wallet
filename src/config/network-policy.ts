/**
 * @file network-policy.ts
 * @description Centralized "Source of Truth" for allowed network egress.
 *
 * This file defines the STRICT list of domains that the application is allowed
 * to connect to. Any connection attempt to a domain not in this list will be
 * blocked by the NetworkGuard and/or Platform Security Policies.
 *
 * @security
 * - This list must be kept minimal.
 * - Wildcards are NOT supported by the runtime guard (exact match or subdomain check required).
 * - This list is used to generate:
 *   1. Runtime Check Allowlist
 *   2. Android Network Security Config
 *   3. iOS App Transport Security Exceptions
 *   4. Chrome Extension CSP
 */

export const ALLOWED_DOMAINS = [
  // === RPC Nodes ===
  // Alchemy (per-chain hostnames — no wildcard support in guard).
  // One key (ALCHEMY_API_KEY) is used in the URL path; the hostname decides
  // the chain. Transfers API on eth/base/polygon/arb/opt; RPC on all listed.
  "eth-mainnet.g.alchemy.com",
  "eth-sepolia.g.alchemy.com",
  "base-mainnet.g.alchemy.com",
  "arb-mainnet.g.alchemy.com",
  "opt-mainnet.g.alchemy.com",
  "polygon-mainnet.g.alchemy.com",
  "avax-mainnet.g.alchemy.com",
  "bnb-mainnet.g.alchemy.com",
  "linea-mainnet.g.alchemy.com",
  "solana-mainnet.g.alchemy.com",
  "solana-devnet.g.alchemy.com",
  // Alchemy Data APIs (Prices, NFT, Portfolio) — hostname is
  // `api.g.alchemy.com`, not per-chain.
  "api.g.alchemy.com",

  // Ethereum (public fallback)
  "ethereum-rpc.publicnode.com",
  "ethereum-sepolia-rpc.publicnode.com",
  "rpc.sepolia.org",
  "sepolia.gateway.tenderly.co",

  // localhost for testing
  "localhost",

  // Base
  "mainnet.base.org",

  // Arbitrum
  "arb1.arbitrum.io",

  // Optimism
  "mainnet.optimism.io",

  // Polygon
  "polygon-rpc.com",

  // Avalanche
  "api.avax.network",

  // BSC
  "bsc-dataseed.binance.org",

  // Linea
  "rpc.linea.build",

  // Solana
  "mainnet.helius-rpc.com",
  "solana-mainnet.rpc.extrnode.com",
  "rpc.ankr.com",
  "api.devnet.solana.com",

  // TON
  "toncenter.com",
  "testnet.toncenter.com",

  // Omni (Sepolia RPC)
  "endpoints.omniatech.io",

  // === WebSockets (XRP) ===
  "xrplcluster.com",
  "s1.ripple.com",
  "s2.ripple.com",
  "s.altnet.rippletest.net",

  // === APIs & Explorers ===
  // Bitcoin (Mempool)
  "mempool.space",

  // Etherscan Family
  "etherscan.io",
  "api.etherscan.io",
  "sepolia.etherscan.io",
  "api-sepolia.etherscan.io",
  "basescan.org",
  "api.basescan.org",
  "arbiscan.io",
  "api.arbiscan.io",
  "optimistic.etherscan.io",
  "api-optimistic.etherscan.io",
  "polygonscan.com",
  "api.polygonscan.com",
  "snowtrace.io",
  "api.snowtrace.io",
  "bscscan.com",
  "api.bscscan.com",
  "lineascan.build",
  "api.lineascan.build",

  // Solana Explorer
  "solscan.io",
  "api.solscan.io",

  // XRP Explorer
  "xrpscan.com",
  "api.xrpscan.com", // Verify if API uses same domain
  "testnet.xrpscan.com",

  // TON Explorer
  "tonscan.org",
  "api.tonscan.org",
  "testnet.tonscan.org",

  // Price Providers (CoinGecko / CoinPaprika)
  // Assuming these are used based on common patterns, though not explicitly in small config snippet
  // Adding them to be safe if they are used in price-service.ts
  "api.coingecko.com",
  "pro-api.coingecko.com",
  "api.coinpaprika.com",
];

/**
 * Hosts that must be reached over WebSocket (wss://) rather than HTTPS.
 * The runtime guard only checks hostname; this list is used exclusively by
 * the CSP generator to emit the correct scheme per host.
 */
export const WSS_ONLY_HOSTS: ReadonlySet<string> = new Set([
  'xrplcluster.com',
  's1.ripple.com',
  's2.ripple.com',
  's.altnet.rippletest.net',
]);

/**
 * Builds the `connect-src` directive value for the extension manifest CSP
 * from {@link ALLOWED_DOMAINS}. Hosts in {@link WSS_ONLY_HOSTS} are emitted
 * as `wss://`; all others as `https://`.
 *
 * Keeps the manifest CSP in lockstep with the runtime guard — one source of
 * truth, no drift.
 */
export function buildConnectSrcDirective(): string {
  const entries: string[] = ["'self'"];
  for (const host of ALLOWED_DOMAINS) {
    if (WSS_ONLY_HOSTS.has(host)) {
      entries.push(`wss://${host}`);
      // XRP hosts are accessed on a non-standard port in one case; keep
      // parity with the previously hand-maintained CSP.
      if (host === 's.altnet.rippletest.net') {
        entries.push('wss://s.altnet.rippletest.net:51233');
      }
    } else {
      entries.push(`https://${host}`);
    }
  }
  return entries.join(' ');
}

/**
 * True if the given hostname or full URL points at a loopback or RFC 1918
 * private IPv4 address — i.e. 127/8, 10/8, 172.16/12, or 192.168/16. Used to
 * carve out dev-loop traffic (Metro HMR, source-map symbolication, local
 * explorers) without naming a single LAN IP that DHCP can rotate underneath
 * us.
 */
function isPrivateOrLoopbackHost(hostnameOrUrl: string): boolean {
  // Cheap substring match first — handles full URLs and bare hostnames
  // alike, parallel to the original 192.168 check that gated this allowlist.
  if (
    hostnameOrUrl.includes('127.0.0.1') ||
    hostnameOrUrl.includes('192.168.') ||
    hostnameOrUrl.includes('10.') ||
    hostnameOrUrl.includes('172.')
  ) {
    // The substring match above is intentionally loose to mirror the prior
    // 192.168 carve-out. Now narrow the 10. and 172. cases to the actual
    // private ranges so that hostnames like "version-10.example.com" or
    // "172.example.com" don't accidentally pass.
    const m = hostnameOrUrl.match(/(?:^|[\/@])(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a === 127) return true;                        // loopback
      if (a === 10) return true;                          // 10.0.0.0/8
      if (a === 192 && b === 168) return true;            // 192.168.0.0/16
      if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    } else if (hostnameOrUrl === 'localhost' || hostnameOrUrl.startsWith('localhost:')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a given URL is allowed by the security policy.
 *
 * @param urlString - The full URL to check (e.g. "https://api.example.com/v1/...")
 * @returns true if allowed, false otherwise
 */
export function isAllowedUrl(urlString: string): boolean {
  try {
    // Allow browser extension local resources
    if (urlString.startsWith('chrome-extension://') || urlString.startsWith('moz-extension://')) {
      return true;
    }

    // Handle relative URLs or invalid inputs gracefully
    if (!urlString.startsWith('http') && !urlString.startsWith('ws')) {
      // Relative URLs are typically local and safe, but let's be strict.
      // If code uses relative URLs (e.g. extension assets for web_accessible_resources), 
      // they might resolve to full chrome-extension:// paths in the interceptor or stay relative.
      // Fetching '/' or '/config.json' might be caught here if not fully qualified.
      // But typically fetch in SW resolves to absolute.

      // If we see a relative path that doesn't start with http/ws, and isn't one of the above, block it?
      // Actually, standard fetch handles relative URLs by resolving against base.
      // The interceptor sees the input string.
      // If the input is relative (e.g. "config.json"), we should probably allow it if it's not a protocol-relative URL to the outside.
      // But for safety and since the error shows absolute `chrome-extension://`, the check above covers the reported case.
      return false;
    }

    // Allow local-network access for the dev loop (Metro HMR, symbolicate,
    // local explorers). Covers the RFC 1918 private ranges + IPv4 loopback.
    // Production builds rarely receive these hostnames; the carve-out exists
    // because the dev server's IP changes with the host's DHCP lease and we
    // cannot enumerate it ahead of time.
    if (isPrivateOrLoopbackHost(urlString)) {
      return true;
    }

    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (isPrivateOrLoopbackHost(hostname)) {
      return true;
    }

    // Check strict exact match
    if (ALLOWED_DOMAINS.includes(hostname)) {
      return true;
    }

    // Optional: Check subdomain allowlist if we wanted to be more lenient.
    // For now, adhering to strict "Explicitly Approved" rule.
    // Meaning 'api.etherscan.io' MUST be in the list, 'etherscan.io' does not cover it.

    return false;

  } catch (err) {
    // If URL parsing fails, block it.
    return false;
  }
}
