import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { upsertEnvContent, upsertEnvFile } from '../dist/env-file.js';

// ---------------------------------------------------------------------------
// upsertEnvContent (pure)
// ---------------------------------------------------------------------------

test('updates an existing assignment in place, preserving everything else', () => {
  const content = [
    '# My env file',
    '',
    'OTHER_VAR=untouched',
    'ALCHEMY_API_KEY=old-value',
    '# trailing comment',
    ''
  ].join('\n');

  const result = upsertEnvContent(content, { ALCHEMY_API_KEY: 'new-value' });

  assert.equal(
    result,
    ['# My env file', '', 'OTHER_VAR=untouched', 'ALCHEMY_API_KEY=new-value', '# trailing comment', ''].join('\n')
  );
});

test('preserves an export prefix and leading whitespace', () => {
  const result = upsertEnvContent('  export MY_KEY=old\n', { MY_KEY: 'new' });
  assert.equal(result, '  export MY_KEY=new\n');
});

test('preserves CRLF line endings', () => {
  const result = upsertEnvContent('A=1\r\nMY_KEY=old\r\n', { MY_KEY: 'new' });
  assert.equal(result, 'A=1\r\nMY_KEY=new\r\n');
});

test('appends missing keys under a marker comment', () => {
  const result = upsertEnvContent('EXISTING=1\n', { NEW_KEY: 'abc' });
  assert.equal(result, 'EXISTING=1\n\n# Added by Simple Wallet setup\nNEW_KEY=abc\n');
});

test('creates content from an empty file', () => {
  const result = upsertEnvContent('', { A: '1', B: '2' });
  assert.equal(result, '# Added by Simple Wallet setup\nA=1\nB=2\n');
});

test('only the first definition is updated; later duplicates are untouched', () => {
  const result = upsertEnvContent('MY_KEY=first\nMY_KEY=second\n', { MY_KEY: 'new' });
  assert.equal(result, 'MY_KEY=new\nMY_KEY=second\n');
});

test('does not touch keys that merely share a prefix', () => {
  const result = upsertEnvContent('MY_KEY_EXTRA=keep\n', { MY_KEY: 'new' });
  assert.equal(result, 'MY_KEY_EXTRA=keep\n\n# Added by Simple Wallet setup\nMY_KEY=new\n');
});

test('is idempotent (double apply is a fixpoint)', () => {
  const vars = { ALCHEMY_API_KEY: 'k1', VITE_ALCHEMY_API_KEY: 'k1' };
  const once = upsertEnvContent('# header\nOTHER=1\n', vars);
  const twice = upsertEnvContent(once, vars);
  assert.equal(once, twice);
});

test('updates multiple vars in one pass', () => {
  const content = 'ALCHEMY_API_KEY=\nVITE_ALCHEMY_API_KEY=\nEXPO_PUBLIC_ALCHEMY_API_KEY=\n';
  const result = upsertEnvContent(content, {
    ALCHEMY_API_KEY: 'k',
    VITE_ALCHEMY_API_KEY: 'k',
    EXPO_PUBLIC_ALCHEMY_API_KEY: 'k'
  });
  assert.equal(result, 'ALCHEMY_API_KEY=k\nVITE_ALCHEMY_API_KEY=k\nEXPO_PUBLIC_ALCHEMY_API_KEY=k\n');
});

// ---------------------------------------------------------------------------
// upsertEnvFile (fs)
// ---------------------------------------------------------------------------

test('writes a new file with mode 0600 and updates an existing one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-file-test-'));
  const file = path.join(dir, '.env');
  try {
    upsertEnvFile(file, { MY_KEY: 'v1' });
    assert.ok(fs.readFileSync(file, 'utf8').includes('MY_KEY=v1'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    upsertEnvFile(file, { MY_KEY: 'v2' });
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('MY_KEY=v2'));
    assert.ok(!content.includes('v1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
