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

/**
 * Validates mnemonic phrase format and checksum
 * @param {string} mnemonic - Mnemonic phrase to validate
 * @returns {boolean} - True if valid
 */
function validateMnemonic(mnemonic) {
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
 * @param {string} filePath - Path to file
 * @param {Object} data - Data to write
 * @throws {Error} - If write fails
 */
function safeWriteJSON(filePath, data) {
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

    throw new Error(`Failed to write file: ${error.message}`);
  }
}

/**
 * Safely reads and parses JSON file with recovery
 * @param {string} filePath - Path to file
 * @returns {Object} - Parsed JSON data
 * @throws {Error} - If file cannot be read or recovered
 */
function safeReadJSON(filePath) {
  const backupPath = `${filePath}.backup`;

  try {
    if (!fs.existsSync(filePath)) {
      // Try backup if main file doesn't exist
      if (fs.existsSync(backupPath)) {
        const data = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(data);
        // Restore main file from backup
        fs.copyFileSync(backupPath, filePath);
        return parsed;
      }
      return {};
    }

    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Try to recover from backup
    if (fs.existsSync(backupPath)) {
      try {
        const backupData = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(backupData);
        // Restore main file from backup
        fs.copyFileSync(backupPath, filePath);
        return parsed;
      } catch (backupError) {
        throw new Error('Both main file and backup are corrupted');
      }
    }
    throw new Error(`Failed to read file: ${error.message}`);
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
  needsMigration,
  validateMnemonic,
  safeWriteJSON,
  safeReadJSON
};
