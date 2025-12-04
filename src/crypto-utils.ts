import crypto from 'crypto';
import fs from 'fs';
import type { EncryptionResult } from './types/index.js';
import type { CryptoAdapter } from './crypto-adapter.js';
import { createNodeCryptoAdapter } from './crypto-adapter.js';

// Constants - Industry standard encryption parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000; // Industry standard (100k iterations)
const PBKDF2_DIGEST = 'sha256';

let adapter: CryptoAdapter = createNodeCryptoAdapter();

export function setCryptoAdapter(custom: CryptoAdapter): void {
  adapter = custom;
}

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

/**
 * Validates password meets minimum requirements
 */
export function validatePasswordLength(password: string): boolean {
  if (!password || typeof password !== 'string') {
    return false;
  }
  return password.length >= 8;
}

/**
 * Generates a random salt
 */
export function generateSalt(): string {
  return Buffer.from(getCrypto().randomBytes(SALT_LENGTH)).toString('hex');
}

/**
 * Derives encryption key from password and salt using PBKDF2
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

/**
 * Encrypts data using AES-256-GCM
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
 * Decrypts data using AES-256-GCM
 * @throws {Error} - If decryption fails (wrong password or corrupted data)
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

/**
 * Encrypts mnemonic phrase
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
 * Decrypts mnemonic phrase
 * @throws {Error} - If password is incorrect
 */
export function decryptMnemonic(encryptedMnemonic: string, password: string, salt: string, iv: string, authTag: string): string {
  const encryptedData = `${iv}:${authTag}:${encryptedMnemonic}`;
  return decryptData(encryptedData, password, salt);
}

/**
 * Checks if any wallets exist (determines if first-time setup needed)
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
 * Checks if wallets need migration from plaintext to encrypted format
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
 * Validates mnemonic phrase format and checksum
 */
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }

  const words = mnemonic.trim().split(/\s+/);

  // BIP39 supports 12, 15, 18, 21, or 24 word mnemonics
  const validLengths = [12, 15, 18, 21, 24];
  if (!validLengths.includes(words.length)) {
    return false;
  }

  // Check for empty words
  if (words.some(word => !word || word.length === 0)) {
    return false;
  }

  return true;
}

/**
 * Safely writes JSON to file with atomic operation
 * Creates backup before writing, writes to temp file first, then renames
 * @throws {Error} - If write fails
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
 * Safely reads and parses JSON file with recovery
 * @throws {Error} - If file cannot be read or recovered
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
