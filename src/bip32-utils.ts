import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';

/**
 * Initializes and returns a BIP32 instance using the tiny-secp256k1 ECC library.
 * This ensures a consistent cryptographic primitive for BIP32 operations across the application.
 */
export const bip32 = BIP32Factory(ecc);
