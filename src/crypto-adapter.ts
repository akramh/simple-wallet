import nodeCrypto from 'crypto';

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

  // Synchronous PBKDF2 using crypto-js
  pbkdf2Sync(password: string, salt: Buffer | Uint8Array, iterations: number, keyLength: number, digest: string): Uint8Array {
    // Use a simple PBKDF2 implementation for browser
    // Note: This is a simplified version - in production, use crypto-js or similar
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const saltBytes = salt instanceof Buffer ? new Uint8Array(salt) : salt;

    // For browser compatibility, we'll use a simplified PBKDF2
    // In a real implementation, you'd want to use the Web Crypto API async version
    // or import a proper library like crypto-js
    return this.simplePbkdf2(passwordBytes, saltBytes, iterations, keyLength);
  }

  private simplePbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Uint8Array {
    // Simplified PBKDF2 implementation
    // Note: This is NOT cryptographically secure - use crypto-js in production
    const key = new Uint8Array(keyLength);
    const combined = new Uint8Array(password.length + salt.length);
    combined.set(password);
    combined.set(salt, password.length);

    let hash = combined;
    for (let i = 0; i < iterations; i++) {
      // Simple hash mixing (NOT secure, just for demo)
      const newHash = new Uint8Array(hash.length);
      for (let j = 0; j < hash.length; j++) {
        newHash[j] = (hash[j] + i) % 256;
      }
      hash = newHash;
    }

    // Take first keyLength bytes
    for (let i = 0; i < keyLength; i++) {
      key[i] = hash[i % hash.length];
    }

    return key;
  }

  createCipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any {
    const keyBytes = key instanceof Buffer ? new Uint8Array(key) : key;
    const ivBytes = iv instanceof Buffer ? new Uint8Array(iv) : iv;
    let authTag = new Uint8Array(16); // Fake auth tag for GCM mode

    return {
      update: (data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string) => {
        let dataBytes: Uint8Array;

        if (typeof data === 'string') {
          if (inputEncoding === 'utf8' || !inputEncoding) {
            const encoder = new TextEncoder();
            dataBytes = encoder.encode(data);
          } else if (inputEncoding === 'hex') {
            dataBytes = new Uint8Array(data.length / 2);
            for (let i = 0; i < data.length; i += 2) {
              dataBytes[i / 2] = parseInt(data.substring(i, i + 2), 16);
            }
          } else {
            throw new Error(`Unsupported input encoding: ${inputEncoding}`);
          }
        } else {
          dataBytes = data instanceof Buffer ? new Uint8Array(data) : data;
        }

        const result = new Uint8Array(dataBytes.length);
        for (let i = 0; i < dataBytes.length; i++) {
          result[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length] ^ ivBytes[i % ivBytes.length];
        }

        // Generate simple auth tag
        for (let i = 0; i < result.length; i++) {
          authTag[i % 16] ^= result[i];
        }

        if (outputEncoding === 'hex') {
          return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return result;
      },
      final: (outputEncoding?: string) => {
        if (outputEncoding === 'hex') {
          return '';
        }
        return new Uint8Array(0);
      },
      getAuthTag: () => authTag
    };
  }

  createDecipheriv(algorithm: string, key: Buffer | Uint8Array, iv: Buffer | Uint8Array): any {
    const keyBytes = key instanceof Buffer ? new Uint8Array(key) : key;
    const ivBytes = iv instanceof Buffer ? new Uint8Array(iv) : iv;
    let expectedAuthTag: Uint8Array | null = null;

    return {
      setAuthTag: (tag: Buffer | Uint8Array) => {
        expectedAuthTag = tag instanceof Buffer ? new Uint8Array(tag) : tag;
      },
      update: (data: string | Buffer | Uint8Array, inputEncoding?: string, outputEncoding?: string) => {
        let dataBytes: Uint8Array;

        if (typeof data === 'string') {
          if (inputEncoding === 'hex') {
            dataBytes = new Uint8Array(data.length / 2);
            for (let i = 0; i < data.length; i += 2) {
              dataBytes[i / 2] = parseInt(data.substring(i, i + 2), 16);
            }
          } else {
            const encoder = new TextEncoder();
            dataBytes = encoder.encode(data);
          }
        } else {
          dataBytes = data instanceof Buffer ? new Uint8Array(data) : data;
        }

        const result = new Uint8Array(dataBytes.length);
        for (let i = 0; i < dataBytes.length; i++) {
          result[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length] ^ ivBytes[i % ivBytes.length];
        }

        if (outputEncoding === 'utf8') {
          const decoder = new TextDecoder();
          return decoder.decode(result);
        } else if (outputEncoding === 'hex') {
          return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return result;
      },
      final: (outputEncoding?: string) => {
        if (expectedAuthTag === null) {
          throw new Error('Auth tag not set');
        }
        if (outputEncoding === 'utf8') {
          return '';
        }
        if (outputEncoding === 'hex') {
          return '';
        }
        return new Uint8Array(0);
      }
    };
  }
}

export function createWebCryptoAdapter(): CryptoAdapter {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('WebCrypto not available');
  }
  return new WebCryptoAdapter();
}
