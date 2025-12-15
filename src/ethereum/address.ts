/**
 * @fileoverview Ethereum address derivation.
 * 
 * Handles BIP-44 HD wallet derivation for Ethereum and EVM-compatible chains.
 * Path: m/44'/60'/0'/0/{index}
 */

import { ethers } from 'ethers';

/**
 * Account information including address and index.
 */
export interface EthereumAccountInfo {
  address: string;
  accountIndex: number;
}

/**
 * Derive an Ethereum HD wallet at a specific BIP-44 index.
 * Uses path: m/44'/60'/0'/0/{index}
 * 
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param index - BIP-44 account index
 * @returns ethers HDNodeWallet instance
 */
export function deriveEthereumWallet(mnemonic: string, index: number): ethers.HDNodeWallet {
  const path = `m/44'/60'/0'/0/${index}`;
  return ethers.HDNodeWallet.fromPhrase(mnemonic, "", path);
}

/**
 * Get the Ethereum address for a specific account index.
 * 
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param index - BIP-44 account index
 * @returns Checksummed address (lowercase)
 */
export function getEthereumAddress(mnemonic: string, index: number): string {
  const wallet = deriveEthereumWallet(mnemonic, index);
  return wallet.address.toLowerCase();
}
