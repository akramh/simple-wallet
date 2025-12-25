# Private key import (cross-platform) — core-first plan

## Non-negotiable gating principle
**All three UIs share the same core (`src/`).** Therefore, **Core SDK must implement the imported-key wallet end-to-end first** (including storage + APIs + unit tests). Only after that do we wire CLI, then Extension, then Mobile.

## Phase 0 — Core SDK implementation (must land first)

### 0.1 Define the new wallet type and semantics
- Add a new wallet kind:
  - `kind: 'mnemonic-hd'` (existing)
  - `kind: 'imported-key'` (new)
- Imported-key wallet rules:
  - single-family: `evm | bitcoin | solana | xrp | ton`
  - non-HD: no account indices; single address
  - must support **receive/balance/send/history** for that family

### 0.2 Storage schema + migration (shared across all platforms)
- Evolve `wallets.json` to a versioned schema that supports both wallet kinds.
- Provide migration from today’s map format (mnemonic-only shape).
- Update export/import semantics:
  - Decide and document whether key-wallet export/import is supported (encrypted blob) or explicitly disallowed in v1.

### 0.3 Core APIs: feature parity without UI special-casing
Implement core APIs so UIs can treat wallet kind as an implementation detail:
- Import: `importPrivateKeyWallet({ keyFamily, secret, password, name })`
- Load/unlock: existing load entrypoints hydrate either wallet kind.
- Receive address: `getAddress()` and per-chain helpers work for imported-key wallets.
- Balance/portfolio:
  - EVM: native + ERC-20 (existing flows), signer derived from imported EVM key.
  - BTC/SOL/XRP/TON: native balance at minimum using derived address.
- Send:
  - Uses imported key material to sign per chain family.
  - Preserves chain UX requirements (XRP dest tag, TON comment).
- History:
  - Address-based history must work without mnemonic assumptions.

### 0.4 Parsing + validation (core-owned)
- Implement strict validators/normalizers per family:
  - EVM hex, BTC WIF/raw, SOL secret key formats, XRP seed/raw, TON key format.
- UIs only select the family and display validation errors.

### 0.5 Core test coverage (required gate)
- **node:test** unit tests in `tests/` covering:
  - key parsing/validation per family
  - encryption/decryption of imported secrets
  - storage migration v1 → v2
  - deterministic address derivation per family
  - receive/balance/history/send routing under mocks (no live RPC/explorer)
- Phase 0 is not complete until these tests exist and pass.

## Phase 1 — CLI wiring (consumes Phase 0 APIs)

### 1.1 CLI UX
- Add “Import wallet (private key)” path.
- Ensure the imported wallet can:
  - show receive address
  - show balance/portfolio
  - send
  - show history
  - switch networks within compatible set

### 1.2 CLI tests
- node:test flow tests simulating the new CLI path.
- Parity verification under mocks for balance/send/history.

## Phase 2 — Extension wiring (consumes Phase 0 APIs)

### 2.1 Background + UI
- Background service-worker: add import action and persist key-wallet.
- UI onboarding: add “Import private key” option.
- Ensure parity:
  - receive
  - balances/portfolio
  - send (approval flow)
  - history/activity
  - network filtering

### 2.2 Extension tests
- Unit tests for background handler + network filtering + parity calls.

## Phase 3 — Mobile wiring (consumes Phase 0 APIs)

### 3.1 WalletBridge/store/screen integration
- Add mobile setup screen for private-key import.
- Update WalletBridge/store to support listing/loading key-wallets.
- Ensure parity across tabs/modals:
  - wallet tab (balances + send/receive)
  - activity tab (history)
  - profile/security screens (no secret phrase; private key gated)
  - network picker filtering

### 3.2 Mobile tests
- Jest tests for:
  - WalletBridge import/unlock + parity methods
  - walletStore state transitions
  - setup screen validation logic

## Deliverable
- RFC doc (recommended `plans/PRIVATE_KEY_IMPORT.md`) including:
  - behavior differences vs mnemonic wallets
  - supported formats per family
  - schema/migration and backup/export decision
  - phase gates and acceptance criteria
  - test matrix per phase


