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

// WebCrypto adapter: currently provides randomness; PBKDF2/cipher are not implemented in sync form.
export class WebCryptoAdapter implements CryptoAdapter {
  randomBytes(length: number): Uint8Array {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  pbkdf2Sync(): never {
    throw new Error('Synchronous PBKDF2 not supported in WebCrypto adapter');
  }

  createCipheriv(): never {
    throw new Error('Cipher operations not implemented for WebCrypto adapter');
  }

  createDecipheriv(): never {
    throw new Error('Decipher operations not implemented for WebCrypto adapter');
  }
}

export function createWebCryptoAdapter(): CryptoAdapter {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('WebCrypto not available');
  }
  return new WebCryptoAdapter();
}
