import { Token } from '../types/index.js';

/**
 * Ethereum transaction receipt.
 */
export interface EthereumTransactionReceipt {
  hash: string;
  blockNumber: number;
  gasUsed: string;
}

/**
 * Portfolio result for Ethereum (matches generic pattern).
 */
export interface EthereumPortfolioResult {
  token: Token;
  balance: string;
  error?: string;
}

/**
 * Minimal ERC-20 ABI for token interactions.
 */
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];
