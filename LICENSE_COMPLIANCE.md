# License Compliance Guide

This document explains how this project complies with open source licenses, particularly the LGPL-3.0 licensed component.

## License Attribution Locations

### 1. Mobile App (React Native)
**Location:** `mobile-wallet/app/licenses.tsx`

Users can access this by:
1. Opening the app
2. Navigating to **Profile** tab
3. Tapping **About** → Opens the Licenses screen

### 2. Browser Extension
**Location:** `extension/public/licenses.html`

Users can access this by:
1. Opening the extension
2. Clicking **Settings** (gear icon)
3. Clicking **Open Source Licenses** under the "About" section

### 3. Project Documentation
**Location:** `THIRD_PARTY_LICENSES.md` (root directory)

This file contains comprehensive license information for all dependencies.

---

## LGPL-3.0 Compliance

### Component: rpc-websockets v9.3.2

**License:** LGPL-3.0-only
**Author:** Elpheria j.d.o.o.
**Repository:** https://github.com/elpheria/rpc-websockets

### How We Comply:

✅ **Attribution Provided**
- License notices are displayed in all three platforms (mobile app, browser extension, documentation)
- Full LGPL-3.0 license text is included
- Copyright and authorship information is clearly stated

✅ **Dynamic Linking**
- The library is used as a Node.js/npm dependency
- It is dynamically linked at runtime, not statically compiled
- Users can replace the library by modifying package.json and running `npm install`

✅ **Source Code Availability**
- The library's source code is publicly available on GitHub
- Our project documentation references the original repository
- Users can access and modify the library source code

✅ **No Modifications**
- We use the library as-is, without any modifications
- We do not distribute a modified version

✅ **User Freedom to Replace**
- Users can replace the library by:
  ```bash
  npm install rpc-websockets@<different-version>
  ```
- The library is not embedded or obfuscated
- Standard npm dependency management allows replacement

### LGPL vs GPL Differences

The **LGPL (Lesser GPL)** is more permissive than GPL:
- ✅ Allows use in proprietary/commercial software
- ✅ Does not require the entire application to be open source
- ✅ Only requires attribution and the ability to replace the library
- ✅ Dynamic linking (like npm dependencies) is explicitly allowed

---

## Commercial Use

### Is This Project Safe for Commercial Use?

**YES**, with proper attribution:

1. **LGPL-3.0 (rpc-websockets)**: Safe for commercial use when:
   - Attribution is provided ✅ (Done in all platforms)
   - Library is dynamically linked ✅ (npm dependency)
   - Users can replace the library ✅ (npm install)

2. **All Other Dependencies**: Use permissive licenses
   - MIT: 1000+ packages ✅
   - Apache-2.0: 40+ packages ✅
   - ISC: 70+ packages ✅
   - BSD: 50+ packages ✅

### What You Need to Do:

1. **Include license notices** in your distribution:
   - ✅ Mobile app: License screen accessible from Profile → About
   - ✅ Browser extension: Licenses page in Settings → About
   - ✅ Documentation: THIRD_PARTY_LICENSES.md

2. **Do not remove or modify** the license attribution

3. **Optional**: Consider purchasing rpc-websockets Pro if you want to avoid LGPL entirely
   - Contact: info@elpheria.com
   - Website: https://www.elpheria.com/products/rpc-websockets-pro.html

---

## Verification

To verify license compliance for all dependencies:

```bash
# Root project
npx license-checker --summary
npx license-checker --production --json

# Mobile wallet
cd mobile-wallet
npx license-checker --summary
npx license-checker --production --json
```

---

## App Store / Play Store Compliance

### Apple App Store
✅ **Compliant** - License screen is accessible in-app (Profile → About)

### Google Play Store
✅ **Compliant** - License screen is accessible in-app (Profile → About)

### Chrome Web Store
✅ **Compliant** - Licenses page accessible from Settings

Both stores require attribution for LGPL libraries, which we provide through the in-app/in-extension license screens.

---

## Summary

✅ **License compliance is complete**
✅ **Safe for commercial use**
✅ **App store/web store ready**
✅ **No code changes needed**
✅ **All attributions in place**

---

**Last Updated:** December 21, 2025
