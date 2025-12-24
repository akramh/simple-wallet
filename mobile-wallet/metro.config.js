/**
 * @file metro.config.js
 * @description Metro bundler configuration for the Simple Wallet mobile app (Expo).
 *
 * This config is the mobile equivalent of the extension/CLI runtime setup:
 * it ensures React Native can consume the shared wallet core (`../src/*`) and
 * that incompatible Node/WASM dependencies are redirected to pure-JS stubs.
 *
 * @responsibilities
 * - Watch the monorepo workspace so changes in `../src/*` are picked up by Metro
 * - Resolve `@wallet/*` imports to the shared wallet core sources
 * - Strip `.js` extensions in imports so ESM-style paths resolve to `.ts` sources
 * - Stub modules that depend on WebAssembly or Node built-ins (not supported in RN)
 *
 * @security
 * - This file does not handle secrets directly, but it can affect which crypto
 *   implementations are bundled. Keep stubs reviewed and minimal.
 *
 * @notes
 * - Bitcoin + tiny-secp256k1 + bip32 in the shared core rely on WASM/Node patterns;
 *   mobile uses `mobile-wallet/stubs/*` to provide compatible replacements.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the shared wallet code in the parent directory
config.watchFolders = [workspaceRoot];

// Let Metro know where to resolve packages from
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Resolve .js extensions for ESM imports from shared code
// Order matters: .ts/.tsx first so Metro finds the source files
config.resolver.sourceExts = ['ts', 'tsx', 'js', 'jsx', 'json', 'cjs', 'mjs'];

// Handle .js extension in imports pointing to .ts files (ESM compatibility)
// Also stub problematic modules that use WebAssembly
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stub bip32 (depends on tiny-secp256k1 WebAssembly)
  if (moduleName === 'bip32') {
    return {
      filePath: path.resolve(projectRoot, 'stubs/bip32.js'),
      type: 'sourceFile',
    };
  }
  
  // Stub ecpair (depends on tiny-secp256k1 WebAssembly)
  if (moduleName === 'ecpair') {
    return {
      filePath: path.resolve(projectRoot, 'stubs/ecpair.js'),
      type: 'sourceFile',
    };
  }
  
  // Stub tiny-secp256k1 (uses WebAssembly not supported in React Native)
  if (moduleName === 'tiny-secp256k1' || moduleName.includes('tiny-secp256k1')) {
    return {
      filePath: path.resolve(projectRoot, 'stubs/tiny-secp256k1.js'),
      type: 'sourceFile',
    };
  }

  // Stub react-native-fast-pbkdf2 (required by @ton/crypto-primitives)
  // Redirect to our implementation using @noble/hashes
  if (moduleName === 'react-native-fast-pbkdf2') {
    return {
      filePath: path.resolve(projectRoot, 'stubs/react-native-fast-pbkdf2.js'),
      type: 'sourceFile',
    };
  }

  // Stub react-native-quick-base64 with pure JS base64-js
  // The native module returns incorrect data on some devices
  if (moduleName === 'react-native-quick-base64') {
    return {
      filePath: path.resolve(projectRoot, 'stubs/react-native-quick-base64.js'),
      type: 'sourceFile',
    };
  }
  
  // If importing from @wallet or src/, strip .js and try .ts
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const tsModuleName = moduleName.slice(0, -3);
    try {
      return context.resolveRequest(context, tsModuleName, platform);
    } catch {
      // Fall through to default resolution
    }
  }
  
  // Handle @wallet/*.js imports - strip .js extension for TypeScript source
  if (moduleName.startsWith('@wallet/') && moduleName.endsWith('.js')) {
    const tsModuleName = moduleName.slice(0, -3); // Remove .js
    try {
      return context.resolveRequest(context, tsModuleName, platform);
    } catch {
      // Fall through to default resolution
    }
  }
  
  // Default resolution
  return context.resolveRequest(context, moduleName, platform);
};

// Handle the shared src/ folder and Node.js module stubs
config.resolver.extraNodeModules = {
  '@wallet': path.resolve(workspaceRoot, 'src'),
  // Stub Node.js built-in modules for React Native compatibility
  'fs': path.resolve(projectRoot, 'stubs/fs.js'),
  'crypto': path.resolve(projectRoot, 'stubs/crypto.js'),
  'path': path.resolve(projectRoot, 'stubs/path.js'),
  'stream': path.resolve(projectRoot, 'stubs/stream.js'),
  // Node.js polyfills from npm packages
  'events': path.resolve(projectRoot, 'node_modules/events'),
  // Use @craftzdog/react-native-buffer for full Buffer API (includes .copy() needed by @ton/core)
  'buffer': path.resolve(projectRoot, 'node_modules/@craftzdog/react-native-buffer'),
  // Stub packages that use WebAssembly (not supported in React Native)
  'tiny-secp256k1': path.resolve(projectRoot, 'stubs/tiny-secp256k1.js'),
  // Stub for TON crypto dependencies
  'react-native-fast-pbkdf2': path.resolve(projectRoot, 'stubs/react-native-fast-pbkdf2.js'),
  // Stub react-native-quick-base64 with base64-js
  'react-native-quick-base64': path.resolve(projectRoot, 'stubs/react-native-quick-base64.js'),
};

module.exports = withNativeWind(config, { input: './global.css' });
