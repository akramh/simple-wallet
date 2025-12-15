/**
 * @fileoverview Cryptographic utilities for wallet encryption and data protection.
 * 
 * This module provides high-level encryption functions for securing wallet data,
 * specifically mnemonic phrases. It uses AES-256-GCM encryption with PBKDF2 key
 * derivation following industry best practices.
 * 
 * Security parameters:
 * - Algorithm: AES-256-GCM (authenticated encryption)
 * - Key derivation: PBKDF2-HMAC-SHA256 with 100,000 iterations
 * - Salt: 256-bit random value (unique per encryption)
 * - IV: 128-bit random value (unique per encryption)
 * 
 * The module supports swappable crypto backends via setCryptoAdapter() to enable
 * browser compatibility (WebCrypto) alongside Node.js (crypto module).
 * 
 * @module crypto-utils
 */

import crypto from 'crypto';
import fs from 'fs';
import * as bip39 from 'bip39';
import type { EncryptionResult } from './types/index.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { createNodeCryptoAdapter } from './crypto-adapter.js';

// ============================================================================
// Encryption Constants
// ============================================================================

/** AES-256-GCM provides authenticated encryption with associated data */
const ALGORITHM = 'aes-256-gcm';
/** 256-bit key for AES-256 */
const KEY_LENGTH = 32;
/** 128-bit IV as recommended for GCM mode */
const IV_LENGTH = 16;
/** 256-bit salt for PBKDF2 key derivation */
const SALT_LENGTH = 32;
/** Industry standard iteration count for PBKDF2 (balance of security and UX) */
const PBKDF2_ITERATIONS = 100000;
/** SHA-256 digest for PBKDF2 */
const PBKDF2_DIGEST = 'sha256';

// ============================================================================
// Crypto Adapter Management
// ============================================================================

/** Current crypto adapter instance */
let adapter: CryptoAdapter = createNodeCryptoAdapter();

/**
 * Replace the crypto adapter with a custom implementation.
 * Call this to switch from Node.js crypto to WebCrypto in browser environments.
 * 
 * @param custom - CryptoAdapter implementation to use
 * 
 * @example
 * ```typescript
 * import { createWebCryptoAdapter } from './crypto-adapter.js';
 * setCryptoAdapter(createWebCryptoAdapter());
 * ```
 */
export function setCryptoAdapter(custom: CryptoAdapter): void {
  adapter = custom;
}

/**
 * Get the current crypto adapter.
 * @returns Currently configured CryptoAdapter instance
 * @private
 */
function getCrypto(): CryptoAdapter {
  return adapter;
}

interface LegacyEncryptionResult {
  encrypted: string;
  salt: string;
}

interface WalletData {
  mnemonic?: string;
  encryptedMnemonic?: string;
  [key: string]: any;
}

// ============================================================================
// Password Validation
// ============================================================================

/**
 * Validate that a password meets minimum security requirements.
 * Currently requires at least 8 characters.
 * 
 * @param password - Password string to validate
 * @returns True if password meets requirements, false otherwise
 * 
 * @example
 * ```typescript
 * if (!validatePasswordLength(password)) {
 *   throw new Error('Password must be at least 8 characters');
 * }
 * ```
 */
export function validatePasswordLength(password: string): boolean {
  if (!password || typeof password !== 'string') {
    return false;
  }
  return password.length >= 8;
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Generate a cryptographically secure random salt.
 * Used as input to PBKDF2 key derivation.
 * 
 * @returns Hex-encoded 256-bit random salt
 */
export function generateSalt(): string {
  return Buffer.from(getCrypto().randomBytes(SALT_LENGTH)).toString('hex');
}

/**
 * Derive an encryption key from a password using PBKDF2.
 * Uses HMAC-SHA256 with 100,000 iterations for brute-force resistance.
 * 
 * @param password - User's password
 * @param saltHex - Hex-encoded salt (from generateSalt())
 * @returns 256-bit derived key as Buffer
 */
export function deriveKey(password: string, saltHex: string): Buffer {
  const salt = Buffer.from(saltHex, 'hex');
  return Buffer.from(getCrypto().pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  ) as any);
}

