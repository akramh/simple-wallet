#!/usr/bin/env tsx
/**
 * @fileoverview Regenerates `extension/manifest.json`'s `connect-src` CSP
 * directive from {@link ALLOWED_DOMAINS} in `src/config/network-policy.ts`.
 *
 * Run as a pre-step to `build:extension`. Keeps the manifest CSP and the
 * runtime allowlist in lockstep — previously maintained in two places and
 * prone to drift (e.g. Alchemy hosts were added to the runtime allowlist
 * but not the CSP, causing Chrome to block Solana requests at the browser
 * level before our guard even ran).
 *
 * @usage
 *   tsx scripts/generate-manifest-csp.ts        # rewrites manifest.json in place
 *   tsx scripts/generate-manifest-csp.ts --check # exit non-zero if out of sync
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildConnectSrcDirective } from '../src/config/network-policy.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const manifestPath = resolve(repoRoot, 'extension/manifest.json');

const checkOnly = process.argv.includes('--check');

const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as {
  content_security_policy?: { extension_pages?: string };
};

const currentCsp = manifest.content_security_policy?.extension_pages;
if (!currentCsp) {
  console.error('[gen-csp] manifest has no content_security_policy.extension_pages');
  process.exit(1);
}

// Replace the connect-src clause while preserving script-src/object-src/etc.
const newConnectSrc = buildConnectSrcDirective();
const connectSrcPattern = /connect-src\s+[^;]+/;
if (!connectSrcPattern.test(currentCsp)) {
  console.error('[gen-csp] could not find a connect-src clause to replace');
  process.exit(1);
}
const newCsp = currentCsp.replace(connectSrcPattern, `connect-src ${newConnectSrc}`);

if (newCsp === currentCsp) {
  console.log('[gen-csp] manifest CSP already in sync with network-policy.ts');
  process.exit(0);
}

if (checkOnly) {
  console.error('[gen-csp] manifest CSP is OUT OF SYNC with network-policy.ts.');
  console.error('[gen-csp] Run `npm run gen:manifest` to regenerate.');
  process.exit(1);
}

manifest.content_security_policy!.extension_pages = newCsp;
// Preserve 2-space indentation and trailing newline to match the repo style.
const serialized = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(manifestPath, serialized, 'utf8');
console.log('[gen-csp] regenerated connect-src in extension/manifest.json');
