/**
 * @fileoverview Minimal `process` and `window` polyfill for browser/extension builds.
 *
 * Some bundled dependencies (e.g. readable-stream) reference `process.browser`,
 * `process.version`, or `process.nextTick` without guarding for a missing global.
 * Chrome extension contexts do not provide `process`, so we install a tiny shim.
 *
 * Additionally, some libraries (e.g. @solana/web3.js, rpc-websockets) reference
 * `window.WebSocket` and `window.crypto` which are not available in service workers.
 * We shim `window` to point to `self` (the service worker global) when needed.
 *
 * This intentionally does not try to fully emulate Node.js or browser window.
 */

// ============================================================================
// Window Shim for Service Workers
// ============================================================================

// Service workers don't have `window`, but some libraries expect it.
// Shim window to point to self (the service worker global scope).
declare const window: typeof globalThis | undefined;
declare const self: typeof globalThis | undefined;

if (typeof window === 'undefined' && typeof self !== 'undefined') {
  (globalThis as any).window = self;
}

// ============================================================================
// Process Shim
// ============================================================================

type ProcessEnv = Record<string, string | undefined>;

function nextTick(callback: (...args: any[]) => void, ...args: any[]): void {
  Promise.resolve().then(() => callback(...args));
}

if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = {
    env: {} as ProcessEnv,
    browser: true,
    version: 'v0.0.0',
    nextTick,
    cwd: () => '/',
  };
} else {
  const processObj = (globalThis as any).process as any;
  if (!processObj.env) processObj.env = {} as ProcessEnv;
  if (typeof processObj.browser === 'undefined') processObj.browser = true;
  if (typeof processObj.version !== 'string') processObj.version = 'v0.0.0';
  if (typeof processObj.nextTick !== 'function') processObj.nextTick = nextTick;
}

export {};

