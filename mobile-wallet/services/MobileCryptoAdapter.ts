/**
 * @fileoverview Mobile crypto adapter for React Native.
 *
 * Implements the CryptoAdapter interface with a layered approach:
 * 1. react-native-quick-crypto (native C++ via JSI) - fastest, ~20ms for 100k iterations
 * 2. @noble/hashes (pure JS) - fallback for Jest tests, ~20ms in Node but ~16s in Hermes
 *
 * ## Why PBKDF2 is slow in Hermes
 *
 * Hermes is optimized for fast app startup (AOT compilation), not CPU-intensive loops.
 * PBKDF2 with 100k iterations requires 200k+ SHA256 operations. Each SHA256 has 64 rounds
 * of bitwise operations. Pure JS in Hermes is ~800x slower than native code.
 *
 * | Engine | PBKDF2 100k | Reason |
 * |--------|-------------|--------|
 * | V8 (Node) | ~20ms | JIT optimizes hot loops |
 * | Hermes (RN) | ~16,000ms | AOT bytecode, no loop optimization |
 * | Native C++ | ~20ms | Full CPU speed, OpenSSL optimizations |
 *
 * ## MetaMask's Approach
 *
 * MetaMask uses react-native-quick-crypto@0.7.15 which calls fastpbkdf2.c via JSI.
 * This gives native performance without blocking the JS thread.
 *
 * @see https://github.com/margelo/react-native-quick-crypto
 * @see https://nicolo.dev/en/blog/slow-crypto-react-native-how-to-fix/
 */

// @ts-ignore - asmcrypto.js types
import { AES_GCM } from 'asmcrypto.js';

// Try to import react-native-quick-crypto (native)
// This is v0.7.15 which uses simpler JSI bindings (no nitro-modules)
let QuickCrypto: {
  pbkdf2Sync: (password: ArrayBuffer, salt: ArrayBuffer, iterations: number, keylen: number, digest: string) => ArrayBuffer;
  randomBytes: (size: number) => ArrayBuffer;
} | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const qc = require('react-native-quick-crypto');
  // Check if native module is available (won't be in Jest)
  if (qc.pbkdf2Sync && typeof qc.pbkdf2Sync === 'function') {
    QuickCrypto = qc;
    console.log('[MobileCryptoAdapter] Using react-native-quick-crypto (native)');
  }
} catch (e) {
  console.log('[MobileCryptoAdapter] react-native-quick-crypto not available');
}

// Fallback to @noble/hashes for Jest tests (pure JS, works in Node.js)
let noblePbkdf2: ((hash: unknown, password: string, salt: Uint8Array, opts: { c: number; dkLen: number }) => Uint8Array) | null = null;
let nobleSha256: unknown = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pbkdf2 } = require('@noble/hashes/pbkdf2');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sha256 } = require('@noble/hashes/sha256');
  noblePbkdf2 = pbkdf2;
  nobleSha256 = sha256;
} catch (e) {
  console.log('[MobileCryptoAdapter] @noble/hashes not available');
}

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
  ): CipherLike;
  createDecipheriv(
    algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): DecipherLike;
}

/**
 * Extended interface with async PBKDF2 support.
 */
export interface AsyncCryptoAdapter extends CryptoAdapter {
  pbkdf2Async(
    password: string,
    salt: Buffer | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Promise<Uint8Array>;
}

/**
 * Convert various input types to Uint8Array.
 */
function toUint8Array(
  data: string | Buffer | Uint8Array,
  encoding?: string
): Uint8Array {
  if (typeof data === 'string') {
    if (encoding === 'hex') {
      const bytes = new Uint8Array(data.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(data.substr(i * 2, 2), 16);
      }
      return bytes;
    }
    return new TextEncoder().encode(data);
  }
  
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    return copy;
  }
  
  if (data && typeof data === 'object' && 'buffer' in data) {
    return new Uint8Array((data as Buffer).buffer, (data as Buffer).byteOffset, (data as Buffer).byteLength);
  }
  
