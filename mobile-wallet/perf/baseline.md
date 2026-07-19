# Mobile Wallet — Performance Baseline (Phase 0)

This document is the canonical reference for the **before** numbers we tune
against in Phases 1–7 of the RN performance-tuning plan.

Each phase re-runs the captures below and writes deltas into
`results.md` next to this file. **Do not delete the baseline numbers
once recorded** — phase deltas are only meaningful relative to them.

---

## Capture environment

| Field | Value |
| --- | --- |
| Date captured | _TBD — fill on capture_ |
| Git SHA | _TBD — `git rev-parse HEAD` at capture time_ |
| Branch | `claude/serene-colden-f40bdf` (Phase 0 worktree) |
| Expo SDK | 54.0.30 |
| React Native | 0.81.5 |
| New Architecture | **OFF** (baseline; flipped to ON in Phase 1) |
| Hermes | ON (RN default) |
| iOS device | iPhone 13, iOS 17.x — release build via `npm run ios -- --configuration Release` |
| Android device | Pixel 4a, Android 13 — release build via `npm run android -- --variant=release` |
| Mode | **Production-like release builds.** Dev builds are roughly 2–3× slower; numbers there are useful for relative comparisons but not for KPI sign-off. |

---

## Boot & first interactive

The `utils/perf.ts` module emits `[perf]` lines at fixed milestones. After a
**cold start** (kill the app, then launch from springboard / launcher), filter
device logs for the `[perf]` prefix and copy the summary block.

iOS log capture:
```
xcrun simctl spawn booted log stream --predicate 'eventMessage CONTAINS "[perf]"'
```

Android log capture:
```
adb logcat -s ReactNativeJS:V | grep '\[perf\]'
```

| Mark | iOS (ms) | Android (ms) | Target (Phase 7) |
| --- | --- | --- | --- |
| `index.js:start` | _≈ 0 (anchor)_ | _≈ 0 (anchor)_ | n/a |
| `cryptoPolyfill:loaded` | _TBD_ | _TBD_ | ≤ 50 |
| `expoRouterEntry:loaded` | _TBD_ | _TBD_ | ≤ 400 |
| `rootLayout:moduleEval` | _TBD_ | _TBD_ | ≤ 450 |
| `rootLayout:firstEffect` | _TBD_ | _TBD_ | ≤ 600 |
| `walletStore:initialized` | _TBD_ | _TBD_ | ≤ 800 |
| `rootLayout:isInitialized` (≈ first interactive) | _TBD_ | _TBD_ | ≤ 1000 (iOS) / ≤ 1500 (Android) |

> **Cold start KPI** = delta from `index.js:start` → `rootLayout:isInitialized`.
> Capture the median of 5 cold launches per device. Discard the first launch
> after install (warm caches are not yet populated).

---

## Tab switch

From the wallet tab, tap each other tab in sequence and back. Use Hermes
sampling profiler (Flipper → Hermes → "Start Sampling Profiler") and look at:

| Metric | iOS | Android | Target |
| --- | --- | --- | --- |
| Frames dropped per switch (median) | _TBD_ | _TBD_ | ≤ 1 |
| Off-screen stack re-renders observed | _TBD_ | _TBD_ | 0 (after `enableScreens`) |

---

## Send-screen keystroke → render

Open Send → focus the amount field → type a 6-digit amount steadily over ~1 s.
Profile with React DevTools Profiler in record-on-input mode.

| Metric | iOS | Android | Target |
| --- | --- | --- | --- |
| Mean keystroke → render (ms) | _TBD_ | _TBD_ | ≤ 16 |
| p95 keystroke → render (ms) | _TBD_ | _TBD_ | ≤ 16 |
| `estimateGas` calls per typed amount | _TBD_ | _TBD_ | 1 (debounced; was N) |

---

## Unlock (PBKDF2 + AES-GCM)

From the unlock screen, type the passphrase and submit. The
`MobileCryptoAdapter` already routes PBKDF2 to native via
`react-native-quick-crypto`, but AES-GCM still uses pure-JS `asmcrypto.js`.
The Phase 3 swap targets this delta.

| Metric | iOS | Android | Target |
| --- | --- | --- | --- |
| Submit → unlocked (ms, median of 5) | _TBD_ | _TBD_ | ≤ 250 |
| PBKDF2 portion (ms) | _TBD_ | _TBD_ | ≤ 30 (already native) |
| AES-GCM portion (ms) | _TBD_ | _TBD_ | ≤ 5 (after Phase 3 swap) |

