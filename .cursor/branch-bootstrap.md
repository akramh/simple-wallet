# Simple Wallet — Change Review Bootstrap (Working From Existing Changes)

**Use this when:** You are onboarding to the repo **and** there are already changes present (local unstaged changes, a working branch, or an open PR). Your job is to understand the *specific change set*, then continue work (bug fixes / features) safely.

**Repo:** `akramh/simple-wallet`  
**UI priority:** Mobile first → Extension → CLI

---

## 0) Non‑negotiable constraints

1. **Follow repo rules in `.cursor/rules.md` (authoritative).**
2. **Do not introduce unrelated refactors.** Keep scope constrained to the change set and required fixes.
3. **No guessing.** If intent is unclear, ask precise questions and/or infer intent from commits/PR description/tests.
4. **Security-first.** This is a wallet—treat key material, passwords, storage, and signing flows as sensitive.

---

## 1) Inputs you must collect (ask if missing)

Provide (or request) **at least one** of:
- PR URL, **or**
- branch name + repo, **or**
- a `git diff` (preferred), **or**
- list of modified files, **or**
- screenshots/video + reproduction steps (for UI regressions)

Also request:
- target platform (mobile / extension / CLI) if not obvious
- how to run the affected area (commands, env vars, testnet keys, feature flags)
- expected behavior vs actual behavior
- any known security constraints (e.g., “must not persist mnemonic”)

---

## 2) First 15 minutes: Understand the change set (no coding yet)

### A) Summarize the change at 3 levels
1. **One sentence:** what is the user-visible outcome?
2. **One paragraph:** what systems/modules were touched and why?
3. **Bullet list:** key files changed and what changed in each.

### B) Categorize the changes (pick all that apply)
- UI-only (layout/state)
- Business logic (SDK / service layer)
- Storage/session/auth
- Crypto/signing/encryption
- Network/RPC/explorer/price services
- Build/config/tooling
- Tests

### C) Identify “blast radius”
- Which platforms are impacted? (Mobile / Extension / CLI / shared core)
- Are shared modules in `/src` touched? If yes, assume multi-platform impact.

---

## 3) Map the change to core architecture (fast orientation)

Use this mental model:
- **Core SDK:** `/src` (wallet logic, chain modules, adapters, orchestration via `WalletAppService`)
- **Mobile:** `mobile-wallet/` (expo-router screens, services bridge, Zustand store)
- **Extension:** `extension/` (popup/sidepanel UI, MV3 background worker, content/provider scripts)
- **CLI:** `src/index.ts` consumer

For each changed file, answer:
- Is this UI code, bridge/adapters, or core SDK?
- What invariant does it rely on? (lock/unlock, storage encryption, network selection, etc.)

---

## 4) Security review checklist (must do for relevant changes)

If the change touches any of these, explicitly document findings:

### Secrets & key material
- Does any diff add logging of secrets?
- Are mnemonic/private keys ever stored or passed through UI state?
- Are errors/messages leaking sensitive values?

### Storage & session state
- Where is wallet state stored now (SecureStore/AsyncStorage/chrome.storage/fs)?
- Are there new persistence keys? Migration risks?
- Does locking clear sensitive in-memory state?

### Crypto & signing
- Any changes to encryption parameters (PBKDF2 iterations, AES mode, salts, IVs)?
- Any platform crypto adapter changes? (mobile polyfills are especially fragile)

### Network/RPC
- Any new live calls added to tests? (Not allowed—must mock/fixture)
- Any new endpoint/config requirement?

**If you cannot confirm safety from the diff, stop and ask.**

---

## 5) Local quality discipline (required for all follow-up edits)

When you start making changes to the existing change set, use this loop:

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
  - validate manually in Chrome (`chrome://extensions`) after rebuild/reload
  - (If tests exist for extension, run them; otherwise keep changes small and validate flows)

> If a full suite is too slow to run after every small edit, keep edits extremely small and still run the smallest relevant subset immediately, then run the full suite frequently. Do not let failures accumulate.

---

## 6) Reproduce and validate the change

### A) Run the relevant surface area
- **Mobile:** run Expo + affected screen(s)
- **Extension:** rebuild + load unpacked + test flows
- **CLI:** run `npm run dev`

### B) Verify “before/after” behavior
- Identify expected behavior from PR description/issue/spec
- Verify current behavior matches (or identify mismatches)

### C) Record a minimal repro
- steps
- expected vs actual
- logs (scrub secrets)
- screenshots if UI

---

## 7) Tests & repo quality gates (follow `.cursor/rules.md`)

- Any functional change must include tests.
- Tests must be deterministic (no live RPC/explorer calls).
- Choose runner:
  - **Core logic:** root `node:test`
  - **React Native / Expo UI:** mobile Jest + `@testing-library/react-native`
  - **User-flow validation:** Detox smoke tests (small + stable)

Before finishing work, ensure:
- lint/typecheck for touched area (if scripts exist; at minimum typecheck)
- relevant test suites run and pass

---

## 8) Deliverables for this task (what you must output)

### A) Change Set Brief
- what changed (user-facing + technical)
- file-by-file map
- risks / blast radius

### B) “What I would do next” plan
- prioritized bug/feature tasks
- explicit scope boundaries (what you will NOT change)
- build/typecheck/test loop you will follow
- test plan (what to add/update)

### C) Open questions / assumptions
- list only true blockers
- propose options where ambiguity exists

### D) (If asked to fix/extend) Implementation notes
- exact files to edit
- invariants to preserve
- test strategy and mocks/fixtures needed

---

## 9) Questions you should ask immediately (template)

1) What is the **source of truth** for expected behavior? (PR description, issue, design doc, screenshot)
2) Is this change intended for **mobile only**, or should core/extension/CLI match?
3) Are there constraints on **storage/encryption** for this change?
4) What environments must pass? (iOS/Android, device/simulator, MV3 Chrome version)
5) What is the **acceptance criteria** for considering this change “done”?
---