import crypto from 'crypto';
import fs from 'fs';

// Constants - Industry standard encryption parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000; // Industry standard (100k iterations)
const PBKDF2_DIGEST = 'sha256';

/**
 * Validates password meets minimum requirements
 * @param {string} password - Password to validate
 * @returns {boolean} - True if valid
 */
function validatePasswordLength(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }
  return password.length >= 8;
}

/**
 * Generates a random salt
 * @returns {string} - Hex-encoded salt
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

/**
 * Derives encryption key from password and salt using PBKDF2
 * @param {string} password - User password
 * @param {string} saltHex - Salt in hex format
 * @returns {Buffer} - Derived key
 */
function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypts data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {string} password - Encryption password
 * @returns {Object} - { encrypted: string, salt: string }
 */
function encryptData(plaintext, password) {
  // Generate unique salt for this encryption
  const salt = generateSalt();

  // Derive key from password and salt
  const key = deriveKey(password, salt);

  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag
  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:ciphertext
  const encryptedData = `${iv.toString('hex')}:${authTag}:${encrypted}`;

  return {
    encrypted: encryptedData,
    salt: salt
  };
}

/**
 * Decrypts data using AES-256-GCM
 * @param {string} encryptedData - Data in format "iv:authTag:ciphertext"
 * @param {string} password - Decryption password
 * @param {string} saltHex - Salt used for encryption
 * @returns {string} - Decrypted plaintext
 * @throws {Error} - If decryption fails (wrong password or corrupted data)
 */
function decryptData(encryptedData, password, saltHex) {
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
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypts mnemonic phrase
 * @param {string} mnemonic - Mnemonic phrase to encrypt
 * @param {string} password - Master password
 * @returns {Object} - { encrypted: string, salt: string }
 */
function encryptMnemonic(mnemonic, password) {
  return encryptData(mnemonic, password);
}

/**
 * Decrypts mnemonic phrase
 * @param {string} encryptedMnemonic - Encrypted mnemonic
 * @param {string} password - Master password
 * @param {string} salt - Salt used for encryption
 * @returns {string} - Decrypted mnemonic
 * @throws {Error} - If password is incorrect
 */
function decryptMnemonic(encryptedMnemonic, password, salt) {
  return decryptData(encryptedMnemonic, password, salt);
}

/**
 * Checks if any wallets exist (determines if first-time setup needed)
 * @returns {boolean} - True if wallets exist
 */
function hasExistingWallets() {
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
 * @returns {boolean} - True if migration needed
 */
function needsMigration() {
  try {
    const walletsPath = './wallets.json';
    if (!fs.existsSync(walletsPath)) {
      return false;
    }
    const data = fs.readFileSync(walletsPath, 'utf8');
    const wallets = JSON.parse(data);

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

export {
  validatePasswordLength,
  generateSalt,
  deriveKey,
  encryptData,
  decryptData,
  encryptMnemonic,
  decryptMnemonic,
  hasExistingWallets,
  needsMigration
};
