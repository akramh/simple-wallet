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

// react-native-screens: native screens are on by default for iOS/Android in
// SDK 54, so `enableScreens(true)` is just defensive/explicit.
//
// `enableFreeze(true)` was tried as a Phase 1 win (off-screen stacks pause
// re-rendering) but interacts badly with React 19 + Fabric + asyncRoutes:
// `react-native-screens` `NativeStackView` dispatches a setState from an
// Animated event listener during the freeze→unfreeze transition, which
// React flags as "state update on a component that hasn't mounted yet" and
// throws an error in dev (cosmetic, but it spams the log). Until the
// upstream library guards that listener with a mounted-check, leave freeze
// off — we still get the bulk of the Phase 1 win from `asyncRoutes`.
import { enableScreens } from 'react-native-screens';
enableScreens(true);
perfMark('screens:enabled');

// Apply security network guard (blocks unauthorized connections)
// Note: We access the source file directly, assuming Metro resolves shared code correctly via config
import { applyNetworkGuard } from '../src/utils/network-guard';
applyNetworkGuard();

// Register background tasks (side-effect: defines task)
import './services/BackgroundNotificationService';

// Now load the rest of the app via expo-router
import 'expo-router/entry';
perfMark('expoRouterEntry:loaded');
