import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installConsoleRedactor, __resetForTests } from '../dist/utils/redact-logs.js';

function captureConsole(method) {
  const captured = [];
  const original = console[method];
  console[method] = (...args) => {
    captured.push(args);
  };
  return {
    captured,
    restore: () => {
      console[method] = original;
    },
  };
}

test('installConsoleRedactor: ignores empty or too-short secrets', () => {
  __resetForTests();
  const cap = captureConsole('log');
  installConsoleRedactor(undefined);
  installConsoleRedactor('');
  installConsoleRedactor('short'); // 5 chars < 8 min
  console.log('my key is short');
  cap.restore();
  assert.equal(cap.captured[0][0], 'my key is short', 'short secrets must not trigger redaction');
});

test('installConsoleRedactor: redacts string arguments', () => {
  __resetForTests();
  const cap = captureConsole('log');
  installConsoleRedactor('SECRET_KEY_123456');
  console.log('request to https://x.com/?k=SECRET_KEY_123456');
  cap.restore();
  assert.equal(cap.captured[0][0], 'request to https://x.com/?k=<redacted>');
});

test('installConsoleRedactor: redacts Error message and stack', () => {
  __resetForTests();
  const cap = captureConsole('error');
  installConsoleRedactor('TOP_SECRET_ABCD');
  const err = new Error('failed to fetch https://api.example.com/v2/TOP_SECRET_ABCD');
  console.error(err);
  cap.restore();
  const [redactedErr] = cap.captured[0];
  assert.ok(redactedErr instanceof Error);
  assert.ok(!redactedErr.message.includes('TOP_SECRET_ABCD'));
  assert.ok(redactedErr.message.includes('<redacted>'));
});

test('installConsoleRedactor: redacts nested object properties', () => {
  __resetForTests();
  const cap = captureConsole('warn');
  installConsoleRedactor('NESTED_SECRET_X');
  console.warn({
    request: {
      url: 'https://api.example.com/v2/NESTED_SECRET_X',
      body: { passthrough: 'NESTED_SECRET_X in body too' },
    },
    count: 3,
  });
  cap.restore();
  const obj = cap.captured[0][0];
  assert.equal(obj.request.url, 'https://api.example.com/v2/<redacted>');
  assert.equal(obj.request.body.passthrough, '<redacted> in body too');
  assert.equal(obj.count, 3); // non-strings preserved
});

test('installConsoleRedactor: handles multiple secrets', () => {
  __resetForTests();
  const cap = captureConsole('log');
  installConsoleRedactor('FIRST_SECRET_AAAA');
  installConsoleRedactor('SECOND_SECRET_BBBB');
  console.log('FIRST_SECRET_AAAA and SECOND_SECRET_BBBB');
  cap.restore();
  assert.equal(cap.captured[0][0], '<redacted> and <redacted>');
});
