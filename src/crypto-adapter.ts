import nodeCrypto from 'crypto';
import { AES_GCM, Pbkdf2HmacSha256 } from 'asmcrypto.js';

// Minimal interface to allow swapping between Node crypto and WebCrypto.
export interface CryptoAdapter {
  randomBytes(length: number): Buffer | Uint8Array;
  pbkdf2Sync(password: string, salt: Buffer | Uint8Array, iterations: number, keyLength: number, digest: string): Buffer | Uint8Array;
  createCipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any;
  createDecipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any;
}

export class NodeCryptoAdapter implements CryptoAdapter {
  randomBytes(length: number): Buffer {
    return nodeCrypto.randomBytes(length);
  }
  pbkdf2Sync(password: string, salt: Buffer, iterations: number, keyLength: number, digest: string): Buffer {
    return nodeCrypto.pbkdf2Sync(password, salt, iterations, keyLength, digest);
  }
  createCipheriv(algorithm: string, key: Buffer, iv: Buffer) {
    return nodeCrypto.createCipheriv(algorithm, key, iv);
  }
  createDecipheriv(algorithm: string, key: Buffer, iv: Buffer) {
    return nodeCrypto.createDecipheriv(algorithm, key, iv);
  }
}

export function createNodeCryptoAdapter(): CryptoAdapter {
  return new NodeCryptoAdapter();
}

// WebCrypto adapter: provides browser-compatible crypto operations
export class WebCryptoAdapter implements CryptoAdapter {
  randomBytes(length: number): Uint8Array {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  pbkdf2Sync(password: string, salt: Buffer | Uint8Array, iterations: number, keyLength: number, digest: string): Uint8Array {
    if (digest.toLowerCase() !== 'sha256') {
      throw new Error('WebCryptoAdapter only supports PBKDF2-HMAC-SHA256');
    }

    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const saltBytes = salt instanceof Buffer ? new Uint8Array(salt) : salt;

    return Pbkdf2HmacSha256(passwordBytes, saltBytes, iterations, keyLength);
  }

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

  private toHex(data: Uint8Array): string {
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  }

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

export function createWebCryptoAdapter(): CryptoAdapter {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('WebCrypto not available');
  }
  return new WebCryptoAdapter();
}
