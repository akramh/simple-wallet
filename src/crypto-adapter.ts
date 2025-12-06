/**
 * @fileoverview Cryptographic adapter abstraction for cross-platform compatibility.
 * 
 * This module provides a unified interface for cryptographic operations that works
 * in both Node.js (using the crypto module) and browser environments (using
 * WebCrypto API with asmcrypto.js fallback for synchronous operations).
 * 
 * The adapter pattern allows switching crypto implementations at runtime:
 * - NodeCryptoAdapter: Uses Node.js built-in crypto module
 * - WebCryptoAdapter: Uses WebCrypto + asmcrypto.js for browser/extension
 * 
 * Key algorithms used:
 * - AES-256-GCM for mnemonic encryption
 * - PBKDF2-HMAC-SHA256 for key derivation (100k iterations)
 * 
 * @module crypto-adapter
 */

import nodeCrypto from 'crypto';
import { AES_GCM, Pbkdf2HmacSha256 } from 'asmcrypto.js';

/**
 * Abstract interface for cryptographic operations.
 * Implementations provide environment-specific crypto primitives.
 */
export interface CryptoAdapter {
  /**
   * Generate cryptographically secure random bytes.
   * @param length - Number of random bytes to generate
   * @returns Buffer (Node) or Uint8Array (browser) of random bytes
   */
  randomBytes(length: number): Buffer | Uint8Array;

  /**
   * Derive encryption key from password using PBKDF2.
   * @param password - User password
   * @param salt - Random salt for key derivation
   * @param iterations - Number of PBKDF2 iterations
   * @param keyLength - Desired key length in bytes
   * @param digest - Hash algorithm ('sha256')
   * @returns Derived key as Buffer or Uint8Array
   */
  pbkdf2Sync(password: string, salt: Buffer | Uint8Array, iterations: number, keyLength: number, digest: string): Buffer | Uint8Array;

  /**
   * Create an AES-GCM cipher for encryption.
   * @param algorithm - Cipher algorithm ('aes-256-gcm')
   * @param key - Encryption key
   * @param iv - Initialization vector
   * @returns Cipher object with update(), final(), getAuthTag() methods
   */
  createCipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any;

  /**
   * Create an AES-GCM decipher for decryption.
   * @param algorithm - Cipher algorithm ('aes-256-gcm')
   * @param key - Decryption key
   * @param iv - Initialization vector used during encryption
   * @returns Decipher object with setAuthTag(), update(), final() methods
   */
  createDecipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any;
}

/**
 * Node.js crypto module adapter.
 * Uses the built-in crypto module for all operations.
 * This is the default adapter used in CLI/Node.js environments.
 */
export class NodeCryptoAdapter implements CryptoAdapter {
  /**
   * Generate random bytes using Node's crypto.randomBytes.
   * @param length - Number of bytes to generate
   * @returns Buffer containing random bytes
   */
  randomBytes(length: number): Buffer {
    return nodeCrypto.randomBytes(length);
  }

  /**
   * Derive key using Node's synchronous PBKDF2 implementation.
   * @param password - Password string
   * @param salt - Salt buffer
   * @param iterations - Iteration count
   * @param keyLength - Output key length
   * @param digest - Hash algorithm
   * @returns Derived key buffer
   */
  pbkdf2Sync(password: string, salt: Buffer, iterations: number, keyLength: number, digest: string): Buffer {
    return nodeCrypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  }

  /**
   * Create cipher using Node's crypto.createCipheriv.
   * @param algorithm - Cipher algorithm
   * @param key - Encryption key
   * @param iv - Initialization vector
   * @returns Node Cipher object
   */
  createCipheriv(algorithm: string, key: Buffer, iv: Buffer) {
    return nodeCrypto.createCipheriv(algorithm, key, iv);
  }

  /**
   * Create decipher using Node's crypto.createDecipheriv.
   * @param algorithm - Cipher algorithm
   * @param key - Decryption key
   * @param iv - Initialization vector
   * @returns Node Decipher object
   */
  createDecipheriv(algorithm: string, key: Buffer, iv: Buffer) {
    return nodeCrypto.createDecipheriv(algorithm, key, iv);
  }
}

/**
 * Factory function to create a Node.js crypto adapter.
 * @returns Configured NodeCryptoAdapter instance
 */
export function createNodeCryptoAdapter(): CryptoAdapter {
  return new NodeCryptoAdapter();
}

/**
 * Browser WebCrypto adapter.
 * Uses WebCrypto API with asmcrypto.js for synchronous AES-GCM operations.
 * 
 * Note: asmcrypto.js is used because WebCrypto's native encrypt/decrypt are async,
 * but the wallet code expects synchronous cipher operations. asmcrypto.js provides
 * a pure JavaScript implementation of AES-GCM that runs synchronously.
 */
