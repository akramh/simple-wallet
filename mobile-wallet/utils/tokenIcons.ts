/**
 * @fileoverview Token and network icon mappings.
 * 
 * Maps token symbols and network keys to their local PNG icon assets.
 * Icons sourced from MetaMask mobile app.
 */

import { ImageSourcePropType } from 'react-native';

// Token icon mappings by symbol
const TOKEN_ICONS: Record<string, ImageSourcePropType> = {
  // Native tokens
  ETH: require('../assets/crypto/eth-logo.png'),
  WETH: require('../assets/crypto/eth-logo.png'),
  BTC: require('../assets/crypto/bitcoin.png'),
  SOL: require('../assets/crypto/solana.png'),
  XRP: require('../assets/crypto/xrp.png'),
  AVAX: require('../assets/crypto/avalanche.png'),
  WAVAX: require('../assets/crypto/avalanche.png'),
  BNB: require('../assets/crypto/bnb.png'),
  WBNB: require('../assets/crypto/bnb.png'),
  POL: require('../assets/crypto/pol.png'),
  MATIC: require('../assets/crypto/pol.png'),
  
  // Stablecoins
  USDC: require('../assets/crypto/icon-usdc.png'),
  // USDT and DAI icons not available as PNG - will fallback to letter
};

// Network icon mappings by network key
const NETWORK_ICONS: Record<string, ImageSourcePropType> = {
  mainnet: require('../assets/crypto/eth-logo.png'),
  sepolia: require('../assets/crypto/sepolia.png'),
  polygon: require('../assets/crypto/pol.png'),
  base: require('../assets/crypto/base.png'),
  arbitrum: require('../assets/crypto/arbitrum.png'),
  optimism: require('../assets/crypto/optimism.png'),
  avalanche: require('../assets/crypto/avalanche.png'),
  bsc: require('../assets/crypto/bnb.png'),
  linea: require('../assets/crypto/linea.png'),
  'solana-mainnet': require('../assets/crypto/solana.png'),
  'solana-devnet': require('../assets/crypto/solana.png'),
  'xrp-mainnet': require('../assets/crypto/xrp.png'),
  'xrp-testnet': require('../assets/crypto/xrp.png'),
  'bitcoin-mainnet': require('../assets/crypto/bitcoin.png'),
  'bitcoin-testnet': require('../assets/crypto/bitcoin.png'),
};

/**
 * Get the icon for a token by its symbol.
 * 
 * @param symbol - Token symbol (e.g., 'ETH', 'USDC')
 * @returns Image source or undefined if no icon exists
 */
export function getTokenIcon(symbol: string): ImageSourcePropType | undefined {
  return TOKEN_ICONS[symbol.toUpperCase()];
}

/**
 * Get the icon for a network by its key.
 * 
 * @param networkKey - Network key (e.g., 'mainnet', 'polygon')
 * @returns Image source or undefined if no icon exists
 */
export function getNetworkIcon(networkKey: string): ImageSourcePropType | undefined {
  return NETWORK_ICONS[networkKey];
}

/**
 * Check if a token has an icon available.
 */
export function hasTokenIcon(symbol: string): boolean {
  return symbol.toUpperCase() in TOKEN_ICONS;
}

/**
 * Check if a network has an icon available.
 */
export function hasNetworkIcon(networkKey: string): boolean {
  return networkKey in NETWORK_ICONS;
}
