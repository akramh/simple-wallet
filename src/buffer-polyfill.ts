// Buffer polyfill for browser environments
// Provides minimal Buffer API needed for the wallet

export class BufferPolyfill extends Uint8Array {
  static from(data: any, encoding?: string): BufferPolyfill {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      return new BufferPolyfill(data);
    }

    if (typeof data === 'string') {
      if (encoding === 'hex') {
        return BufferPolyfill.fromHex(data);
      }
      if (encoding === 'base64') {
        return BufferPolyfill.fromBase64(data);
      }
      // Default to UTF-8
      const encoder = new TextEncoder();
      return new BufferPolyfill(encoder.encode(data));
    }

    if (Array.isArray(data)) {
      return new BufferPolyfill(new Uint8Array(data));
    }

    throw new Error('Unsupported data type for Buffer.from');
  }

  static fromHex(hex: string): BufferPolyfill {
    const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
    }
    return new BufferPolyfill(bytes);
  }

  static fromBase64(base64: string): BufferPolyfill {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new BufferPolyfill(bytes);
  }

  toString(encoding?: string): string {
    if (encoding === 'hex') {
      return Array.from(this)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    if (encoding === 'base64') {
      const binary = String.fromCharCode(...Array.from(this));
      return btoa(binary);
    }

    // Default to UTF-8
    const decoder = new TextDecoder();
    return decoder.decode(this);
  }
}

// Install Buffer polyfill globally if not present
if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = BufferPolyfill;
}

export default BufferPolyfill;
