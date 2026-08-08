/**
 * @fileoverview Swap chain-support matrices and provider address mapping.
 *
 * Single source of truth for which networks each swap provider serves and how
 * the repo's token representation maps onto each provider's conventions.
 * Everything capability-related (menu gating, destination pickers, routing)
 * derives from the two matrices here — no UI or service code may hardcode a
 * per-network answer.
 *
 * Routing rule: same EVM network → 1inch Classic Swap; different networks
 * (EVM↔EVM, EVM↔Solana) → Mayan. Bitcoin/XRP/TON, testnets, and
 * Solana↔Solana (would need Jupiter) are unsupported.
 *
 * @security Native-token sentinels are provider API contracts; getting them
 * wrong swaps the wrong asset. The repo represents native tokens with
 * `address: ''` — the mapping helpers here are the only place that convention
 * is translated.
 *
 * @module swap/chains
 */

import type { Token, Config } from '../types/index.js';
import { isEVMNetworkConfig, isSolanaNetworkConfig } from '../types/config.js';

// ============================================================================
// Support matrices
// ============================================================================

/**
 * Networks 1inch Classic Swap v6 serves, mapped to their EIP-155 chain id.
 * Presence in this map == same-chain swaps available on that network.
 */
export const ONEINCH_NETWORKS: Readonly<Record<string, number>> = {
  mainnet: 1,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  bsc: 56,
  linea: 59144,
};

/**
 * Networks Mayan serves, mapped to Mayan's chain name parameter (the SDK's
 * ChainName union). Presence in this map == the network can be a cross-chain
 * source or destination. Verified against @mayanfinance/swap-sdk v15.
 */
export const MAYAN_NETWORKS: Readonly<Record<string, string>> = {
  mainnet: 'ethereum',
  bsc: 'bsc',
  polygon: 'polygon',
  avalanche: 'avalanche',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  linea: 'linea',
  'solana-mainnet': 'solana',
};

// ============================================================================
// Native-token sentinels
// ============================================================================

/** 1inch's sentinel address for the chain's native asset. */
export const ONEINCH_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Mayan's sentinel for native assets on every chain — including native SOL,
 * which Mayan's token list keys by the zero address with standard 'native'
 * (verified against price-api.mayan.finance/v3/tokens), not by the wSOL mint.
 */
export const MAYAN_NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Map a repo token to the address 1inch expects.
 * Native tokens (repo convention: `address === ''`) become the 0xEeee… sentinel.
 */
export function toOneInchAddress(token: Token): string {
  return token.address === '' ? ONEINCH_NATIVE_ADDRESS : token.address;
}

/**
 * Map a repo token to the address Mayan expects.
 * Native tokens (repo convention: `address === ''`) become the zero address
 * on all chains; everything else passes through unchanged (SPL mints are
 * case-sensitive — never normalize case here).
 */
export function toMayanAddress(token: Token): string {
  return token.address === '' ? MAYAN_NATIVE_ADDRESS : token.address;
}

// ============================================================================
// Pair classification (routing)
// ============================================================================

/** Outcome of routing a (source, destination) network pair. */
export type SwapPairClassification =
  | { kind: 'same-evm'; chainId: number }
  | { kind: 'cross-chain' }
  | { kind: 'unsupported'; reason: string };

/**
 * Decide which provider serves a network pair, or why neither can.
 *
 * Invariants encoded here (and locked by tests):
 * - identical EVM network in ONEINCH_NETWORKS → 1inch
 * - two distinct networks both in MAYAN_NETWORKS → Mayan
 * - Solana↔Solana, any Bitcoin/XRP/TON leg, any testnet leg → unsupported
 *
 * @param fromKey - Source network key
 * @param toKey - Destination network key
 * @param config - Loaded wallet config (network existence / type / testnet checks)
 */
export function classifySwapPair(
  fromKey: string,
  toKey: string,
  config: Config
): SwapPairClassification {
  for (const key of [fromKey, toKey]) {
    const netConfig = config.networks[key];
    if (!netConfig) {
      return { kind: 'unsupported', reason: `Unknown network '${key}'` };
    }
    if (netConfig.isTestnet) {
      return { kind: 'unsupported', reason: 'Swaps are not available on test networks' };
    }
    if (!isEVMNetworkConfig(netConfig) && !isSolanaNetworkConfig(netConfig)) {
      const label = netConfig.name ?? key;
      return { kind: 'unsupported', reason: `Swaps are not supported on ${label}` };
    }
  }

  if (fromKey === toKey) {
    const chainId = ONEINCH_NETWORKS[fromKey];
    if (chainId === undefined) {
      return {
        kind: 'unsupported',
        reason: isSolanaNetworkConfig(config.networks[fromKey])
          ? 'Same-chain Solana swaps are not supported yet'
          : `Same-chain swaps are not available on ${fromKey}`,
      };
    }
    return { kind: 'same-evm', chainId };
  }

  if (fromKey in MAYAN_NETWORKS && toKey in MAYAN_NETWORKS) {
    return { kind: 'cross-chain' };
  }
  const missing = fromKey in MAYAN_NETWORKS ? toKey : fromKey;
  return {
    kind: 'unsupported',
    reason: `Cross-chain swaps are not available on ${missing}`,
  };
}
