/**
 * @file buffer-polyfill.ts
 * @description Buffer polyfill for browser environments.
 * 
 * Provides a minimal Buffer API compatible with Node.js Buffer for use
 * in browsers. Supports hex/base64/UTF-8 encoding/decoding needed by
 * cryptographic operations in the wallet.
 * 
 * @responsibilities
 * - Provide Buffer.from() for string/array/typed array conversion
 * - Support hex, base64, and UTF-8 encoding/decoding
 * - Auto-install as globalThis.Buffer if not already present
 * 
 * @compatibility
 * - Works in browsers, web workers, and service workers
 * - Falls back silently in Node.js (native Buffer exists)
 * 
 * @example
 * ```typescript
 * import './buffer-polyfill.js';
 * 
 * // Now globalThis.Buffer is available
 * const buf = Buffer.from('hello', 'hex');
 * console.log(buf.toString('base64'));
 * ```
 */

/**
 * Buffer polyfill class extending Uint8Array.
 * Provides encoding/decoding methods compatible with Node.js Buffer.
 */
export class BufferPolyfill extends Uint8Array {
  /**
   * Creates a BufferPolyfill from various data sources.
   * Mimics Node.js Buffer.from() behavior.
   * 
   * @param data - Input data (string, Uint8Array, ArrayBuffer, or number array)
   * @param encoding - String encoding: 'hex', 'base64', or 'utf8' (default)
   * @returns New BufferPolyfill instance
   * @throws Error if data type is unsupported
   * 
   * @example
   * ```typescript
   * const fromHex = BufferPolyfill.fromBuffer('deadbeef', 'hex');
   * const fromBase64 = BufferPolyfill.fromBuffer('SGVsbG8=', 'base64');
   * const fromArray = BufferPolyfill.fromBuffer([1, 2, 3, 4]);
   * ```
   */
  static fromBuffer(data: string | Uint8Array | ArrayBuffer | number[], encoding?: string): BufferPolyfill {
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

  /**
   * Creates a BufferPolyfill from a hexadecimal string.
   * Ignores non-hex characters in the input.
   * 
   * @param hex - Hexadecimal string (may include '0x' prefix)
   * @returns New BufferPolyfill with decoded bytes
   */
  static fromHex(hex: string): BufferPolyfill {
    const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
    }
    return new BufferPolyfill(bytes);
  }

  /**
   * Creates a BufferPolyfill from a base64-encoded string.
   * Uses browser's native atob() for decoding.
   * 
   * @param base64 - Base64-encoded string
   * @returns New BufferPolyfill with decoded bytes
   */
  static fromBase64(base64: string): BufferPolyfill {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new BufferPolyfill(bytes);
  }

  /**
   * Converts buffer contents to a string.
   * 
   * @param encoding - Output encoding: 'hex', 'base64', or 'utf8' (default)
   * @returns Encoded string representation
   * 
   * @example
   * ```typescript
   * const buf = BufferPolyfill.fromBuffer([0xde, 0xad, 0xbe, 0xef]);
   * console.log(buf.toString('hex'));    // 'deadbeef'
   * console.log(buf.toString('base64')); // '3q2+7w=='
   * ```
   */
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

  /**
   * Compare this buffer to another buffer/typed array for byte equality.
   * Matches Node.js Buffer#equals() behavior.
   */
  equals(other: unknown): boolean {
    if (other === this) return true;
    if (!(other instanceof Uint8Array)) return false;
    if (other.byteLength !== this.byteLength) return false;
    for (let i = 0; i < this.byteLength; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }
}

/**
 * Automatically install Buffer polyfill as global if not present.
 * This allows code expecting Node.js-style Buffer to work in browsers.
 */
if (typeof globalThis.Buffer === 'undefined') {
  /**
   * BufferWrapper provides Node.js-compatible Buffer.from() signature.
   * Handles various overload patterns used by libraries.
   */
  const BufferWrapper = class extends BufferPolyfill {
    /**
     * Creates a Buffer from various input types.
     * Matches Node.js Buffer.from() signature.
     * 
     * @param data - Input data to convert
     * @param encodingOrOffset - Encoding string or byte offset
     * @param length - Length for slice operations
     * @returns New BufferPolyfill instance
     */
    static from(data: any, encodingOrOffset?: any, length?: any): BufferPolyfill {
      // If called with string and encoding, use fromBuffer
      if (typeof data === 'string' && typeof encodingOrOffset === 'string') {
        return BufferPolyfill.fromBuffer(data, encodingOrOffset);
      }
      // If called with Uint8Array or ArrayBuffer
      if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        return new BufferPolyfill(data);
      }
      // If called with array
      if (Array.isArray(data)) {
        return new BufferPolyfill(new Uint8Array(data));
      }
      // Default: try to use parent Uint8Array.from
      return new BufferPolyfill(Uint8Array.from(data, encodingOrOffset, length));
    }

    /**
     * Node.js-compatible Buffer.isBuffer().
     */
    static isBuffer(value: unknown): value is BufferPolyfill {
      return value instanceof Uint8Array;
    }
  };

  (globalThis as any).Buffer = BufferWrapper;
}

/**
 * Default export for direct import usage.
 * Most code should use the global Buffer installed automatically.
 */
export default BufferPolyfill;
