/**
 * @fileoverview Address validation helpers for the mobile send flow.
 *
 * Centralizes chain-specific address checks so the UI can gate send actions
 * before invoking the shared SDK.
 *
 * @responsibilities
 * - Validate address formats for supported chains (EVM, Bitcoin, Solana, XRP)
 * - Provide destination tag validation for XRP
 *
 * @security
 * - These helpers only validate inputs; they do not resolve or mutate addresses.
 * - ENS resolution is intentionally not performed here (explicitly blocked in UI).
 */

export type BitcoinNetwork = 'mainnet' | 'testnet';

export function isValidEvmAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  if (!address.startsWith('0x')) return false;
  if (address.length !== 42) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ethers } = require('ethers');
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}

export function isValidBitcoinAddress(address: string | null | undefined, network: BitcoinNetwork): boolean {
  if (!address) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isValidBitcoinAddress: validate } = require('@wallet/bitcoin/index.js');
  return validate(address, network);
}

export function isValidSolanaAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isValidSolanaAddress: validate } = require('@wallet/solana/index.js');
  return validate(address);
}

export function isValidXRPAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isValidXRPAddress: validate } = require('@wallet/xrp/index.js');
  return validate(address);
}

export function isValidDestinationTag(tag: string | number | null | undefined): boolean {
  if (tag === null || tag === undefined || tag === '') return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isValidDestinationTag: validate } = require('@wallet/xrp/index.js');
  return validate(tag);
}
