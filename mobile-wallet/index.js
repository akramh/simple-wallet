/**
 * @file index.js
 * @description Custom app entry point that loads crypto polyfills BEFORE any other modules.
 * 
 * This is critical because @noble/hashes and @scure/bip39 check for globalThis.crypto
 * at module evaluation time. We must set it up before expo-router loads our app.
 */

// MUST be first — captures bootStartedAt at module-eval time. Keeps the perf
// instrument honest: anything imported below this line is included in the
// boot-to-first-mount delta we measure in __DEV__.
import { perfMark } from './utils/perf';
perfMark('index.js:start');

// MUST be next - polyfill crypto before any library checks for it
import './services/crypto-polyfill';
perfMark('cryptoPolyfill:loaded');

// react-native-screens: native screens are on by default for iOS/Android, but
// `enableFreeze(true)` is opt-in. Freezing pauses off-screen stack re-renders —
// the meaningful win for tab nav and modal stacks. Must run before any
// navigator initializes (i.e. before expo-router/entry below).
import { enableScreens, enableFreeze } from 'react-native-screens';
enableScreens(true);
enableFreeze(true);
perfMark('screensFreeze:enabled');

// Apply security network guard (blocks unauthorized connections)
// Note: We access the source file directly, assuming Metro resolves shared code correctly via config
import { applyNetworkGuard } from '../src/utils/network-guard';
applyNetworkGuard();

// Register background tasks (side-effect: defines task)
import './services/BackgroundNotificationService';

// Now load the rest of the app via expo-router
import 'expo-router/entry';
perfMark('expoRouterEntry:loaded');
