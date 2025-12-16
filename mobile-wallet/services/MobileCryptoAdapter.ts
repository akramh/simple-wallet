/**
 * @fileoverview Mobile crypto adapter for React Native.
 *
 * Implements the CryptoAdapter interface using WebCrypto SubtleCrypto API
 * which is available in React Native's Hermes engine.
 *
 * Note: For production, consider using react-native-quick-crypto for
 * better performance. This implementation uses the built-in WebCrypto API.
 *
 * @responsibilities
 * - Provide a CryptoAdapter implementation compatible with the shared SDK
 * - Support synchronous-looking primitives expected by the SDK's storage/encryption layer
 *
 * @security
 * - Do not log secrets (passwords, derived keys, auth tags). If debug logs are present,
 *   they must be treated as development-only and removed/guarded before production release.
 * - This adapter is an environment bridge; the shared SDK defines encryption parameters.
 */

// @ts-ignore - asmcrypto.js types
import { AES_GCM } from 'asmcrypto.js';

/**
 * CryptoAdapter interface (must match src/crypto-adapter.ts).
 */
export interface CryptoAdapter {
  randomBytes(length: number): Buffer | Uint8Array;
  pbkdf2Sync(
    password: string,
    salt: Buffer | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Buffer | Uint8Array;
  createCipheriv(
    algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): any;
  createDecipheriv(
    algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): any;
}

/**
 * Convert various input types to Uint8Array.
 */
function toUint8Array(
  data: string | Buffer | Uint8Array,
  encoding?: string
): Uint8Array {
  // Handle string input
  if (typeof data === 'string') {
    if (encoding === 'hex') {
      const bytes = new Uint8Array(data.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(data.substr(i * 2, 2), 16);
      }
      return bytes;
    }
    // Default to UTF-8
    return new TextEncoder().encode(data);
  }
  
  // Handle Buffer and Uint8Array - always copy to ensure we have clean data
  if (data instanceof Uint8Array) {
    // Create a fresh copy to avoid shared ArrayBuffer issues
    const copy = new Uint8Array(data.length);
    copy.set(data);
    return copy;
  }
  
  // Buffer (polyfilled) - it has buffer, byteOffset, byteLength properties
  if (data && typeof data === 'object' && 'buffer' in data) {
    return new Uint8Array((data as any).buffer, (data as any).byteOffset, (data as any).byteLength);
  }
  // Fallback: try to create from iterable
  return Uint8Array.from(data as any);
}

/**
 * Convert Uint8Array to hex string.
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Concatenate multiple Uint8Arrays.
 */
function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Mobile crypto adapter for React Native.
 *
 * Note: The StorageAdapter interface expects synchronous crypto operations.
 * We use asmcrypto.js for synchronous AES-GCM encryption/decryption
 * and pure JavaScript for PBKDF2-HMAC-SHA256 key derivation.
 *
 * For production use, consider react-native-quick-crypto which provides
 * synchronous native crypto operations with better performance.
 */
export class MobileCryptoAdapter implements CryptoAdapter {
  /**
   * Generate cryptographically secure random bytes.
   */
  randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Derive key using PBKDF2-HMAC-SHA256 (synchronous pure JS implementation).
   */
  pbkdf2Sync(
    password: string,
    salt: Buffer | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Uint8Array {
    const saltBytes = toUint8Array(salt);
    console.log('[MobileCryptoAdapter] pbkdf2Sync() password length:', password.length, 
      'salt length:', saltBytes.length, 
      'salt hex:', toHex(saltBytes.slice(0, 8)) + '...',
      'iterations:', iterations, 'keyLength:', keyLength);
    // Use our pure JavaScript PBKDF2 implementation
    const result = this.pbkdf2Pure(password, saltBytes, iterations, keyLength, digest);
    console.log('[MobileCryptoAdapter] pbkdf2Sync() derived key first 8 bytes:', toHex(result.slice(0, 8)));
    return result;
  }

  /**
   * Pure JavaScript PBKDF2-HMAC-SHA256 implementation.
   * Slower than native but works synchronously in React Native.
   */
  private pbkdf2Pure(
    password: string,
    saltBytes: Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Uint8Array {
    // Convert password to bytes
    const passwordBytes = new TextEncoder().encode(password);
    
    // HMAC-SHA256 based PBKDF2
    const hashLen = 32; // SHA256 output length
    const numBlocks = Math.ceil(keyLength / hashLen);
    const result = new Uint8Array(numBlocks * hashLen);
    
    for (let block = 1; block <= numBlocks; block++) {
      // U1 = HMAC(password, salt || INT(block))
      const blockBytes = new Uint8Array(4);
      blockBytes[0] = (block >> 24) & 0xff;
      blockBytes[1] = (block >> 16) & 0xff;
      blockBytes[2] = (block >> 8) & 0xff;
      blockBytes[3] = block & 0xff;
      
      const saltBlock = new Uint8Array(saltBytes.length + 4);
      saltBlock.set(saltBytes);
      saltBlock.set(blockBytes, saltBytes.length);
      
      let u = this.hmacSha256Sync(passwordBytes, saltBlock);
      const t = new Uint8Array(u);
      
      // Iterate: Ui = HMAC(password, Ui-1), T = U1 ^ U2 ^ ... ^ Uiterations
      for (let i = 1; i < iterations; i++) {
        u = this.hmacSha256Sync(passwordBytes, u);
        for (let j = 0; j < hashLen; j++) {
          t[j] ^= u[j];
        }
      }
      
      result.set(t, (block - 1) * hashLen);
    }
    
    return result.slice(0, keyLength);
  }

  /**
   * Synchronous HMAC-SHA256 using pure JavaScript.
   */
  private hmacSha256Sync(key: Uint8Array, message: Uint8Array): Uint8Array {
    const blockSize = 64;
    const hashLen = 32;
    
    // If key is longer than block size, hash it
    let keyBytes = key;
    if (keyBytes.length > blockSize) {
      keyBytes = this.sha256Sync(keyBytes);
    }
    
    // Pad key to block size
    const paddedKey = new Uint8Array(blockSize);
    paddedKey.set(keyBytes);
    
    // Create inner and outer padded keys
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5c;
    }
    
    // Inner hash: H(ipad || message)
    const innerData = new Uint8Array(blockSize + message.length);
    innerData.set(ipad);
    innerData.set(message, blockSize);
    const innerHash = this.sha256Sync(innerData);
    
    // Outer hash: H(opad || innerHash)
    const outerData = new Uint8Array(blockSize + hashLen);
    outerData.set(opad);
    outerData.set(innerHash, blockSize);
    
    return this.sha256Sync(outerData);
  }

  /**
   * Synchronous SHA256 using pure JavaScript.
   */
  private sha256Sync(message: Uint8Array): Uint8Array {
    // SHA-256 constants
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);

    // Initial hash values
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    // Pre-processing: adding padding bits
    const msgLen = message.length;
    const bitLen = msgLen * 8;
    
    // Calculate padding: message + 1 byte (0x80) + padding + 8 bytes (length) must be multiple of 64
    let paddedLen = msgLen + 1 + 8; // minimum: msg + 0x80 + 64-bit length
    paddedLen = Math.ceil(paddedLen / 64) * 64; // round up to next 64-byte boundary
    
    // Create padded message with its own ArrayBuffer
    const paddedBuffer = new ArrayBuffer(paddedLen);
    const padded = new Uint8Array(paddedBuffer);
    padded.set(message);
    padded[msgLen] = 0x80;
    
    // Length in bits as 64-bit big-endian (we only use lower 32 bits for simplicity)
    const view = new DataView(paddedBuffer);
    view.setUint32(paddedLen - 4, bitLen, false);

    // Process each 512-bit chunk
    const W = new Uint32Array(64);
    for (let offset = 0; offset < paddedLen; offset += 64) {
      // Copy chunk into first 16 words
      for (let i = 0; i < 16; i++) {
        W[i] = view.getUint32(offset + i * 4, false);
      }
      // Extend to 64 words
      for (let i = 16; i < 64; i++) {
        const s0 = this.rotr(W[i-15], 7) ^ this.rotr(W[i-15], 18) ^ (W[i-15] >>> 3);
        const s1 = this.rotr(W[i-2], 17) ^ this.rotr(W[i-2], 19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
      }

      // Initialize working variables
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      // Compression function
      for (let i = 0; i < 64; i++) {
        const S1 = this.rotr(e, 6) ^ this.rotr(e, 11) ^ this.rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = this.rotr(a, 2) ^ this.rotr(a, 13) ^ this.rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }

      // Add to hash
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    // Produce the final hash value
    const resultBuffer = new ArrayBuffer(32);
    const result = new Uint8Array(resultBuffer);
    const resultView = new DataView(resultBuffer);
    resultView.setUint32(0, h0, false);
    resultView.setUint32(4, h1, false);
    resultView.setUint32(8, h2, false);
    resultView.setUint32(12, h3, false);
    resultView.setUint32(16, h4, false);
    resultView.setUint32(20, h5, false);
    resultView.setUint32(24, h6, false);
    resultView.setUint32(28, h7, false);
    
    return result;
  }

  private rotr(x: number, n: number): number {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  /**
   * Create AES-GCM cipher for encryption.
   */
  createCipheriv(
    algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): CipherLike {
    const keyBytes = toUint8Array(key);
    const ivBytes = toUint8Array(iv);
    console.log('[MobileCryptoAdapter] createCipheriv() key first 4 bytes:', toHex(keyBytes.slice(0, 4)), 'iv first 4 bytes:', toHex(ivBytes.slice(0, 4)));

    return new CipherWrapper(keyBytes, ivBytes, 'encrypt');
  }

  /**
   * Create AES-GCM decipher for decryption.
   */
  createDecipheriv(
    algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): DecipherLike {
    const keyBytes = toUint8Array(key);
    const ivBytes = toUint8Array(iv);
    console.log('[MobileCryptoAdapter] createDecipheriv() key first 4 bytes:', toHex(keyBytes.slice(0, 4)), 'iv first 4 bytes:', toHex(ivBytes.slice(0, 4)));

    return new DecipherWrapper(keyBytes, ivBytes);
  }
}

/**
 * Cipher-like wrapper using asmcrypto.js for synchronous AES-GCM encryption.
 */
class CipherWrapper {
  private chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;
  private result: Uint8Array | null = null;

  constructor(
    private key: Uint8Array,
    private iv: Uint8Array,
    private mode: 'encrypt' | 'decrypt'
  ) {
    console.log('[CipherWrapper] Created with key length:', key.length, 'iv length:', iv.length);
  }

  update(
    data: string | Buffer | Uint8Array,
    inputEncoding?: string,
    outputEncoding?: string
  ): string | Uint8Array {
    const bytes = toUint8Array(data, inputEncoding);
    console.log('[CipherWrapper] update() input length:', bytes.length, 'inputEncoding:', inputEncoding);
    this.chunks.push(bytes);
    return outputEncoding === 'hex' ? '' : new Uint8Array(0);
  }

  final(outputEncoding?: string): string | Uint8Array {
    if (!this.result) {
      const plaintext = concatArrays(this.chunks);
      console.log('[CipherWrapper] final() plaintext length:', plaintext.length);

      // Use asmcrypto.js for synchronous AES-GCM encryption
      // AES_GCM.encrypt returns ciphertext with 16-byte auth tag appended
      const encryptedWithTag = AES_GCM.encrypt(
        plaintext,
        this.key,
        this.iv
      );
      console.log('[CipherWrapper] encrypted length (with tag):', encryptedWithTag.length);

      // Extract ciphertext and auth tag (last 16 bytes)
      this.result = encryptedWithTag.slice(0, encryptedWithTag.length - 16);
      this.authTag = encryptedWithTag.slice(encryptedWithTag.length - 16);
      console.log('[CipherWrapper] ciphertext length:', this.result.length, 'authTag length:', this.authTag.length);
    }

    return outputEncoding === 'hex' ? toHex(this.result) : this.result;
  }

  getAuthTag(): Uint8Array {
    if (!this.authTag) {
      throw new Error('Auth tag not available - call final() first');
    }
    return this.authTag;
  }
}

/**
 * Decipher-like wrapper using asmcrypto.js for synchronous AES-GCM decryption.
 */
class DecipherWrapper {
  private chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;
  private result: Uint8Array | null = null;

  constructor(
    private key: Uint8Array,
    private iv: Uint8Array
  ) {
    console.log('[DecipherWrapper] Created with key length:', key.length, 'iv length:', iv.length);
  }

  setAuthTag(tag: Buffer | Uint8Array): void {
    this.authTag = toUint8Array(tag);
    console.log('[DecipherWrapper] setAuthTag() length:', this.authTag.length);
  }

  update(
    data: string | Buffer | Uint8Array,
    inputEncoding?: string,
    outputEncoding?: string
  ): string | Uint8Array {
    const bytes = toUint8Array(data, inputEncoding);
    console.log('[DecipherWrapper] update() input length:', bytes.length, 'inputEncoding:', inputEncoding);
    this.chunks.push(bytes);
    return outputEncoding === 'utf8' || outputEncoding === 'hex'
      ? ''
      : new Uint8Array(0);
  }

  final(outputEncoding?: string): string | Uint8Array {
    if (!this.authTag) {
      throw new Error('Auth tag not set');
    }

    if (!this.result) {
      const ciphertext = concatArrays(this.chunks);
      console.log('[DecipherWrapper] final() ciphertext length:', ciphertext.length, 'authTag length:', this.authTag.length);
      
      // asmcrypto.js expects ciphertext + authTag concatenated
      const ciphertextWithTag = new Uint8Array(ciphertext.length + this.authTag.length);
      ciphertextWithTag.set(ciphertext, 0);
      ciphertextWithTag.set(this.authTag, ciphertext.length);
      console.log('[DecipherWrapper] ciphertextWithTag length:', ciphertextWithTag.length);
      
      try {
        // Use asmcrypto.js for synchronous AES-GCM decryption
        this.result = AES_GCM.decrypt(
          ciphertextWithTag,
          this.key,
          this.iv
        );
        console.log('[DecipherWrapper] decrypted length:', this.result.length);
      } catch (error) {
        // asmcrypto.js throws on auth failure - convert to expected error message
        console.error('[DecipherWrapper] Decryption failed:', error);
        throw new Error('Unsupported state or unable to authenticate data');
      }
    }

    if (outputEncoding === 'utf8') {
      return new TextDecoder().decode(this.result);
    }
    return this.result;
  }
}

interface CipherLike {
  update(data: any, inputEncoding?: string, outputEncoding?: string): any;
  final(outputEncoding?: string): any;
  getAuthTag(): Uint8Array;
}

interface DecipherLike {
  setAuthTag(tag: any): void;
  update(data: any, inputEncoding?: string, outputEncoding?: string): any;
  final(outputEncoding?: string): any;
}

/**
 * Singleton instance.
 */
export const mobileCrypto = new MobileCryptoAdapter();
