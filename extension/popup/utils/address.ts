/**
 * @fileoverview Chain-aware address utilities.
 *
 * The extension displays addresses across many chains (EVM, Bitcoin,
 * Solana, XRP, TON). Each chain has a different typographic signature
 * and benefits from a slightly different truncation.
 *
 * Every consumer of an address for display should go through
 * {@link formatAddress} so truncation stays consistent.
 */

export type ChainKind = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton' | 'unknown';

/**
 * Best-effort detection of chain from the address' visible shape.
 *
 * Doesn't do crypto validation — only pattern-based shape detection, which
 * is enough to pick the right truncation and network-accent color.
 */
export function detectChain(addr: string | null | undefined): ChainKind {
  if (!addr) return 'unknown';
  const s = addr.trim();
  if (!s) return 'unknown';

  // EVM: 0x + 40 hex
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return 'evm';

  // Bitcoin: legacy (1/3…), bech32 (bc1…), or testnet (tb1…, m/n/2…)
  if (/^(bc1|tb1)[0-9a-z]{6,}$/i.test(s)) return 'bitcoin';
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return 'bitcoin';
  if (/^[mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return 'bitcoin';

  // XRP: starts with 'r' + base58
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(s)) return 'xrp';

  // TON: EQ… / UQ… friendly form (48 chars) or 0:hex form
  if (/^(EQ|UQ|Ef|Uf|kQ)[A-Za-z0-9_-]{46}$/.test(s)) return 'ton';
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(s)) return 'ton';

  // Solana: base58, length 32–44
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return 'solana';

  return 'unknown';
}

/**
 * Per-chain truncation defaults. The shape of the address drives this —
 * EVM's fixed `0x` prefix is meaningful to users, while Solana's longer
 * alphanumeric body benefits from a tighter prefix.
 */
const truncationByChain: Record<ChainKind, { prefix: number; suffix: number }> = {
  evm: { prefix: 6, suffix: 4 },
  bitcoin: { prefix: 4, suffix: 6 },
  solana: { prefix: 4, suffix: 4 },
  xrp: { prefix: 4, suffix: 4 },
  ton: { prefix: 4, suffix: 6 },
  unknown: { prefix: 6, suffix: 4 },
};

interface FormatOptions {
  /**
   * Override the detected chain. Pass when you already know the chain
   * (e.g. from the current network) rather than inferring from shape.
   */
  chain?: ChainKind;
  /** Override the prefix character count. */
  prefix?: number;
  /** Override the suffix character count. */
  suffix?: number;
  /** Whether to return 'Unknown' for empty strings. Default true. */
  fallback?: string;
}

/**
 * Format an address for display with chain-appropriate truncation.
 *
 * @example
 *   formatAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f0b4F3')  // '0x742d35...b4F3'
 *   formatAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')   // 'bc1q...0wlh' (6 trailing)
 *   formatAddress(null)                                           // 'Unknown'
 */
export function formatAddress(
  addr: string | null | undefined,
  options: FormatOptions = {},
): string {
  const { fallback = 'Unknown' } = options;
  if (!addr) return fallback;
  const chain = options.chain ?? detectChain(addr);
  const defaults = truncationByChain[chain];
  const prefix = options.prefix ?? defaults.prefix;
  const suffix = options.suffix ?? defaults.suffix;
  if (addr.length <= prefix + suffix + 1) return addr;
  return `${addr.substring(0, prefix)}…${addr.substring(addr.length - suffix)}`;
}

/**
 * Map a network key (e.g. "mainnet", "solana-mainnet", "bitcoin-testnet")
 * to its chain kind. Useful when you already have the active network and
 * want to pick the chain-accent token or truncation without pattern-matching
 * the address.
 */
export function chainFromNetworkKey(network: string | null | undefined): ChainKind {
  if (!network) return 'unknown';
  const key = network.toLowerCase();
  if (key.startsWith('bitcoin')) return 'bitcoin';
  if (key.startsWith('solana')) return 'solana';
  if (key.startsWith('xrp')) return 'xrp';
  if (key.startsWith('ton')) return 'ton';
  // Everything else assumed EVM by convention in this repo (mainnet, sepolia,
  // base, polygon, etc.).
  return 'evm';
}

/** CSS variable name for the chain accent color. */
export function chainAccentVar(chain: ChainKind): string {
  switch (chain) {
    case 'evm':
      return 'var(--chain-eth)';
    case 'bitcoin':
      return 'var(--chain-btc)';
    case 'solana':
      return 'var(--chain-sol)';
    case 'xrp':
      return 'var(--chain-xrp)';
    case 'ton':
      return 'var(--chain-ton)';
    default:
      return 'var(--primary)';
  }
}
