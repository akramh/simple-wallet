/**
 * @fileoverview Bitcoin address derivation using BIP-84 (Native SegWit).
 *
 * Derives Native SegWit (P2WPKH) addresses from BIP-39 mnemonics using the
 * BIP-84 derivation path. This allows users to derive both Ethereum and
 * Bitcoin addresses from the same seed phrase.
 *
 * BIP-84 Path: m/84'/coin'/account'/change/index
 * - coin: 0 for mainnet, 1 for testnet
 * - account: account index (default 0)
 * - change: 0 for receiving, 1 for change
 * - index: address index
 *
 * @module bitcoin/address
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import type { BitcoinAddressInfo } from './types.js';
import { bip32 } from '../bip32-utils.js';
import { validateMnemonic, mnemonicToSeed } from '../crypto-utils.js';

/**
 * Bitcoin network configurations.
 * Maps network names to bitcoinjs-lib network objects.
 */
const BITCOIN_NETWORKS = {
  mainnet: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
} as const;

/**
 * BIP-84 coin types for different networks.
 * Mainnet uses 0, testnet uses 1.
 */
const COIN_TYPES = {
  mainnet: 0,
  testnet: 1,
} as const;

/**
 * Derives a Native SegWit (P2WPKH) Bitcoin address from a mnemonic.
 *
 * Uses BIP-84 derivation path: m/84'/coin'/account'/0/index
 * - For mainnet: m/84'/0'/account'/0/index
 * - For testnet: m/84'/1'/account'/0/index
 *
 * @param mnemonic - BIP-39 mnemonic phrase (12-24 words)
 * @param network - Bitcoin network ('mainnet' or 'testnet')
 * @param accountIndex - BIP-44 account index (default: 0)
 * @param addressIndex - Address index within account (default: 0)
 * @returns Bitcoin address information including address and public key
 * @throws Error if mnemonic is invalid
 *
 * @example
 * ```typescript
 * const info = deriveBitcoinAddress(
 *   'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
 *   'mainnet',
 *   0,
 *   0
 * );
 * console.log(info.address); // bc1q...
 * ```
 */
export function deriveBitcoinAddress(
  mnemonic: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  accountIndex: number = 0,
  addressIndex: number = 0
): BitcoinAddressInfo {
  // Validate mnemonic
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = mnemonicToSeed(mnemonic);

  // Get the appropriate network configuration
  const btcNetwork = BITCOIN_NETWORKS[network];
  const coinType = COIN_TYPES[network];

  // Derive the master key from seed
  const root = bip32.fromSeed(seed, btcNetwork);

  // BIP-84 path for Native SegWit: m/84'/coin'/account'/0/index
  // Using 0 for external (receiving) addresses
  const path = `m/84'/${coinType}'/${accountIndex}'/0/${addressIndex}`;
  const child = root.derivePath(path);

  // Ensure we have a public key
  if (!child.publicKey) {
    throw new Error('Failed to derive public key');
  }

  // Create P2WPKH (Native SegWit) address
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network: btcNetwork,
  });

  if (!address) {
    throw new Error('Failed to derive Bitcoin address');
  }

  return {
    address,
    publicKey: Buffer.from(child.publicKey).toString('hex'),
    derivationPath: path,
    network,
  };
}

/**
 * Derives multiple Bitcoin addresses from a mnemonic.
 * Useful for address discovery or generating a set of receiving addresses.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param network - Bitcoin network
 * @param accountIndex - BIP-44 account index
 * @param startIndex - Starting address index
 * @param count - Number of addresses to derive
 * @returns Array of Bitcoin address information
 *
 * @example
 * ```typescript
 * const addresses = deriveBitcoinAddresses(mnemonic, 'mainnet', 0, 0, 5);
 * // Returns 5 addresses from index 0 to 4
 * ```
 */
export function deriveBitcoinAddresses(
  mnemonic: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  accountIndex: number = 0,
  startIndex: number = 0,
  count: number = 10
): BitcoinAddressInfo[] {
  const addresses: BitcoinAddressInfo[] = [];

  for (let i = 0; i < count; i++) {
    addresses.push(
      deriveBitcoinAddress(mnemonic, network, accountIndex, startIndex + i)
    );
  }

  return addresses;
}

/**
 * Gets the private key (WIF format) for a Bitcoin address derivation.
 * This should only be used when explicitly requested by the user.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param network - Bitcoin network
 * @param accountIndex - BIP-44 account index
 * @param addressIndex - Address index
 * @returns Private key in WIF (Wallet Import Format)
 *
 * @security This function returns sensitive data. Handle with care.
 */
export function getBitcoinPrivateKey(
  mnemonic: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  accountIndex: number = 0,
  addressIndex: number = 0
): string {
  // Validate mnemonic
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed
  const seed = mnemonicToSeed(mnemonic);

  // Get the appropriate network configuration
  const btcNetwork = BITCOIN_NETWORKS[network];
  const coinType = COIN_TYPES[network];

  // Derive the master key from seed
  const root = bip32.fromSeed(seed, btcNetwork);

  // BIP-84 path
  const path = `m/84'/${coinType}'/${accountIndex}'/0/${addressIndex}`;
  const child = root.derivePath(path);

  // Get WIF-encoded private key
  if (!child.privateKey) {
    throw new Error('Failed to derive private key');
  }

  // Convert to WIF format
  const keyPair = {
    privateKey: child.privateKey,
    network: btcNetwork,
  };

  const ECPair = ECPairFactory(ecc);
  const ecpair = ECPair.fromPrivateKey(child.privateKey, { network: btcNetwork });

  return ecpair.toWIF();
}

/**
 * Validates a Bitcoin address format.
 *
 * @param address - Bitcoin address to validate
 * @param network - Expected network (optional, validates against both if not specified)
 * @returns true if the address is valid
 *
 * @example
 * ```typescript
 * isValidBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); // true
 * isValidBitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'); // true (testnet)
 * isValidBitcoinAddress('invalid'); // false
 * ```
 */
export function isValidBitcoinAddress(
  address: string,
  network?: 'mainnet' | 'testnet'
): boolean {
  // Quick prefix check for Native SegWit
  const isMainnetFormat = address.startsWith('bc1q') || address.startsWith('bc1p');
  const isTestnetFormat = address.startsWith('tb1q') || address.startsWith('tb1p');

  if (!isMainnetFormat && !isTestnetFormat) {
    return false;
  }

  // If network specified, check prefix matches
  if (network === 'mainnet' && !isMainnetFormat) {
    return false;
  }
  if (network === 'testnet' && !isTestnetFormat) {
    return false;
  }

  // Validate using bitcoinjs-lib
  try {
    const btcNetwork = isMainnetFormat
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    bitcoin.address.toOutputScript(address, btcNetwork);
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines the network type from a Bitcoin address.
 *
 * @param address - Bitcoin address
 * @returns 'mainnet', 'testnet', or null if invalid
 */
export function getNetworkFromAddress(address: string): 'mainnet' | 'testnet' | null {
  if (address.startsWith('bc1q') || address.startsWith('bc1p')) {
    return 'mainnet';
  }
  if (address.startsWith('tb1q') || address.startsWith('tb1p')) {
    return 'testnet';
  }
  // Legacy addresses (1..., 3..., m..., n..., 2...) not supported
  // as we're using Native SegWit only
  return null;
}
