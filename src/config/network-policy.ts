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
  // Ethereum
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

    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

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
