/**
 * @fileoverview Solana address/keypair derivation using BIP-44 (ed25519).
 *
 * Derives Solana addresses from the same BIP-39 mnemonic used for EVM/Bitcoin.
 *
 * Standard derivation path:
 * - m/44'/501'/{accountIndex}'/0'
 *
 * @module solana/address
 */

import { Keypair } from '@solana/web3.js';
import * as asmcrypto from 'asmcrypto.js';
// @ts-ignore
import bs58 from 'bs58';
import type { SolanaAddressInfo } from './types.js';
import { validateMnemonic, mnemonicToSeed } from '../crypto-utils.js';

export function getSolanaDerivationPath(accountIndex: number = 0): string {
  return `m/44'/501'/${accountIndex}'/0'`;
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  const HmacSha512 = (asmcrypto as any).HmacSha512;
  const hmac = new HmacSha512(key);
  hmac.process(data);
  hmac.finish();
  return hmac.result as Uint8Array;
}

function isValidHardenedPath(path: string): boolean {
  return /^m(\/[0-9]+')+$/.test(path);
}

function deriveSlip10Ed25519HardenedPath(seed: Uint8Array, path: string): Uint8Array {
  if (!isValidHardenedPath(path)) {
    throw new Error('Invalid derivation path');
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

export function deriveSolanaKeypair(mnemonic: string, accountIndex: number = 0): Keypair {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const seed = mnemonicToSeed(mnemonic);
  const path = getSolanaDerivationPath(accountIndex);
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed as any);
  const key = deriveSlip10Ed25519HardenedPath(seedBytes, path);

  return Keypair.fromSeed(key);
}

export function deriveSolanaAddress(mnemonic: string, accountIndex: number = 0): SolanaAddressInfo {
  const keypair = deriveSolanaKeypair(mnemonic, accountIndex);
  const derivationPath = getSolanaDerivationPath(accountIndex);
  const address = keypair.publicKey.toBase58();

  return {
    address,
    publicKeyBase58: address,
    derivationPath,
  };
}

/**
 * Derives a Solana address from a Base58-encoded secret key.
 *
 * This function is used for importing existing Solana wallets via private key
 * rather than mnemonic. The resulting wallet is single-address (non-HD).
 *
 * @param secretKeyBase58 - Base58-encoded secret key (64 bytes when decoded).
 *   This is the format used by Phantom, Solflare, and other Solana wallets
 *   when exporting private keys.
 * @returns Solana address information including the derived public key
 * @throws Error if the secret key is invalid or malformed
 *
 * @security This function accepts raw private key material. Callers should
 *   ensure the secret key string is handled securely and not logged.
 *
 * @example
 * ```typescript
 * const info = deriveSolanaAddressFromSecretKey(
 *   '5MaiiCavjCmn9Hs1o3eznqDEhRwxo7pXiAYez7keQUviUkauRiTMD8DrESdrNjN8zd9mTmVhRvBJeg5vhyvgrAhG'
 * );
 * console.log(info.address); // Base58 public key address
 * ```
 */
export function deriveSolanaAddressFromSecretKey(secretKeyBase58: string): SolanaAddressInfo {
  try {
    const secretKey = bs58.decode(secretKeyBase58);
    const keypair = Keypair.fromSecretKey(secretKey);
    const address = keypair.publicKey.toBase58();

    return {
      address,
      publicKeyBase58: address,
      derivationPath: 'imported-private-key',
    };
  } catch (error) {
    throw new Error('Invalid Solana private key');
  }
}
