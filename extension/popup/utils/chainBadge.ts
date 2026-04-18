/**
 * @fileoverview Network key → chain badge icon resolver.
 *
 * Reuses the existing `assets/img/` icons (the same ones used by the
 * `NetworkSelector` dropdown) so the unified-portfolio chain badges stay
 * visually consistent with the rest of the UI.
 */

import ethIcon from '../../assets/img/eth_logo.svg';
import ethBadgeIcon from '../../assets/img/eth_badge.svg';
import bnbIcon from '../../assets/img/bnb.svg';
import solIcon from '../../assets/img/solana-logo.svg';
import avaxIcon from '../../assets/img/avax-token.svg';
import arbitrumIcon from '../../assets/img/arbitrum.svg';
import baseIcon from '../../assets/img/base.svg';
import lineaIcon from '../../assets/img/linea-logo-mainnet.svg';
import polIcon from '../../assets/img/pol-token.svg';
import bitcoinIcon from '../../assets/img/bitcoin-logo.svg';
import xrpIcon from '../../assets/img/xrp.svg';
import tonIcon from '../../assets/img/ton_symbol.svg';

/**
 * Explicit per-network-key overrides. Takes precedence over the prefix-based
 * fallback so multi-testnet chains (e.g. sepolia vs mainnet) can share the
 * same badge without relying on chance.
 */
const BADGE_BY_KEY: Record<string, string> = {
  mainnet: ethBadgeIcon,
  sepolia: ethBadgeIcon,
  base: baseIcon,
  arbitrum: arbitrumIcon,
  optimism: ethBadgeIcon,
  polygon: polIcon,
  bsc: bnbIcon,
  avalanche: avaxIcon,
  linea: lineaIcon,
};

/**
 * Resolve a chain-badge icon URL for a given network key. Returns `null` when
 * no icon is known, letting the caller render a letter-circle fallback.
 */
export function getChainBadgeIcon(networkKey: string): string | null {
  if (networkKey in BADGE_BY_KEY) return BADGE_BY_KEY[networkKey];
  if (networkKey.startsWith('solana-')) return solIcon;
  if (networkKey.startsWith('bitcoin-')) return bitcoinIcon;
  if (networkKey.startsWith('xrp-')) return xrpIcon;
  if (networkKey.startsWith('ton-')) return tonIcon;
  // Unknown EVM-style key — use the ETH badge so users see *something*.
  return ethIcon;
}