// ============================================================================
// Encryption/Decryption Functions
// ============================================================================

/**
 * Encrypt plaintext data using AES-256-GCM.
 * Generates a unique salt and IV for each encryption operation.
 * 
 * @param plaintext - Data to encrypt (typically a mnemonic phrase)
 * @param password - User's password for key derivation
 * @returns Object containing encrypted data (format: "iv:authTag:ciphertext") and salt
 * 
 * @example
 * ```typescript
 * const { encrypted, salt } = encryptData(mnemonic, password);
 * // Store encrypted and salt together
 * ```
 */
export function encryptData(plaintext: string, password: string): LegacyEncryptionResult {
  // Generate unique salt for this encryption
  const salt = generateSalt();

  // Derive key from password and salt
  const key = deriveKey(password, salt);

  // Generate random IV
  const iv = Buffer.from(getCrypto().randomBytes(IV_LENGTH));

  // Create cipher
  const cipher = getCrypto().createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag
  const authTag = Buffer.from(cipher.getAuthTag()).toString('hex');

  // Format: iv:authTag:ciphertext
  const encryptedData = `${iv.toString('hex')}:${authTag}:${encrypted}`;

  return {
    encrypted: encryptedData,
    salt: salt
  };
}

/**
 * Decrypt data encrypted with encryptData().
 * Uses GCM authentication tag to verify integrity.
 * 
 * @param encryptedData - Encrypted data in format "iv:authTag:ciphertext"
 * @param password - Password used during encryption
 * @param saltHex - Hex-encoded salt from encryption
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong password, corrupted data, or tampered ciphertext)
 */