export class WebCryptoAdapter implements CryptoAdapter {
  /**
   * Generate random bytes using WebCrypto's getRandomValues.
   * @param length - Number of bytes to generate
   * @returns Uint8Array containing random bytes
   */
  randomBytes(length: number): Uint8Array {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  /**
   * Derive key using asmcrypto.js PBKDF2-HMAC-SHA256.
   * Only SHA256 is supported for browser compatibility.
   * @param password - Password string
   * @param salt - Salt as Buffer or Uint8Array
   * @param iterations - Iteration count
   * @param keyLength - Output key length
   * @param digest - Hash algorithm (must be 'sha256')
   * @returns Derived key as Uint8Array
   * @throws Error if digest is not 'sha256'
   */
  pbkdf2Sync(password: string, salt: Buffer | Uint8Array, iterations: number, keyLength: number, digest: string): Uint8Array {
    if (digest.toLowerCase() !== 'sha256') {
      throw new Error('WebCryptoAdapter only supports PBKDF2-HMAC-SHA256');
    }

    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const saltBytes = salt instanceof Buffer ? new Uint8Array(salt) : salt;

    return Pbkdf2HmacSha256(passwordBytes, saltBytes, iterations, keyLength);
  }

  /**
   * Create an AES-GCM cipher object using asmcrypto.js.
   * Returns a Node-compatible interface with update(), final(), getAuthTag().
   * 
   * Implementation note: Data is accumulated in chunks and encrypted
   * all at once in final() since asmcrypto.js doesn't support streaming.
   * 
   * @param algorithm - Must be 'aes-256-gcm'
   * @param key - 256-bit encryption key
   * @param iv - 128-bit initialization vector
   * @returns Cipher-like object with Node-compatible interface
   */
  createCipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any {
    const keyBytes = key instanceof Buffer ? new Uint8Array(key) : key;
    const ivBytes = iv instanceof Buffer ? new Uint8Array(iv) : iv;
    const chunks: Uint8Array[] = [];
    let authTag: Uint8Array | null = null;

    return {
      update: (data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string) => {
        const dataBytes = this.toUint8Array(data, inputEncoding);
        chunks.push(dataBytes);
        // Streaming output is not needed by current callers; return empty string/array for compatibility.
        return outputEncoding === 'hex' ? '' : new Uint8Array(0);
      },
      final: (outputEncoding?: string) => {
        const plaintext = this.concatChunks(chunks);
        const cipherWithTag = AES_GCM.encrypt(plaintext, keyBytes, ivBytes);
        const tagLength = 16;
        authTag = cipherWithTag.slice(cipherWithTag.length - tagLength);
        const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - tagLength);

        if (outputEncoding === 'hex') {
          return this.toHex(ciphertext);
        }
        return ciphertext;
      },
      getAuthTag: () => {
        if (!authTag) {
          throw new Error('Auth tag not available');
        }
        return authTag;
      }
    };
  }

  /**
   * Create an AES-GCM decipher object using asmcrypto.js.
   * Returns a Node-compatible interface with setAuthTag(), update(), final().
   * 
   * @param algorithm - Must be 'aes-256-gcm'
   * @param key - 256-bit decryption key
   * @param iv - 128-bit initialization vector used during encryption
   * @returns Decipher-like object with Node-compatible interface
   */
  createDecipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any {
    const keyBytes = key instanceof Buffer ? new Uint8Array(key) : key;
    const ivBytes = iv instanceof Buffer ? new Uint8Array(iv) : iv;
    const chunks: Uint8Array[] = [];
    let expectedAuthTag: Uint8Array | null = null;

    return {
      setAuthTag: (tag: Buffer | Uint8Array) => {
        expectedAuthTag = tag instanceof Buffer ? new Uint8Array(tag) : tag;
      },
      update: (data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string) => {
        const dataBytes = this.toUint8Array(data, inputEncoding);
        chunks.push(dataBytes);
        return outputEncoding === 'utf8' || outputEncoding === 'hex' ? '' : new Uint8Array(0);
      },
      final: (outputEncoding?: string) => {
        if (!expectedAuthTag) {
          throw new Error('Auth tag not set');
        }
        const ciphertext = this.concatChunks(chunks);
        const combined = new Uint8Array(ciphertext.length + expectedAuthTag.length);
        combined.set(ciphertext);
        combined.set(expectedAuthTag, ciphertext.length);

        const plaintext = AES_GCM.decrypt(combined, keyBytes, ivBytes);

        if (outputEncoding === 'utf8') {
          const decoder = new TextDecoder();
          return decoder.decode(plaintext);
        }
        if (outputEncoding === 'hex') {
          return this.toHex(plaintext);
        }
        return plaintext;
      }
    };
  }

  /**
   * Convert various input types to Uint8Array.
   * @param data - String, Buffer, or Uint8Array input
   * @param inputEncoding - 'hex' for hex strings, otherwise UTF-8
   * @returns Uint8Array representation
   * @private
   */
  private toUint8Array(data: string | Buffer | Uint8Array, inputEncoding?: string): Uint8Array {
    if (typeof data === 'string') {
      if (inputEncoding === 'hex') {
        const len = data.length / 2;
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          out[i] = parseInt(data.substr(i * 2, 2), 16);
        }
        return out;
      }
      const encoder = new TextEncoder();
      return encoder.encode(data);
    }
    return data instanceof Buffer ? new Uint8Array(data) : data;
  }

  /**
   * Convert Uint8Array to hex string.
   * @param data - Byte array to convert
   * @returns Lowercase hex string
   * @private
   */
  private toHex(data: Uint8Array): string {
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Concatenate multiple Uint8Arrays into one.
   * @param chunks - Array of Uint8Arrays
   * @returns Single concatenated Uint8Array
   * @private
   */
  private concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Factory function to create a WebCrypto-based adapter.
 * @returns Configured WebCryptoAdapter instance
 * @throws Error if WebCrypto is not available in the environment
 */
export function createWebCryptoAdapter(): CryptoAdapter {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('WebCrypto not available');
  }
  return new WebCryptoAdapter();
}
