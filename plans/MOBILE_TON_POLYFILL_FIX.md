# Mobile Wallet TON Polyfill Fix - Handoff Document

## Current Error

```
ERROR  [Error: Offset + Lenght = 8480 is out of bounds]
```

When loading `@ton/ton`, the base64 decoding returns wrong buffer size (1060 bytes instead of 736).

## What Changed (TON Branch vs Main)

### Original (main branch - working):
```javascript
// crypto-polyfill.js
import { Buffer } from 'buffer';  // Standard buffer package

// metro.config.js
'buffer': path.resolve(projectRoot, 'node_modules/buffer'),
```

The standard `buffer` package uses `base64-js` (pure JavaScript) for base64 operations.

### TON changes (broken):
```javascript
// crypto-polyfill.js
import { Buffer } from '@craftzdog/react-native-buffer';  // Changed

// metro.config.js
'buffer': path.resolve(projectRoot, 'node_modules/@craftzdog/react-native-buffer'),
```

### Why the change was made:
`@ton/core` uses `Buffer.copy()` which doesn't exist in the standard `buffer` package. The `@craftzdog/react-native-buffer` provides the full Node.js Buffer API.

### Why it broke:
`@craftzdog/react-native-buffer` uses `react-native-quick-base64` (a native JSI module) for base64 in React Native:

```javascript
// @craftzdog/react-native-buffer/index.js line 16
const base64 = isReactNative ? require('react-native-quick-base64') : require('base64-js')
```

**The native `react-native-quick-base64` module's base64 decoding is returning incorrect data.**

## The Simple Fix

Stub `react-native-quick-base64` to re-export `base64-js` (pure JS). This way:
- `@craftzdog/react-native-buffer` still provides `Buffer.copy()` for TON
- But uses reliable pure-JS `base64-js` instead of the broken native module

### Step 1: Create stub file

Create `/mobile-wallet/stubs/react-native-quick-base64.js`:

```javascript
/**
 * Stub for react-native-quick-base64 that uses base64-js instead.
 *
 * The native react-native-quick-base64 module has issues with base64 decoding
 * that cause @ton/core to fail with "Offset + Length is out of bounds" errors.
 *
 * This stub re-exports base64-js which is pure JavaScript and works correctly.
 */
'use strict';

const base64js = require('base64-js');

// Re-export base64-js functions with the same API
module.exports = {
  byteLength: base64js.byteLength,
  toByteArray: base64js.toByteArray,
  fromByteArray: base64js.fromByteArray,

  // These are extras that react-native-quick-base64 provides
  // but @craftzdog/react-native-buffer only uses toByteArray/fromByteArray
  btoa: (str) => {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i);
    }
    return base64js.fromByteArray(bytes);
  },

  atob: (b64) => {
    const bytes = base64js.toByteArray(b64);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  },

  shim: () => {
    global.btoa = module.exports.btoa;
    global.atob = module.exports.atob;
  },

  getNative: () => ({
    base64FromArrayBuffer: null,
    base64ToArrayBuffer: null,
  }),

  trimBase64Padding: (str) => str.replace(/[.=]{1,2}$/, ''),
};
```

### Step 2: Update metro.config.js

The stub for `react-native-quick-base64` is already in `metro.config.js` (lines 83-90), but it points to `stubs/react-native-fast-pbkdf2.js` which is wrong. Update to:

```javascript
// Stub react-native-quick-base64 with pure JS base64-js
// The native module has issues with base64 decoding
if (moduleName === 'react-native-quick-base64') {
  return {
    filePath: path.resolve(projectRoot, 'stubs/react-native-quick-base64.js'),
    type: 'sourceFile',
  };
}
```

Also add to `extraNodeModules`:
```javascript
'react-native-quick-base64': path.resolve(projectRoot, 'stubs/react-native-quick-base64.js'),
```

### Step 3: Remove base64 polyfills from crypto-polyfill.js

The base64 polyfill code we added (lines 91-146) is no longer needed since we're stubbing at the module level. Remove or keep as fallback.

## Files to Modify

1. **Create `/mobile-wallet/stubs/react-native-quick-base64.js`** - New stub file
2. **Update `/mobile-wallet/metro.config.js`** - Add stub resolution for `react-native-quick-base64`
3. **Optionally clean `/mobile-wallet/services/crypto-polyfill.js`** - Remove base64 polyfill code if not needed

## Testing

```bash
cd mobile-wallet
rm -rf node_modules/.cache
npx expo start --clear
```

Verify:
- App loads without "Offset + Lenght" error
- Can unlock wallet
- TON network works (balance, send with comment)
- Other networks still work (Ethereum, Solana, XRP)

## Why This Works

1. `@craftzdog/react-native-buffer` tries to `require('react-native-quick-base64')`
2. Metro resolves it to our stub instead
3. Our stub exports `base64-js` functions
4. `base64-js` is pure JavaScript and decodes correctly
5. `Buffer.from(base64, 'base64')` now works correctly
6. `@ton/core` Cell.fromBoc() parses the wallet code successfully

## Alternative: Revert to Standard Buffer

If TON's `Buffer.copy()` requirement can be worked around, revert to:
```javascript
'buffer': path.resolve(projectRoot, 'node_modules/buffer'),
```

But this would require changes to `@ton/core` or our TON integration code.
