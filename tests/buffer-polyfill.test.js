/**
 * @fileoverview Tests for buffer polyfill installation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('buffer-polyfill installs buffer shim when global Buffer is missing', async () => {
  const originalBuffer = globalThis.Buffer;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');

  if (descriptor && descriptor.writable === false) {
    // Environment does not allow replacing Buffer; skip without failing.
    assert.ok(true);
    return;
  }

  globalThis.Buffer = undefined;

  await import('../dist/buffer-polyfill.js');

  const shimBuffer = globalThis.Buffer;
  assert.ok(shimBuffer, 'Buffer should be installed');

  const source = shimBuffer.alloc(4);
  const target = shimBuffer.alloc(4);
  source.copy(target);
  assert.ok(shimBuffer.isBuffer(target), 'target should be a Buffer');

  globalThis.Buffer = originalBuffer;
});
