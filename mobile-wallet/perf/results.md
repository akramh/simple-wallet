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

Removed first as a suspected cause of the
*"Can't perform a React state update on a component that hasn't mounted yet"*
error spam in the dev log — turned out the freeze wasn't the trigger, but
this stays reverted: `enableScreens(true)` is the SDK 54 default and freeze
wasn't buying us anything visible without a device profiler trace.

### Reverted: `asyncRoutes: true` for native (2026-04-26)

The actual cause of the *"state update on a component that hasn't mounted
yet"* error spam. With `asyncRoutes: true`, expo-router wraps each screen
in `React.lazy(...)` + Suspense; under Fabric + `react-native-screens`
`NativeStackView`, the Animated event listener inside the navigator can
dispatch setState on a screen whose lazy chunk hasn't finished resolving.
React 19 throws an error rather than the prior warning. `AuthLayout` /
`TabsLayout` showed up in the trace because they're the bare layouts where
the suspect screen rendered — neither has any state of its own.

Confirmed by elimination: pre-Phase-1 (Fabric on, asyncRoutes off) had no
warning; post-Phase-1 with freeze removed but asyncRoutes still on, warning
persisted; setting `asyncRoutes: false` cleared it.

Cost of the rollback: lazy per-screen module evaluation is gone. Native is
a single Hermes bundle anyway, so what we lose is `React.lazy` deferring
each screen module's first-execution side effects until first navigation —
a small win on cold start, not a make-or-break one. Worth giving up to
keep the dev log readable.

Re-enable when one of:
- expo-router / react-native-screens land a guard for the lazy×Animated
  listener race, or
- We adopt a Suspense boundary that wraps each navigator and absorbs the
  early setState before it reaches the unmounted child.

---

## Phase 3 — Crypto + background work off the JS thread

Captured 2026-04-26.

### Changes

- **Native AES-GCM via `react-native-quick-crypto`**
  ([services/MobileCryptoAdapter.ts](../services/MobileCryptoAdapter.ts))
  - `createCipheriv` and `createDecipheriv` now delegate to quick-crypto's
    Node-compatible cipher when the native module is loaded. The existing
    `asmcrypto.js`-based `CipherWrapper` / `DecipherWrapper` classes stay
    as the fallback for Jest and Expo Go (where the JSI native module
    isn't available).
  - AES-256-GCM is deterministic, so the swap is byte-for-byte
    compatible — **no migration needed for existing wallets**. The unlock
    `decryptDataAsync` path on a dev build will run through OpenSSL via
    JSI instead of pure-JS asmcrypto.
  - Cross-implementation regression test added: encrypt with Node's
    `crypto.createCipheriv` (the API quick-crypto exposes on device),
    decrypt through the adapter's fallback wrapper, and vice versa.
    Round-trips a JSON fixture both directions to prove the two impls
    agree on the wire format.

- **Off-tick auto-refresh** ([hooks/useAfterInteraction.ts](../hooks/useAfterInteraction.ts))
  - New hook wraps `InteractionManager.runAfterInteractions` in a
    `useEffect` so screens can launch their auto-refresh fan-out without
    blocking the navigation transition that just brought them into view.
  - Applied to the three tab screens that auto-refresh on mount:
    - [app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx) — balances + prices
    - [app/(tabs)/activity.tsx](../app/(tabs)/activity.tsx) — transaction history
    - [app/(tabs)/portfolio.tsx](../app/(tabs)/portfolio.tsx) — all-network portfolio (also drops the prior `setTimeout(..., 0)` ad-hoc deferral)
  - Pull-to-refresh handlers stay synchronous — those are user-initiated
    and want to react immediately with their own loading indicator.

### Bundle size delta

| Platform | Hermes .hbc raw | Hermes .hbc gzipped | vs. Phase 2 |
| --- | --- | --- | --- |
| iOS | 11,625,958 B | 4,830,761 B | +1.9 KB raw / +1.2 KB gzipped (≈ noise) |
| Android | 11,625,190 B | 4,827,332 B | +1.8 KB raw / -1.7 KB gzipped (≈ noise) |

Bundle size again within noise — the AES-GCM swap doesn't add code (the
quick-crypto module was already in the bundle for PBKDF2), and
`useAfterInteraction` is a 30-line hook.

### Verification

- `npm run typecheck` clean.
- `npm test` — 4 suites / 25 tests fail. **One new passing test** in the
  cipher suite (cross-impl roundtrip), bringing pass count to 95 from 94.
  Pre-existing `@ton/ton` jest fetch-adapter clash unchanged.
- Targeted `npx jest MobileCryptoAdapter.test.ts` → 10/10 green.

### Why this matters