export function decryptData(encryptedData: string, password: string, saltHex: string): string {
  // Parse encrypted data
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  // Derive key from password and salt
  const key = deriveKey(password, saltHex);

  // Create decipher
  const decipher = getCrypto().createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ============================================================================
// Mnemonic-Specific Functions
// ============================================================================

/**
 * Encrypt a BIP-39 mnemonic phrase.
 * Returns individual components suitable for JSON storage.
 * 
 * @param mnemonic - BIP-39 mnemonic phrase (12-24 words)
 * @param password - Master password for encryption
 * @returns Encryption result with separated components for storage
 */
export function encryptMnemonic(mnemonic: string, password: string): EncryptionResult {
  const result = encryptData(mnemonic, password);
  const parts = result.encrypted.split(':');
  const [iv, authTag, encrypted] = parts;

  return {
    encrypted,
    salt: result.salt,
    iv,
    authTag
  };
}

/**
 * Decrypt a mnemonic phrase from its stored components.
 * 
 * @param encryptedMnemonic - Encrypted ciphertext
 * @param password - Master password used during encryption
 * @param salt - PBKDF2 salt from storage
 * @param iv - Initialization vector from storage
 * @param authTag - GCM authentication tag from storage
 * @returns Decrypted mnemonic phrase
 * @throws Error if password is incorrect (authentication tag verification fails)
 */
export function decryptMnemonic(encryptedMnemonic: string, password: string, salt: string, iv: string, authTag: string): string {
  const encryptedData = `${iv}:${authTag}:${encryptedMnemonic}`;
  return decryptData(encryptedData, password, salt);
}

// ============================================================================
// Wallet File Utilities
// ============================================================================

/**
 * Check if any wallets exist (determines if first-time setup is needed).
 * Reads wallets.json to detect existing wallet data.
 * 
 * @returns True if at least one wallet exists
 */
export function hasExistingWallets(): boolean {
  try {
    const walletsPath = './wallets.json';
    if (!fs.existsSync(walletsPath)) {
      return false;
    }
    const data = fs.readFileSync(walletsPath, 'utf8');
    const wallets = JSON.parse(data);
    return Object.keys(wallets).length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check if wallets need migration from plaintext to encrypted format.
 * Detects legacy wallet storage that has unencrypted mnemonic fields.
 * 
 * @returns True if any wallet contains plaintext mnemonic requiring encryption
 */
export function needsMigration(): boolean {
  try {
    const walletsPath = './wallets.json';
    if (!fs.existsSync(walletsPath)) {
      return false;
    }
    const data = fs.readFileSync(walletsPath, 'utf8');
    const wallets: Record<string, WalletData> = JSON.parse(data);

    // Check if any wallet has plaintext mnemonic
    for (const walletData of Object.values(wallets)) {
      if (walletData.mnemonic && !walletData.encryptedMnemonic) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Validate a BIP-39 mnemonic phrase using the official library.
 * Checks word count, word validity, and checksum.
 * 
 * @param mnemonic - Space-separated mnemonic phrase
 * @returns True if mnemonic is valid (including checksum)
 */
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }
  // Normalize whitespace: trim and replace multiple spaces with single space
  const normalized = mnemonic.trim().replace(/\s+/g, ' ');
  return bip39.validateMnemonic(normalized);
}

/**
 * Convert a mnemonic phrase to a binary seed.
 * Used for deriving keys for various blockchains.
 * 
 * @param mnemonic - Valid BIP-39 mnemonic phrase
 * @returns 64-byte seed buffer
 */
export function mnemonicToSeed(mnemonic: string): Buffer {
  return bip39.mnemonicToSeedSync(mnemonic);
}

// ============================================================================
// Safe File Operations
// ============================================================================

/**
 * Safely write JSON to file with atomic operation and backup.
 * 
 * Operation sequence:
 * 1. Create backup of existing file (if present)
 * 2. Write to temporary file
 * 3. Verify temporary file contains valid JSON
 * 4. Atomically rename temp file to target (atomic on most filesystems)
 * 
 * On failure, attempts to restore from backup if main file is corrupted.
 * 
 * @param filePath - Target file path
 * @param data - Object to serialize and write
 * @throws Error if write fails and recovery is not possible
 */
export function safeWriteJSON<T>(filePath: string, data: T): void {
  const tempPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.backup`;

  try {
    // Create backup of existing file if it exists
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }

    // Write to temporary file first
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');

    // Verify the temp file is valid JSON
    const verifyData = fs.readFileSync(tempPath, 'utf8');
    JSON.parse(verifyData);

    // Atomic rename (on most systems)
    fs.renameSync(tempPath, filePath);

    // Clean up old backup after successful write
    if (fs.existsSync(backupPath)) {
      // Keep backup for safety, but we could delete it here
      // fs.unlinkSync(backupPath);
    }
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    // Restore from backup if main file is corrupted
    if (fs.existsSync(backupPath) && (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0)) {
      fs.copyFileSync(backupPath, filePath);
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to write file: ${errorMessage}`);
  }
}

/**
 * Safely read and parse JSON file with automatic recovery from backup.
 * 
 * Recovery sequence:
 * 1. Try to read main file
 * 2. If main file missing/corrupted, try backup file
 * 3. Restore main file from backup if recovery succeeds
 * 
 * @param filePath - File path to read
 * @returns Parsed JSON object
 * @throws Error if file cannot be read or recovered
 */
export function safeReadJSON<T = any>(filePath: string): T {
  const backupPath = `${filePath}.backup`;

  try {
    if (!fs.existsSync(filePath)) {
      // Try backup if main file doesn't exist
      if (fs.existsSync(backupPath)) {
        const data = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(data) as T;
        // Restore main file from backup
        fs.copyFileSync(backupPath, filePath);
        return parsed;
      }
      return {} as T;
    }

    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data) as T;
  } catch (error) {
    // Try to recover from backup
    if (fs.existsSync(backupPath)) {
      try {
        const backupData = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(backupData) as T;
        // Restore main file from backup
        fs.copyFileSync(backupPath, filePath);
        return parsed;
      } catch (backupError) {
        throw new Error('Both main file and backup are corrupted');
      }
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to read file: ${errorMessage}`);
  }
}
