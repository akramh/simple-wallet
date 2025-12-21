/**
 * @file buffer-polyfill.ts
 * @description Buffer shim installer for browser environments.
 *
 * Ensures a Node.js-compatible Buffer implementation is available in
 * browsers/service workers by wiring up the `buffer` package. This avoids
 * mismatches between different Buffer implementations used by dependencies.
 *
 * @responsibilities
 * - Install a single, consistent Buffer implementation globally
 * - Avoid overriding native Node.js Buffer when already present
 *
 * @compatibility
 * - Works in browsers, web workers, and service workers
 * - Uses native Buffer in Node.js
 */

import { Buffer as BufferShim } from 'buffer';

const existingBuffer = (globalThis as any).Buffer;
const hasBuffer =
  typeof existingBuffer !== 'undefined' &&
  typeof existingBuffer.isBuffer === 'function';

if (!hasBuffer) {
  (globalThis as any).Buffer = BufferShim;
}

export const BufferPolyfill = (globalThis as any).Buffer as typeof BufferShim;
export default BufferPolyfill;
