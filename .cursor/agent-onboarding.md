# Simple Wallet — Agent Bootstrap (Mobile-first)

**Repo:** `akramh/simple-wallet`  
**Goal:** Get a coding agent oriented quickly and producing a correct, security-aware plan **without making any code changes**.

---

## 0) Non‑negotiable constraints

1. **Follow repo rules in `.cursor/rules.md` (authoritative).**
2. **No edits of any kind** until explicitly instructed:
   - no code changes, refactors, formatting, commits, branches, PRs
3. **Don’t guess.** If something is unclear, ask precise questions.

---

## 1) What this project is (60-second mental model)

Simple Wallet is a multi-chain crypto wallet with a **shared-core SDK** in `/src` used by three UIs:

1. **Mobile app** — Expo + React Native in `mobile-wallet/`
2. **Chrome extension** — React + MV3 in `extension/`
3. **CLI** — Node.js entry in `src/index.ts`

Core orchestration is via **`WalletAppService`** (`/src/app-service.ts`, referenced in docs).  
Adapters abstract platform differences (storage, crypto) per `ARCHITECTURE.md`.

---

## 2) Entrypoints & commands (start here)

### Mobile

- **Entrypoint:** `mobile-wallet/index.js`
  - Loads crypto polyfills **before** `expo-router/entry` (important invariant)
- **Routes:** `mobile-wallet/app/**` (expo-router file-based routing)
- **Commands:** (from `mobile-wallet/package.json`)
  - Dev: `expo start`
  - Tests: `npm test` (run from `mobile-wallet/`)
  - Typecheck: `npm run typecheck` (run from `mobile-wallet/`)

### Extension

- **UI entry:** `extension/popup/popup.tsx`
- **Build inputs:** see `vite.config.extension.ts` (sidepanel, service worker, content scripts)
- **Commands:** (from root `package.json`)
  - Build: `npm run build:extension`
  - Watch: `npm run watch:extension`
  - Typecheck: `npm run type-check`

### CLI

- **Entry:** `src/index.ts`
- **Commands:** (from root `package.json`)
  - Dev: `npm run dev`
  - Build: `npm run build`
  - Tests: `npm test`
  - Typecheck: `npm run type-check`

---

## 3) Required reading (timeboxed)

### Must read

1. `.cursor/rules.md` (repo rules for docs/tests)
2. `README.md` (high-level capabilities)
3. `ARCHITECTURE.md` (shared-core + adapters)
4. Mobile focus:
   - `plans/HANDOFF_2025-12-16.md`
   - `mobile-wallet/index.js`
   - skim `mobile-wallet/app/**`, `mobile-wallet/services/**`, `mobile-wallet/store/**`

- Extension: `extension/README.md`, `EXTENSION_SETUP.md`, `vite.config.extension.ts`
- CLI: `plans/CLI_DOCUMENTATION.md`

---

## 4) Security guardrails (do not violate)

While reading, explicitly identify **where** these occur and **what invariants** they require:

- **Mnemonic / private key material**
  - must not be logged
  - must not be stored in plaintext
- **Passwords / encryption**
  - avoid passing secrets through UI state longer than needed
  - avoid accidental persistence in AsyncStorage / chrome.storage / files
- **Storage adapters**
  - confirm what is stored where on mobile (SecureStore vs AsyncStorage)
- **Network/RPC usage**
  - tests must not depend on live RPC/explorer calls (per `.cursor/rules.md`)

If any of these are unclear, stop and ask questions.

---

## 5) Local quality discipline (when you are later allowed to edit)

When you are explicitly instructed to start making changes, adopt this loop:

### After every change (small batch)

1. **Build** the relevant package (if applicable)
2. **Typecheck** the touched area
3. **Run tests** for the touched area

Minimum commands by area:

- **Core / root (shared SDK, CLI, shared logic):**
  - `npm run build`
  - `npm run type-check`
  - `npm test`

- **Mobile app (`mobile-wallet/`):**
  - `npm run typecheck`
  - `npm test`
  - (Optional but recommended when UI flows change) run the app: `expo start`

- **Extension (root build):**
  - `npm run type-check`
  - `npm run build:extension`
  - (If tests exist for extension, run them; otherwise keep changes small and validate manually in Chrome)

> If a full suite is too slow to run after every small edit, keep edits extremely small and still run the smallest relevant subset immediately, then run the full suite frequently (e.g., every 2–3 commits). Do not let failures accumulate.

---

## 6) Your output for this bootstrap task (deliverables)

Respond with:

### A) “Start Here” File Map (mobile-first)

- list **10–20 key files/dirs** (paths) and what each is responsible for
- include mobile routes + services bridge + store

### B) Top 5 Critical Invariants (security + correctness)

Examples of the type of invariants expected:

- crypto polyfill must load before expo-router modules evaluate
- no plaintext secret persistence
- lock/unlock clears sensitive state
  (Use repo-specific details you find.)

### C) Flow Map (mobile only, first pass)

For each flow, give a “start reading here” pointer:

- create/import/unlock
- portfolio/balances/prices
- send
- activity/history
- network switching
- receive/QR

### D) Testing quick guide (only what’s needed to not mess up later)

- which runner to use for mobile
- what must be mocked
- where tests likely live (if discoverable)

### E) Open questions (precise blockers only)

---

## 7) Definition of done (for bootstrap)

You are done when a new agent could:

- open the repo and quickly find the mobile entrypoints and flows,
- know the major “do not break” security invariants,
- know what to build/typecheck/test after edits,
- and have a short list of clarifying questions before any code change.