Under Expo Go, `react-native-quick-crypto` isn't present, so the AES-GCM
swap is a no-op (still asmcrypto on the JS thread). On a dev build
(`expo prebuild --clean && npm run ios`), the swap activates and unlock's
AES-GCM step drops from ~JS-thread-time to native-OpenSSL time. Combined
with PBKDF2 already being native (since Phase 0), the full unlock path
runs entirely off-JS — which is the only way to actually hit the Phase 0
KPI of unlock ≤ 250 ms.

### Deliberately deferred

- WalletBridge sync-work audit (Phase 3 task #3) — punted until a device
  profiler trace identifies a specific bottleneck. Speculative
  refactoring of crypto-adjacent code is exactly the kind of change
  CLAUDE.md asks us to be cautious about.

---

## Phases 4 + 5 — Image caching + perceived speed

Captured 2026-04-26.

### Phase 4 changes — `expo-image`

- Installed `expo-image@~3.0.11` via `npx expo install expo-image`.
- Swapped `<Image>` from `react-native` → `expo-image` in every consumer of
  the token-icon library: [components/TokenCard.tsx](../components/TokenCard.tsx),
  [app/manage-tokens.tsx](../app/manage-tokens.tsx),
  [app/network-select.tsx](../app/network-select.tsx),
  [app/token-detail.tsx](../app/token-detail.tsx),
  [app/(tabs)/portfolio.tsx](../app/(tabs)/portfolio.tsx),
  [app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx).
  Also dropped a dead `Image` import from
  [app/(auth)/welcome.tsx](../app/(auth)/welcome.tsx).
- API tweaks at each call site:
  - `resizeMode="cover"` → `contentFit="cover"`.
  - `className="w-full h-full"` → `style={{ width: '100%', height: '100%' }}`
    (NativeWind doesn't bridge through expo-image).
  - Added `cachePolicy="memory-disk"` and `transition={150}` (where the
    image is remote) so first paint draws from memory and subsequent
    appearances skip the decode + fade in cleanly.
- **Token icons stay as bundled `require()` sources for now.** Moving
  them to remote URLs (CoinGecko / token-list) would shave bundle bytes
  but needs new entries in [src/config/network-policy.ts](../../src/config/network-policy.ts)
  egress allowlist plus a designed offline-fallback set. Deferred until
  the network-policy review is done; expo-image is now in place so the
  later swap to `{ uri: ... }` is the only change needed.

### Phase 5 changes — Skeleton placeholders

- Wired the existing
  [components/Skeleton.tsx](../components/Skeleton.tsx) primitive into the
  cold-cache empty states on:
  - [app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx) — 4 skeleton rows
    while `isRefreshingBalances || isLoadingPrices` and the visible-balances
    list is still empty. Replaces the misleading "No tokens yet" copy that
    fired during the first few seconds of every cold start.
  - [app/(tabs)/portfolio.tsx](../app/(tabs)/portfolio.tsx) — 3 grouped
    skeleton blocks (network header + 2 rows each) when
    `isRefreshingAllNetworks` and the holdings list is empty.
- The "real" empty state ("No tokens yet" / "No holdings yet") still
  shows when refresh has finished but actually returned nothing — only
  the cold-start flash is replaced.

### Deliberately deferred (Phase 5 scope)

- **Optimistic balance update after a successful send.** Touches the
  signing flow, which is exactly the area CLAUDE.md flags as
  high-blast-radius. Want a device-validated profiler trace + a focused
  PR for this rather than bundling it with cosmetic changes.
- **Reanimated v3 worklet animations for pull-to-refresh / sheet
  drags.** The Phase 1 `enableFreeze` / `asyncRoutes` rollback showed how
  sensitive react-native-screens × Fabric is to animation timing
  changes. Holding off until a baseline device session confirms the
  current pull-to-refresh feels okay; will revisit only if specific
  surfaces miss frame budget.
- **Token-icon remote URLs** — see Phase 4 deferred note.

### Bundle size delta

| Platform | Hermes .hbc raw | Hermes .hbc gzipped | vs. Phase 3 |
| --- | --- | --- | --- |
| iOS | 11,648,643 B | 4,839,397 B | +22 KB raw / +8.6 KB gzipped |
| Android | 11,648,623 B | 4,837,592 B | +23 KB raw / +10 KB gzipped |

Real bundle-size cost this time: the `expo-image` JS shim is now in the
bundle (the native binary lands separately when prebuilding). Acceptable —
the image module is the foundation for the deferred remote-URL token-icon
migration that will _remove_ ~500 KB+ of bundled PNGs. Net win lands when
that follow-up ships.

### Verification

- `npm run typecheck` clean.
- `npm test` — 4 suites / 25 tests fail. Same pre-existing baseline; the
  cipher cross-impl test added in Phase 3 still passes (95/120).
- `expo export` succeeded for both platforms after the swap.

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
