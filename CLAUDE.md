# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo at a glance

Multi-chain wallet (EVM, Bitcoin, Solana, XRP, TON) with a **shared TypeScript core in `src/`** consumed by three UIs:

- **CLI** — Node entry at `src/index.ts`
- **Chrome extension (MV3)** — `extension/` (popup, sidepanel, MV3 service worker, content/provider scripts), built with Vite
- **Mobile app** — `mobile-wallet/` (Expo + React Native, expo-router, Zustand)

Deeper background: `README.md` and the canonical docs under `docs/`, especially
`docs/architecture.md`, `docs/platforms/extension.md`, and
`docs/platforms/mobile.md`.

## Commands

All commands run from the repo root unless noted.

### Core SDK / CLI (root `package.json`)
- `npm run dev` — run the CLI directly via tsx (`src/index.ts`)
- `npm run build` — `tsc` → `dist/`
- `npm run type-check` — `tsc --noEmit`
- `npm test` — builds, then runs `node --test tests/*.test.js` (uses Node's built-in test runner; no live network — providers/explorers are mocked, prompts stubbed, CLI suppressed via `NODE_ENV=test`)
- Run a single test file: `npm run build && node --test tests/wallet.test.js`
- Run by name: `node --test --test-name-pattern="<regex>" tests/wallet.test.js` (build first)

### Extension (root scripts, Vite config: `vite.config.extension.ts`)
- `npm run build:extension` — production bundle into `dist-extension/`
- `npm run watch:extension` — rebuild on change; reload via `chrome://extensions/`
- After building, load `dist-extension/` as an unpacked extension. Build env vars must be `VITE_`-prefixed. Primary: `VITE_ALCHEMY_API_KEY` (covers EVM RPC for all 9 networks, Solana RPC, and Transfers API for eth/sepolia/base/polygon/arb/opt). `VITE_EXPLORER_API_KEY_<NETWORK>` is still used for Etherscan V2 tx history on avalanche/bsc/linea (not covered by Alchemy Transfers).

### Mobile (`mobile-wallet/`, run from that directory)
- `npm start` / `expo start` — Metro dev server
- `npm run ios` / `npm run android` — Expo prebuild + native run
- `npm test` — Jest (Expo preset + `@testing-library/react-native`); run via `NODE_OPTIONS=--experimental-vm-modules jest`
- Single file: `npm test -- __tests__/walletStore.test.ts`
- Single test: `npm test -- -t "<name pattern>"`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — eslint
- E2E (Detox, iOS sim): `npm run e2e:ios:build` then `npm run e2e:ios:test`

## Architecture (the parts that span files)

### One core, three UIs
Everything chain-related lives in `src/`. The UIs are thin: they pick adapter implementations, build a `Wallet` and a `WalletAppService`, and render. The two SDK entry points are `src/sdk.ts` (Node/CLI) and `src/sdk-browser.ts` (extension/mobile) — they differ only in default adapter wiring.

### `WalletAppService` is the orchestration boundary
[src/app-service.ts](src/app-service.ts) is UI-agnostic: wallet lifecycle (create/import/load/save/delete), token registry (built-in `tokens.json` + per-user `tokens-user.json`), network switching with persistence, portfolio queries, and transaction sending all flow through it. New UI features should call `WalletAppService` rather than reaching into `Wallet` directly.

### Adapter pattern (storage + crypto)
Two interfaces decouple the core from each platform's APIs:

- **`StorageAdapter`** — `FileStorage` / `MemoryStorage` ([src/storage.ts](src/storage.ts)), `ChromeStorageAdapter` ([src/chrome-storage.ts](src/chrome-storage.ts)), and `MobileStorageAdapter` (in `mobile-wallet/services/`, wraps SecureStore + AsyncStorage).
- **`CryptoAdapter`** ([src/crypto-adapter.ts](src/crypto-adapter.ts)) — Node crypto by default; switch to WebCrypto via `setCryptoAdapter(createWebCryptoAdapter())` for the extension; mobile uses `react-native-quick-crypto` (native via JSI; PBKDF2 100k is ~20 ms native vs ~16 s on Hermes).

When adding a chain or feature, prefer reusing these adapters rather than calling Node fs / `chrome.storage` / `expo-secure-store` directly from core.

### Per-chain modules
Each chain is isolated under `src/<chain>/` with the same shape: `address.ts`, `provider.ts`, `explorer.ts`, `transaction.ts`, `types.ts`. Chains: `bitcoin/`, `solana/`, `ethereum/`, `xrp/`, `ton/`. EVM RPC URLs may be a string or array (failover).

### Extension message flow
`extension/popup` ↔ `extension/background/service-worker.ts` (MV3 worker holds wallet state) ↔ `extension/content/{injected.ts,provider.ts}` (EIP-1193 provider injected into pages). Auto-lock after 15 min of inactivity. The service worker is the only place that holds decrypted state — popup/sidepanel re-fetch via messages.

### Mobile bridging and routing
`mobile-wallet/index.js` loads crypto/Buffer polyfills **before** importing `expo-router/entry` — this ordering is load-bearing. Screens live under `mobile-wallet/app/` (file-based routing). State is in `mobile-wallet/store/` (Zustand). `mobile-wallet/services/WalletBridge.ts` adapts `WalletAppService` for the app.

## Documentation rules (apply to changes in `src/`, `extension/`, `mobile-wallet/{services,store,hooks,config}`)

- **Top-of-file docblock** on touched files: `@fileoverview` (core style) or `@file` + `@description` (CLI/extension style). When the file touches session state, storage, crypto, network/RPC, or explorer APIs, also include `@responsibilities` and `@security`.
- **TSDoc on every new/changed exported `class`/`function`/`type`/`interface`**: `@param`, `@returns`, `@throws`, `@async` when applicable. Document invariants and units (timestamp ms vs s, amount units, network key formats).
- **Section dividers** in large logic files: `// ============================================================================`.
- Comment the **why**, invariants, and security constraints — not the what. Don't paraphrase code.

## Testing rules (required after any functional change)

- **Pick the runner by what's under test:**
  - Pure logic (no React Native / no Expo) → root `node:test` (`npm test`, builds first).
  - React Native / Expo modules / UI → mobile Jest with Expo preset + `@testing-library/react-native` (`npm test` from `mobile-wallet/`).
  - User-flow validation → Detox E2E smoke tests under `mobile-wallet/e2e/` — keep them small and stable.
- **Bug fixes require a regression test** that fails before the fix and passes after.
- **New features require at least:** one happy-path test, one failure/edge-case test, and one invariant test when relevant (e.g. lock clears state; network switch resets caches).
- **Determinism is mandatory:** no live RPC/explorer calls (use fixtures/mocks); avoid time-based flake (`jest.useFakeTimers()` or equivalent). [tests/security/network-egress.test.ts](tests/security/network-egress.test.ts) enforces the no-live-network rule across the suite.

## Security guardrails (non-negotiable for any wallet change)

When the diff touches secrets, storage, crypto, or signing, explicitly verify these — and stop and ask if anything is unclear:

- **Mnemonic / private-key material** must never be logged, stored in plaintext, or held in UI state longer than needed. No accidental persistence to `AsyncStorage` / `chrome.storage` / files.
- **Encryption parameters** (AES-256-GCM, PBKDF2 100k iterations, 32-byte salt, 16-byte IV) are load-bearing. Don't change them casually — a migration story is required if you do.
- **Storage placement on mobile** matters: secrets go in `expo-secure-store` (OS Keychain/Keystore), not `AsyncStorage`. Session-only state can use AsyncStorage.
- **Lock/unlock invariant:** locking must clear sensitive in-memory state. The extension service worker is the *only* place that holds decrypted state — popup/sidepanel re-fetch via messages.
- **No live RPC/explorer in tests** — this is both a determinism rule and a security boundary (avoids leaking dev-time addresses/keys to public infra).
- **Address quirks to respect:** Solana addresses are base58 and case-sensitive. Bitcoin supports multiple formats (Legacy, SegWit, Native SegWit). EVM addresses use EIP-55 mixed-case checksums.
- **Env var naming for non-alphanumeric network keys** (e.g. `solana-mainnet`) becomes `EXPLORER_API_KEY_SOLANA_MAINNET` (and `VITE_EXPLORER_API_KEY_SOLANA_MAINNET` for the extension build). Alchemy does NOT use per-network keys — one `ALCHEMY_API_KEY` serves all chains; the hostname (`eth-mainnet.g.alchemy.com`, `solana-mainnet.g.alchemy.com`, etc.) selects the chain.
- **Alchemy Transfers API chain coverage**: `alchemy_getAssetTransfers` supports eth, sepolia, base, polygon, arb, opt only. For avalanche/bsc/linea, the `ExplorerAPI` singleton falls back to Etherscan V2 via the same interface (dispatch lives in `src/explorer-api.ts` `getAllTransactions`).
- **Leaked Helius key in git history**: commit `8dfe258` introduced a Helius key (`<revoked-helius-key>`) in `config.json`; it persists in history. The key has been revoked via the Helius dashboard; config now uses `${ALCHEMY_API_KEY}` substitution.

## Working from existing changes (PR / open branch)

When you're handed a branch with diffs already in flight, before extending it:

1. **Summarize the change at three levels** — one sentence (user-visible outcome), one paragraph (systems touched and why), bullet list (file-by-file).
2. **Categorize the blast radius** — UI-only, business logic (SDK / service layer), storage/session/auth, crypto/signing, network/RPC, build/config, tests. If `src/` is touched, assume multi-platform impact.
3. **Run the security checklist above** against the diff.
4. **Don't introduce unrelated refactors.** Keep scope to the change set and the fix the user asked for.

## Build/test loop after changes

Match the loop to the area touched:

- Touched `src/`: `npm run type-check && npm test`
- Touched `extension/`: `npm run type-check && npm run build:extension` (then reload in `chrome://extensions/`)
- Touched `mobile-wallet/`: from that dir, `npm run typecheck && npm test` (and `expo start` if a UI flow changed)

Shared-core changes have multi-platform blast radius — type-check and test the affected UI surfaces too.
