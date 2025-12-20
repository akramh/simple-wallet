/**
 * @fileoverview TON address and key derivation utilities.
 *
 * Derives TON keypairs and wallet addresses from the shared BIP-39 mnemonic
 * using SLIP-0010 ed25519 hardened derivation.
 *
 * @responsibilities
 * - Derive TON ed25519 keypairs from BIP-39 mnemonics
 * - Produce friendly TON addresses (bounceable by default)
 * - Validate and normalize TON addresses
 *
 * @security
 * - Derivation uses hardened paths to prevent public-key leakage
 * - Mnemonic validation is enforced before derivation
 *
 * @module ton/address
 */

import * as asmcrypto from 'asmcrypto.js';
import nacl from 'tweetnacl';
import { Address } from '@ton/core';
import { WalletContractV4 } from '@ton/ton';
import { Buffer } from 'buffer';
import { mnemonicToSeed, validateMnemonic } from '../crypto-utils.js';
import type { TonAddressInfo } from './types.js';
import { TON_COIN_TYPE } from './types.js';

// ============================================================================
// Derivation Helpers
// ============================================================================

/**
 * Get the standard TON BIP-44 derivation path.
 *
 * @param accountIndex - HD account index (hardened)
 * @returns BIP-44 derivation path string
 */
export function getTonDerivationPath(accountIndex: number = 0): string {
  return `m/44'/${TON_COIN_TYPE}'/${accountIndex}'/0/0`;
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  const HmacSha512 = (asmcrypto as any).HmacSha512;
  const hmac = new HmacSha512(key);
  hmac.process(data);
  hmac.finish();
  return hmac.result as Uint8Array;
}

function coerceHardenedPath(path: string): string {
  return path
    .split('/')
    .map((segment, index) => {
      if (index === 0) return segment;
      return segment.endsWith("'") ? segment : `${segment}'`;
    })
    .join('/');
}

function isValidHardenedPath(path: string): boolean {
  return /^m(\/[0-9]+')+$/.test(path);
}

function deriveSlip10Ed25519HardenedPath(seed: Uint8Array, path: string): Uint8Array {
  if (!isValidHardenedPath(path)) {
    throw new Error('Invalid derivation path for ed25519');
  }

  const encoder = new TextEncoder();
  const master = hmacSha512(encoder.encode('ed25519 seed'), seed);

  let key = master.slice(0, 32);
  let chainCode = master.slice(32, 64);

  const HARDENED_OFFSET = 0x80000000;
  const segments = path.split('/').slice(1);

  for (const segment of segments) {
    const raw = segment.endsWith("'") ? segment.slice(0, -1) : segment;
    const index = Number.parseInt(raw, 10);
    if (!Number.isFinite(index) || index < 0) {
      throw new Error('Invalid derivation path');
    }

    const idx = (index | 0) + HARDENED_OFFSET;
    const indexBytes = new Uint8Array(4);
    new DataView(indexBytes.buffer).setUint32(0, idx >>> 0, false);

    const data = new Uint8Array(1 + key.length + indexBytes.length);
    data[0] = 0;
    data.set(key, 1);
    data.set(indexBytes, 1 + key.length);

    const derived = hmacSha512(chainCode, data);
    key = derived.slice(0, 32);
    chainCode = derived.slice(32, 64);
  }

  return key;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Derive a TON keypair from a BIP-39 mnemonic.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param accountIndex - HD account index
 * @returns ed25519 keypair bytes
 */
export function deriveTonKeypair(
  mnemonic: string,
  accountIndex: number = 0
): { publicKey: Uint8Array; secretKey: Uint8Array } {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeed(mnemonic);
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed as any);
  const path = coerceHardenedPath(getTonDerivationPath(accountIndex));
  const key = deriveSlip10Ed25519HardenedPath(seedBytes, path);

  return nacl.sign.keyPair.fromSeed(key);
}

/**
 * Derive a TON wallet address from a mnemonic.
 *
 * @param mnemonic - BIP-39 mnemonic phrase
 * @param accountIndex - HD account index
 * @param options - Address formatting options
 * @returns TON address info
 */
export function deriveTonAddress(
  mnemonic: string,
  accountIndex: number = 0,
  options: { workchain?: number; bounceable?: boolean; testOnly?: boolean } = {}
): TonAddressInfo {
  const { workchain = 0, bounceable = true, testOnly = false } = options;
  const keypair = deriveTonKeypair(mnemonic, accountIndex);
  const publicKey = Buffer.from(keypair.publicKey);
  const wallet = WalletContractV4.create({ publicKey, workchain });

  const derivationPath = getTonDerivationPath(accountIndex);
  const address = wallet.address;

  return {
    address: formatTonAddress(address, { bounceable, testOnly }),
    addressRaw: address.toRawString(),
    publicKeyHex: bytesToHex(publicKey),
    derivationPath,
    workchain,
    isTestOnly: testOnly,
  };
}

/**
 * Validate a TON address string.
 *
 * @param address - Friendly or raw TON address
 * @returns true if valid
 */
export function isValidTonAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  try {
    Address.parse(address);
    return true;
  } catch {
    try {
      Address.parseFriendly(address);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Parse a TON address into a core Address type.
 *
 * @param address - Friendly or raw TON address
 * @returns Parsed Address
 */
export function parseTonAddress(address: string): Address {
  try {
    return Address.parse(address);
  } catch {
    return Address.parseFriendly(address).address;
  }
}

/**
 * Format a TON address as friendly string.
 *
 * @param address - Parsed TON Address
 * @param options - Formatting options
 * @returns Friendly formatted address
 */
export function formatTonAddress(
  address: Address,
  options: { bounceable?: boolean; testOnly?: boolean } = {}
): string {
  const { bounceable = true, testOnly = false } = options;
  return address.toString({ bounceable, testOnly, urlSafe: true });
}

/**
 * Normalize a TON address into bounceable friendly format.
 *
 * @param address - Address string (friendly or raw)
 * @param testOnly - Whether to mark as testnet
 * @returns Normalized friendly address
 */
export function normalizeTonAddress(address: string, testOnly: boolean = false): string {
  const parsed = parseTonAddress(address);
  return formatTonAddress(parsed, { bounceable: true, testOnly });
}
