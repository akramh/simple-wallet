# Mobile Wallet — Phase Results

Deltas relative to [baseline.md](./baseline.md). Each phase appends a section
here with the after numbers and links back to the baseline rows.

---

## Phase 1 — Architecture flips

Captured 2026-04-24 from `claude/serene-colden-f40bdf`, after commit
`<phase-1-sha>` (set at commit time).

### Changes

- [mobile-wallet/app.json](../app.json) — `newArchEnabled: true` (Fabric +
  TurboModules + Bridgeless on the next native rebuild) and
  `extra.router.asyncRoutes = { ios: true, android: true, default: false }`
  to opt into expo-router's React.lazy-based per-screen module loading.
- [mobile-wallet/index.js](../index.js) — added `enableScreens(true)` and
  `enableFreeze(true)` from `react-native-screens` after the crypto polyfills
  and before `expo-router/entry`. `enableScreens` is the default for
  iOS/Android so this is mostly explicit; `enableFreeze` is the meaningful
  win — off-screen stacks pause re-rendering.

### Bundle size delta

| Platform | Hermes .hbc raw | Hermes .hbc gzipped | vs. Phase 0 |
| --- | --- | --- | --- |
| iOS | 11,620,158 B | 4,827,359 B | +186 B raw / -129 B gzipped (≈ noise) |
| Android | 11,618,746 B | 4,825,617 B | -455 B raw / +1,671 B gzipped (≈ noise) |

Bundle-size deltas are within noise — expected. The win from Phase 1 is at
**runtime**, not build time:

- `newArchEnabled: true` only affects the native binary (Fabric/TurboModules
  initialization), which `expo export` doesn't touch.
- `enableFreeze(true)` is a few bytes of extra JS.
- `asyncRoutes: true` switches expo-router from synchronous `require()` to
  `React.lazy(...)` per route. Metro still emits a single Hermes bundle, but
  individual screen modules now defer their first execution until first
  navigation. Non-trivial perceived win without any bundle-split machinery.

### Verification

- `[perf]` instrument confirms `screensFreeze:enabled` mark fires after
  `cryptoPolyfill:loaded` and before `expoRouterEntry:loaded` (load order
  preserved per CLAUDE.md).
- `strings dist-ios/.../*.hbc | grep "lazy"` → match present;
  `EXPO_ROUTER_IMPORT_MODE` is **not** in the bytecode (babel inlined it
  correctly at transform time).
- `npm run typecheck` clean.
- `npm test` — 4 suites / 25 tests fail. Same root cause as Phase 0 (the
  `@ton/ton` axios fetch-adapter clash). Spawned as a side task. Not
  caused by Phase 1.
- `expo export` succeeded for both platforms.

### What still needs a device to confirm

- Cold-start delta on iPhone 13 / Pixel 4a — we expect 200–400 ms savings
  from `asyncRoutes` deferring screen module init plus Fabric reducing bridge
  serialization. Capture against the `[perf]` table in
  [baseline.md](./baseline.md).
- Tab-switch frame drops should hit 0 with `enableFreeze(true)` in place.
- Confirm New Architecture is actually active at runtime
  (`global.RN$Bridgeless === true` or check `console.log` in dev). This
  requires `expo prebuild --clean` and a fresh native build.

### Risks / things to watch on first device test

- Fabric is enabled by default in SDK 54 once `newArchEnabled: true`, but
  third-party native modules occasionally lag behind. If a module crashes on
  first launch under New Arch, check whether it ships Fabric-compatible
  bindings; most do in this SDK.
- `asyncRoutes: true` makes the *first* navigation to each screen pass through
  a Suspense boundary. With Hermes (single bundle), the lazy chunk is already
  in memory so Suspense resolves on the next microtask — perceived flash
  should be < 1 frame. If it's visible, switch to a per-platform
  `asyncRoutes` config that keeps the initial route eager.
- `enableFreeze(true)` can mask state-update bugs in components that assume
  they re-render every tick. None expected in this codebase, but worth eyeing
  the activity feed (the only screen with constant timer-driven updates).
