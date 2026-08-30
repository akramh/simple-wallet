import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const packageLock = JSON.parse(
  fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const compatibleSwcVersion = '1.15.4';

test('extension build pins the SWC toolchain used by top-level-await', () => {
  assert.equal(packageJson.devDependencies['@swc/core'], compatibleSwcVersion);
  assert.equal(packageJson.devDependencies['@swc/wasm'], compatibleSwcVersion);
  assert.equal(
    packageLock.packages['node_modules/@swc/core'].version,
    compatibleSwcVersion,
  );
  assert.equal(
    packageLock.packages['node_modules/@swc/wasm'].version,
    compatibleSwcVersion,
  );
});
