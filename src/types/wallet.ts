/**
 * @fileoverview Wallet-related type definitions for encryption, storage, and transactions.
 * 
 * This module defines data structures for encrypted wallet storage, transaction results,
 * portfolio display, and token metadata. These types support both the Node.js CLI
 * and browser extension environments.
 * 
 * @module types/wallet
 */

/**
 * Result of AES-256-GCM encryption operation.
 * All fields are hex-encoded strings for JSON serialization.
 */
export interface EncryptionResult {
  /** Hex-encoded ciphertext */
  encrypted: string;
  /** Hex-encoded random salt used for key derivation */
  salt: string;
  /** Hex-encoded initialization vector (128-bit) */
  iv: string;
  /** Hex-encoded GCM authentication tag */
  authTag: string;
}

/**
 * Encrypted wallet data structure stored in wallets.json.
 * Contains all data needed to restore a wallet with the correct password.
 */
export interface EncryptedWallet {
  /** User-assigned wallet name */
  name: string;
  /** AES-256-GCM encrypted mnemonic phrase */
  encryptedMnemonic: string;
  /** PBKDF2 salt for key derivation */
  salt: string;
  /** AES-GCM initialization vector */
  iv: string;
  /** GCM authentication tag for integrity verification */
  authTag: string;
  /** Network key the wallet was last used on */
  network: string;
  /** Currently active HD account index (BIP-44 path component) */
  currentAccountIndex: number;
  /** ISO 8601 timestamp of wallet creation */
  createdAt: string;
}

/**
 * Root structure of the wallets.json storage file.
 * Supports multiple wallet storage with versioning for future migrations.
 */
export interface WalletsFile {
  /** Schema version for migration compatibility */
  version: string;
  /** Array of encrypted wallet entries */
  wallets: EncryptedWallet[];
}

/**
 * Token balance information for portfolio display.
 * Includes both raw and formatted balance values.
 */
export interface PortfolioToken {
  /** Token ticker symbol */
  symbol: string;
  /** Raw balance as string (to preserve precision) */
  balance: string;
  /** Human-readable formatted balance with proper decimals */
  formattedBalance: string;
  /** Contract address (undefined for native tokens) */
  address?: string;
  /** Token type for display differentiation */
  type: 'native' | 'erc20';
  /** Human-readable token name */
  name?: string;
  /** Decimal places for the token */
  decimals?: number;
}

/**
 * Result returned after a successful blockchain transaction.
 * Contains confirmation details for display and tracking.
 */
export interface TransactionResult {
  /** Transaction hash (0x-prefixed) */
  hash: string;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** Transaction value in wei (as string for precision) */
  value: string;
  /** Actual gas consumed by the transaction */
  gasUsed?: string;
  /** Block number where transaction was included */
  blockNumber?: number;
}

/**
 * On-chain metadata for an ERC-20 token contract.
 * Retrieved by calling name(), symbol(), and decimals() on the contract.
 */
export interface TokenMetadata {
  /** Token ticker symbol from contract */
  symbol: string;
  /** Decimal places from contract */
  decimals: number;
  /** Token name from contract */
  name: string;
}