---

## Portfolio refresh (Phase 6 target)

Pull-to-refresh on the portfolio screen with 12 chains enabled. Inspect the
network log on the device (Flipper Network plugin) and count outbound HTTP
calls.

| Metric | Today | Target (Phase 6) |
| --- | --- | --- |
| Cold-cache refresh time (ms) | _TBD (audit reported 3–5 s)_ | ≤ 2000 |
| Warm-cache refresh time (ms) | _TBD_ | ≤ 200 |
| Alchemy HTTP calls per refresh | _TBD (audit reported 12+)_ | ≤ 2 |
| Path used for eth/sepolia/base/polygon/arb/opt transfers | _TBD (verify Alchemy Transfers, not Etherscan V2)_ | Alchemy Transfers |

---

## Bundle size

Captured 2026-04-24 from this worktree (`claude/serene-colden-f40bdf`,
SHA 2c07c20) via:

```
cd mobile-wallet
npx expo export --platform ios     --output-dir dist-ios
npx expo export --platform android --output-dir dist-android
```

Hermes bytecode is what actually ships and what the JS VM parses on cold
start. Gzipped is what gets transferred over update channels (EAS Update).

| Platform | Hermes .hbc raw | Hermes .hbc gzipped | Total dist (incl. assets) |
| --- | --- | --- | --- |
| iOS | **11,619,972 B** (≈ 11.08 MiB) | **4,827,488 B** (≈ 4.60 MiB) | 15 MiB |
| Android | **11,619,201 B** (≈ 11.08 MiB) | **4,823,946 B** (≈ 4.60 MiB) | 15 MiB |

iOS and Android are within 1 KB of each other — the JS bundle is platform-agnostic once compiled to Hermes bytecode.

Phase 1 lazy-route target: ≥ 30 % reduction in **cold-start parsed JS** (not necessarily total bytecode — most of the savings come from deferring non-critical chunks past first interactive). Re-measure after Phase 1 by counting the `index*.hbc` plus any chunks Metro emits for split routes.

Top 5 largest static assets (iOS, identical hashes on Android):

| Bytes | Likely content | Phase 4 action |
| --- | --- | --- |
| 1,307,660 | Probably the largest bundled font (Ionicons / MaterialCommunity full glyph set) | Trim to used glyphs or move to `expo-font` lazy load |
| 423,676 | Token icon PNG | Move to remote URL + `expo-image` cache |
| 389,724 | Token icon PNG | Same |
| 356,840 | Token icon PNG | Same |
| 313,528 | Token icon PNG | Same |

The four large PNGs (~1.5 MiB combined) match the audit finding that 34 token PNGs are bundled at startup — only the 4 biggest are listed here; the long tail of 30+ smaller ones still adds up. Phase 4 moves all of them to `expo-image` with disk cache.

---

## Steady-state RAM

After unlock, sit on the wallet tab idle for 30 s, then on Send for 30 s. Use
Xcode Instruments (Allocations) on iOS and Android Studio Profiler (Memory)
on Android.

| Screen | iOS RSS (MB) | Android RSS (MB) | Target |
| --- | --- | --- | --- |
| Home (idle) | _TBD_ | _TBD_ | ≤ 100 |
| Send (idle) | _TBD_ | _TBD_ | ≤ 110 |

---

## Capture checklist

Use this list when re-running a phase:

- [ ] Release builds for both platforms (not dev — release shows real numbers).
- [ ] Cold start measured 5 times per device, take the median.
- [ ] Hermes sampling profile saved for cold start, send screen, unlock.
- [ ] Network log saved for portfolio refresh, including chain breakdown.
- [ ] RAM snapshot at idle Home and Send.
- [ ] Bundle size from `expo export` for both platforms.
- [ ] Note the git SHA and date in the table at the top of `results.md`.

---

## Notes / caveats

- iOS release builds disable `__DEV__`, so the `[perf]` console lines are
  silent. To capture release-build boot timings, temporarily flip the perf
  module to log unconditionally for the capture session, or attach Xcode and
  read the marks from the `entries` array via the debug console.
- Android release builds have similar `__DEV__` gating. Same workaround.
- `tests/security/network-egress.test.ts` must keep passing across all
  phases — no live RPC/explorer calls in the test suite (mandated by
  `CLAUDE.md`).
