/**
 * @fileoverview XRP address derivation using BIP-44 (secp256k1).
 *
 * Derives XRP addresses from BIP-39 mnemonics using the standard
 * BIP-44 derivation path for XRP (coin type 144).
 *
 * BIP-44 Path: m/44'/144'/account'/0/index
 * - coin: 144 (XRP)
 * - account: account index (default 0)
 * - change: 0 (external)
 * - index: address index (default 0)
 *
 * XRP uses secp256k1 curve (same as Bitcoin/Ethereum) and base58check
 * encoding for addresses (starting with 'r').
 *
 * @module xrp/address
 */

import * as bip39 from 'bip39';
import { Wallet, isValidClassicAddress } from 'xrpl';
import type { XRPAddressInfo } from './types.js';
import { bip32 } from '../bip32-utils.js';

/**
 * XRP coin type for BIP-44 derivation.
 */
const XRP_COIN_TYPE = 144;

/**
 * Gets the XRP derivation path for a given account index.
 * Uses BIP-44 standard: m/44'/144'/account'/0/0
 *
 * @param accountIndex - Account index (default: 0)
 * @returns BIP-44 derivation path string
 */
export function getXRPDerivationPath(accountIndex: number = 0): string {
  return `m/44'/${XRP_COIN_TYPE}'/${accountIndex}'/0/0`;
}

/**
 * Derives an XRP address from a mnemonic.
 *
 * Uses BIP-44 derivation path: m/44'/144'/account'/0/0
 *
 * @param mnemonic - BIP-39 mnemonic phrase (12-24 words)
 * @param accountIndex - BIP-44 account index (default: 0)
 * @returns XRP address information including address and public key
 * @throws Error if mnemonic is invalid
 *
 * @example
 * ```typescript
 * const info = deriveXRPAddress(
 *   'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
 *   0
 * );
 * console.log(info.address); // rXXX...
 * ```
 */
export function deriveXRPAddress(
  mnemonic: string,
  accountIndex: number = 0
): XRPAddressInfo {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Derive the master key from seed
  const root = bip32.fromSeed(seed);

  // BIP-44 path for XRP: m/44'/144'/account'/0/0
  const path = getXRPDerivationPath(accountIndex);
  const child = root.derivePath(path);

  // Ensure we have a private key
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  // IMPORTANT:
  // `Wallet.fromEntropy()` generates a new keypair from entropy. It does not treat the
  // provided bytes as an already-derived private key. To match other wallets (e.g. Trust Wallet)
  // when using BIP-44/BIP-32 derived keys, construct the Wallet from the derived keypair.
  const privateKey = Buffer.from(child.privateKey).toString('hex').toUpperCase();
  const publicKey = Buffer.from(child.publicKey).toString('hex').toUpperCase();
  const wallet = new Wallet(publicKey, privateKey);

  return {
    address: wallet.classicAddress,
    publicKey: wallet.publicKey,
    derivationPath: path,
    network: 'mainnet', // XRP addresses work on both mainnet and testnet
  };
}

/**
 * Derives multiple XRP addresses from a mnemonic.
 * Useful for address discovery or generating a set of receiving addresses.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param startIndex - Starting account index
 * @param count - Number of addresses to derive
 * @returns Array of XRP address information
 *
 * @example
 * ```typescript
 * const addresses = deriveXRPAddresses(mnemonic, 0, 5);
 * // Returns 5 addresses from account index 0 to 4
 * ```
 */
export function deriveXRPAddresses(
  mnemonic: string,
  startIndex: number = 0,
  count: number = 10
): XRPAddressInfo[] {
  const addresses: XRPAddressInfo[] = [];

  for (let i = 0; i < count; i++) {
    addresses.push(deriveXRPAddress(mnemonic, startIndex + i));
  }

  return addresses;
}

/**
 * Gets the private key (hex format) for XRP address derivation.
 * This should only be used when explicitly requested by the user.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param accountIndex - BIP-44 account index
 * @returns Private key as hex string
 *
 * @security This function returns sensitive data. Handle with care.
 */
export function getXRPPrivateKey(
  mnemonic: string,
  accountIndex: number = 0
): string {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Derive the master key from seed
  const root = bip32.fromSeed(seed);

  // BIP-44 path for XRP
  const path = getXRPDerivationPath(accountIndex);
  const child = root.derivePath(path);

  // Get private key
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  // Return as uppercase hex string (XRP convention)
  return Buffer.from(child.privateKey).toString('hex').toUpperCase();
}

/**
 * Gets an XRP Wallet instance for signing transactions.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param accountIndex - BIP-44 account index
 * @returns xrpl Wallet instance
 *
 * @security This function returns a wallet that can sign transactions.
 */
export function getXRPWallet(
  mnemonic: string,
  accountIndex: number = 0
): Wallet {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Derive the master key from seed
  const root = bip32.fromSeed(seed);

  // BIP-44 path for XRP
  const path = getXRPDerivationPath(accountIndex);
  const child = root.derivePath(path);

  // Get private key
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  const privateKey = Buffer.from(child.privateKey).toString('hex').toUpperCase();
  const publicKey = Buffer.from(child.publicKey).toString('hex').toUpperCase();
  return new Wallet(publicKey, privateKey);
}

/**
 * Validates an XRP address format.
 *
 * XRP classic addresses:
 * - Start with 'r'
 * - Are 25-35 characters long
 * - Use base58check encoding (no 0, O, I, l)
 *
 * @param address - XRP address to validate
 * @returns true if the address is valid
 *
 * @example
 * ```typescript
 * isValidXRPAddress('rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9'); // true
 * isValidXRPAddress('invalid'); // false
 * isValidXRPAddress('0x1234...'); // false (Ethereum address)
 * ```
 */
export function isValidXRPAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Must start with 'r'
  if (!address.startsWith('r')) {
    return false;
  }

  // Length check: 25-35 characters
  if (address.length < 25 || address.length > 35) {
    return false;
  }

  // Base58 character set (no 0, O, I, l)
  const base58Regex = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
  if (!base58Regex.test(address)) {
    return false;
  }

  // Use xrpl library for full validation (checksum)
  try {
    return isValidClassicAddress(address);
  } catch {
    // If xrpl validation fails, rely on regex
    return true;
  }
}

/**
 * Determines if an address is an X-address (newer format with destination tag encoded).
 *
 * @param address - Address to check
 * @returns true if it's an X-address
 */
export function isXAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  // X-addresses start with 'X' (mainnet) or 'T' (testnet)
  return address.startsWith('X') || address.startsWith('T');
}
