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

### Reverted: `enableFreeze(true)` (2026-04-26)

The Phase 1 freeze opt-in had to be backed out. On Expo Go SDK 54 with Fabric
+ asyncRoutes, `react-native-screens` `NativeStackView` dispatches a setState
from an Animated event listener during the freeze→unfreeze transition cycle.
React 19 then logs *"Can't perform a React state update on a component that
hasn't mounted yet"* with `AuthLayout` / `TabsLayout` in the trace, even
though both are bare render-only components. The error is cosmetic in this
codebase but spams the dev log enough to drown real signal.

`enableScreens(true)` stays (it's the SDK 54 default — keeping the explicit
call is just defensive). `asyncRoutes` and `newArchEnabled` stay; they are
the bigger Phase 1 wins and are not implicated in this specific listener
race. Re-introduce the freeze when `react-native-screens` upstream guards
the NativeStackView listener with a mounted-check, or behind a runtime
toggle once a device session confirms a measurable tab-switch delta.

---

## Phase 2 — Render hygiene

Captured 2026-04-26.

### Changes

- **Send screen** ([app/send.tsx](../app/send.tsx))
  - Added `useDebouncedValue<T>` hook
    ([hooks/useDebouncedValue.ts](../hooks/useDebouncedValue.ts)) and
    rewired the gas-estimation effect to debounce `recipient` and `amount`
    instead of debouncing the callback with a per-keystroke `setTimeout`.
    Same 500 ms window, but the closure no longer rebuilds per keystroke
    and the effect dependency graph is smaller.
  - Switched from the broad `useSendScreenSelector` (which dragged the
    full `prices: Record<string, number>` map through) to the narrow
    `usePrice(symbol)` selector for the active token's price. Background
    price ticks for unrelated tokens no longer re-render Send.
- **Manage Tokens** ([app/manage-tokens.tsx](../app/manage-tokens.tsx))
  - Replaced the broad `useWalletStore()` destructure with a `useShallow`
    selector picking only the seven fields the screen needs.
  - Extracted the row body into a top-level `TokenRow` wrapped with
    `React.memo` — search-keystroke renders no longer re-render every
    row.
  - Pulled `filteredBalances` into `useMemo`, and the `renderItem` /
    `keyExtractor` into stable `useCallback`s. FlatList row props are now
    reference-equal across keystrokes when the underlying balance is
    unchanged.
  - Tuned FlatList virtualization with `removeClippedSubviews`,
    `initialNumToRender={12}`, `windowSize={5}`.
- **Wallet tab** ([app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx))
  - Memoized the local `TokenRow`. Threaded the row's `item` through props
    so the parent can keep a single stable `onPress(item)` callback, which
    lets `memo`'s default shallow compare actually skip work.
  - `visibleBalances` now `useMemo`'d; `renderItem` and `keyExtractor`
    via `useCallback`.
- **Account / Wallet management** ([app/account-manage.tsx](../app/account-manage.tsx),
  [app/wallet-manage.tsx](../app/wallet-manage.tsx))
  - `useShallow` selectors instead of broad `useWalletStore()` destructure.
  - Stable `renderItem` / `keyExtractor` via `useCallback`. Lists are
    small (≤ 10 typical), so the row component is left inline rather than
    paying for a separate `memo` wrapper.
- **Store** ([store/selectors.ts](../store/selectors.ts),
  [store/index.ts](../store/index.ts))
  - Added per-token narrow selectors: `useBalance(symbol)` and
    `usePrice(symbol)`. Documented that `useSendScreenSelector` no longer
    carries the prices map.
- **Tests** ([__tests__/send-screen.test.tsx](../__tests__/send-screen.test.tsx))
  - Mock for `../store` updated to include `usePrice`. No new tests; the
    refactor is a re-render-shape change with no API surface impact.

### Bundle size delta

| Platform | Hermes .hbc raw | Hermes .hbc gzipped | vs. Phase 1 |
| --- | --- | --- | --- |
| iOS | 11,624,048 B | 4,829,584 B | +3.9 KB raw / +2.2 KB gzipped (≈ noise) |
| Android | 11,623,373 B | 4,829,059 B | +4.6 KB raw / +3.4 KB gzipped (≈ noise) |

Bundle size moves are within noise. Phase 2 wins are entirely runtime —
fewer renders per store tick, fewer closures created per keystroke, and
fewer FlatList row reconciliations per scroll.

### Verification

- `npm run typecheck` clean.
- `npm test` — 4 suites / 25 tests fail. Identical to Phase 1 baseline
  (pre-existing `@ton/ton` axios fetch-adapter clash); the new send-screen
  mock keeps that test passing.
- `expo export` succeeded for both platforms; `"lazy"` still in the
  bytecode, confirming asyncRoutes is still in effect.

### What still needs a device to confirm

- p95 keystroke → render in the Send amount field. Capture a React DevTools
  Profiler trace while typing and look at the Send screen wrapper render
  count vs. the typed-character count. Target: render count ≈ 1 per
  keystroke for the input field, near-zero for unrelated rows.
- Manage-Tokens search-input typing should now leave inactive rows
  un-rendered. Watch the Profiler "what rendered and why" view.
- Wallet tab should not re-render TokenRow rows on price ticks unless that
  specific token's price changed. Force a price refresh and observe.

### Deliberately deferred

- **Full split of [send.tsx](../app/send.tsx) into per-field
  subcomponents** (`<AmountField>`, `<RecipientField>`, `<GasSummary>`,
  `<TokenPicker>`). This was on the original plan but is a 1000+ LOC
  refactor with high regression risk in a flow that handles signing.
  Should land on its own with focused testing. The narrow-subscription
  + debounced-input changes here capture most of the perceived-speed win
  without touching the form structure.
- **`@shopify/flash-list` migration**. New native dep + different
  reconciliation semantics. Land it after the device session confirms
  Phase 1 + Phase 2 actually feel better; if so, FlashList is mostly
  upside on long lists. If it adds incompatibilities, it's avoidable.
