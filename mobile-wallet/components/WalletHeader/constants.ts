/**
 * @fileoverview Visual constants for the WalletHeader (network strip + account
 * chip + identity sheet). Matches the values from the design hand-off:
 * `simple-wallet-design-system/project/ui_kits/mobile/components.jsx` and
 * `header-proposals.jsx`.
 */

/**
 * 8px circular dot color shown before each network's name in the strip.
 * Keys match `networks` config keys when possible; lowercased fallbacks match
 * the same network referenced under different IDs (e.g. `mainnet` = Ethereum).
 */
export const NETWORK_DOT_COLORS: Record<string, string> = {
  mainnet: '#627EEA',
  ethereum: '#627EEA',
  sepolia: '#627EEA',
  polygon: '#8247E5',
  solana: '#14F195',
  'solana-mainnet': '#14F195',
  'solana-devnet': '#14F195',
  bitcoin: '#F7931A',
  'bitcoin-mainnet': '#F7931A',
  'bitcoin-testnet': '#F7931A',
  bsc: '#F0B90B',
  bnb: '#F0B90B',
  avalanche: '#E84142',
  arbitrum: '#28A0F0',
  optimism: '#FF0420',
  base: '#0052FF',
  linea: '#61DFFF',
  xrp: '#23292F',
  ton: '#0098EA',
};

export const NETWORK_DOT_DEFAULT = '#10b981';

/**
 * Gradient palettes for the deterministic Blockie avatar. The seed's first
 * two character codes pick a palette via
 * `(c0 + c1) % BLOCKIE_PALETTES.length`.
 */
export const BLOCKIE_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ['#7c3aed', '#06b6d4'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#3b82f6'],
  ['#ec4899', '#8b5cf6'],
];

export function paletteIndexForSeed(seed: string): number {
  if (!seed) return 0;
  const c0 = seed.charCodeAt(0);
  const c1 = seed.charCodeAt(1);
  const sum = c0 + (Number.isFinite(c1) ? c1 : 0);
  return ((sum % BLOCKIE_PALETTES.length) + BLOCKIE_PALETTES.length) % BLOCKIE_PALETTES.length;
}

export function networkDotColor(networkKey: string): string {
  if (NETWORK_DOT_COLORS[networkKey]) return NETWORK_DOT_COLORS[networkKey];
  const lower = networkKey.toLowerCase();
  return NETWORK_DOT_COLORS[lower] ?? NETWORK_DOT_DEFAULT;
}

/**
 * Display name for the strip — drop the trailing " Mainnet" suffix since
 * mainnet is the default; keep "Devnet"/"Testnet"/"Sepolia"/etc. so two
 * variants of the same chain stay distinguishable.
 *
 * Examples:
 *  - "Solana Mainnet"  → "Solana"
 *  - "Solana Devnet"   → "Solana Devnet"
 *  - "Bitcoin Mainnet" → "Bitcoin"
 *  - "Sepolia"         → "Sepolia"
 */
export function shortNetworkName(name: string): string {
  if (!name) return name;
  return name.replace(/\s+Mainnet$/i, '').trim();
}

/**
 * Single-word labels for the network strip — short enough that every chip is
 * the same visible width and nothing truncates with ellipsis. We can't use
 * `nativeSymbol` here because every EVM L2 reports "ETH" and the user could
 * not tell Base from Arbitrum from Linea.
 *
 * Falls back to {@link shortNetworkName} for any key not enumerated.
 */
const STRIP_LABELS: Record<string, string> = {
  mainnet: 'Ethereum',
  ethereum: 'Ethereum',
  sepolia: 'Sepolia',
  base: 'Base',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  bsc: 'BNB',
  linea: 'Linea',
  'bitcoin-mainnet': 'Bitcoin',
  'bitcoin-testnet': 'Bitcoin',
  'solana-mainnet': 'Solana',
  'solana-devnet': 'Solana',
  'xrp-mainnet': 'XRP',
  'xrp-testnet': 'XRP',
  'ton-mainnet': 'TON',
  'ton-testnet': 'TON',
};

export function stripLabelForNetwork(networkKey: string, fallbackName: string): string {
  return STRIP_LABELS[networkKey] ?? shortNetworkName(fallbackName);
}