  return Uint8Array.from(data as Iterable<number>);
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
 * Uses react-native-quick-crypto for native-speed PBKDF2 (~20ms for 100k iterations).
 * Falls back to @noble/hashes for Jest tests.
 */
export class MobileCryptoAdapter implements AsyncCryptoAdapter {
  /**
   * Generate cryptographically secure random bytes.
   */
  randomBytes(length: number): Uint8Array {
    if (QuickCrypto?.randomBytes) {
      return new Uint8Array(QuickCrypto.randomBytes(length));
    }
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Derive key using PBKDF2 asynchronously.
   * Wraps sync call in Promise to not block initial render.
   */
  async pbkdf2Async(
    password: string,
    salt: Buffer | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Promise<Uint8Array> {
    // Yield to event loop to allow loading UI to render
    await new Promise(resolve => setTimeout(resolve, 0));
    return this.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  }

  /**
   * Derive key using PBKDF2 synchronously.
   *
   * Priority:
   * 1. react-native-quick-crypto (native C++, ~20ms)
   * 2. @noble/hashes (pure JS, ~20ms in Node, ~16s in Hermes)
   */
  pbkdf2Sync(
    password: string,
    salt: Buffer | Uint8Array,
    iterations: number,
    keyLength: number,
    digest: string
  ): Uint8Array {
    const saltBytes = toUint8Array(salt);
    const startTime = Date.now();
    let result: Uint8Array;
    let implementation: string;

    if (QuickCrypto) {
      // Native C++ implementation via JSI - fastest option
      try {
        const passwordBuffer = new TextEncoder().encode(password).buffer;
        const saltBuffer = saltBytes.buffer.slice(
          saltBytes.byteOffset,
          saltBytes.byteOffset + saltBytes.byteLength
        );
        const resultBuffer = QuickCrypto.pbkdf2Sync(
          passwordBuffer,
          saltBuffer,
          iterations,
          keyLength,
          digest.toLowerCase()
        );
        result = new Uint8Array(resultBuffer);
        implementation = 'quick-crypto-native';
      } catch (e) {
        console.warn('[MobileCryptoAdapter] quick-crypto failed:', e);
        // Fall through to noble-hashes
        if (noblePbkdf2 && nobleSha256) {
          result = noblePbkdf2(nobleSha256, password, saltBytes, { c: iterations, dkLen: keyLength });
          implementation = 'noble-hashes-fallback';
        } else {
          throw new Error('No PBKDF2 implementation available');
        }
      }
    } else if (noblePbkdf2 && nobleSha256) {
      // Pure JS implementation - fast in Node.js, slow in Hermes
      result = noblePbkdf2(nobleSha256, password, saltBytes, { c: iterations, dkLen: keyLength });
      implementation = 'noble-hashes';
    } else {
      throw new Error('No PBKDF2 implementation available');
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[MobileCryptoAdapter] pbkdf2Sync() ${elapsedMs}ms (${implementation})`);

    return result;
  }

  /**
   * Create AES-GCM cipher for encryption.
   */
  createCipheriv(
    _algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): CipherLike {
    const keyBytes = toUint8Array(key);
    const ivBytes = toUint8Array(iv);
    return new CipherWrapper(keyBytes, ivBytes);
  }

  /**
   * Create AES-GCM decipher for decryption.
   */
  createDecipheriv(
    _algorithm: string,
    key: Buffer | Uint8Array,
    iv: Buffer | Uint8Array
  ): DecipherLike {
    const keyBytes = toUint8Array(key);
    const ivBytes = toUint8Array(iv);
    return new DecipherWrapper(keyBytes, ivBytes);
  }
}

/**
 * Cipher-like wrapper using asmcrypto.js for synchronous AES-GCM encryption.
 */
class CipherWrapper implements CipherLike {
  private chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;
  private result: Uint8Array | null = null;

  constructor(
    private key: Uint8Array,
    private iv: Uint8Array
  ) {}

  update(
    data: string | Buffer | Uint8Array,
    inputEncoding?: string,
    outputEncoding?: string
  ): string | Uint8Array {
    const bytes = toUint8Array(data, inputEncoding);
    this.chunks.push(bytes);
    return outputEncoding === 'hex' ? '' : new Uint8Array(0);
  }

  final(outputEncoding?: string): string | Uint8Array {
    if (!this.result) {
      const plaintext = concatArrays(this.chunks);
      const encryptedWithTag = AES_GCM.encrypt(plaintext, this.key, this.iv);
      this.result = encryptedWithTag.slice(0, encryptedWithTag.length - 16);
      this.authTag = encryptedWithTag.slice(encryptedWithTag.length - 16);
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
class DecipherWrapper implements DecipherLike {
  private chunks: Uint8Array[] = [];
  private authTag: Uint8Array | null = null;
  private result: Uint8Array | null = null;

  constructor(
    private key: Uint8Array,
    private iv: Uint8Array
  ) {}

  setAuthTag(tag: Buffer | Uint8Array): void {
    this.authTag = toUint8Array(tag);
  }

  update(
    data: string | Buffer | Uint8Array,
    inputEncoding?: string,
    outputEncoding?: string
  ): string | Uint8Array {
    const bytes = toUint8Array(data, inputEncoding);
    this.chunks.push(bytes);
    return outputEncoding === 'utf8' || outputEncoding === 'hex' ? '' : new Uint8Array(0);
  }

  final(outputEncoding?: string): string | Uint8Array {
    if (!this.authTag) {
      throw new Error('Auth tag not set');
    }

    if (!this.result) {
      const ciphertext = concatArrays(this.chunks);
      const ciphertextWithTag = new Uint8Array(ciphertext.length + this.authTag.length);
      ciphertextWithTag.set(ciphertext, 0);
      ciphertextWithTag.set(this.authTag, ciphertext.length);

      try {
        this.result = AES_GCM.decrypt(ciphertextWithTag, this.key, this.iv);
      } catch (error) {
        throw new Error('Unsupported state or unable to authenticate data');
      }
    }

    if (outputEncoding === 'utf8') {
      return new TextDecoder().decode(this.result);
    }
    return this.result;
  }
}

export interface CipherLike {
  update(data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): string | Uint8Array;
  final(outputEncoding?: string): string | Uint8Array;
  getAuthTag(): Uint8Array;
}

export interface DecipherLike {
  setAuthTag(tag: Buffer | Uint8Array): void;
  update(data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string): string | Uint8Array;
  final(outputEncoding?: string): string | Uint8Array;
}

/**
 * Singleton instance.
 */
export const mobileCrypto = new MobileCryptoAdapter();
