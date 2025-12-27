/**
 * @fileoverview Shared Token Interface.
 * 
 * This file defines the canonical `Token` structure used across
 * core services, CLI, extension, and mobile app to ensure type consistency.
 */

export interface Token {
  /** Token symbol (e.g., 'ETH', 'USDT') */
  symbol: string;
  
  /** Token name (e.g., 'Ethereum', 'Tether USD') */
  name: string;
  
  /** 
   * Token standard/type.
   * - 'native': Native chain currency (ETH, BTC, SOL, TON)
   * - 'erc20': EVM standard token
   * - 'spl': Solana Program Library token
   * - 'jetton': TON Jetton
   * - 'brc20': Bitcoin BRC-20
   */
  type: 'native' | 'erc20' | 'spl' | 'jetton' | 'brc20';
  
  /** 
   * Contract address or identifier.
   * - For native tokens: 'native' or empty string (depending on legacy handling, preferred 'native')
   * - For others: The on-chain address
   */
  address: string;
  
  /** Number of decimal places (e.g., 18 for ETH, 6 for USDC) */
  decimals: number;

  /** URI for token logo image (optional) */
  logoURI?: string;

  /** Extension asset name for token icon (optional) */
  icon?: string;
  
  /** CoinGecko ID for pricing (optional) */
  coingeckoId?: string;

  /** 
   * Runtime State (Optional - populated by balance services)
   */
  
  /** Raw balance string (e.g. "1.5") */
  balance?: string;
  
  /** Price in USD */
  price?: number;
  
  /** Value in USD (balance * price) */
  value?: number;
}
