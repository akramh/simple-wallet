# TON Support Handoff (Extension + Core)

## Context
- This repo is a multi-platform wallet (CLI, Chrome extension, mobile app) built on a shared TypeScript core.
- Architecture references:
  - Core SDK overview: `plans/CORE_SDK_DOCUMENTATION.md`
  - Extension architecture: `plans/EXTENSION_DOCUMENTATION.md`
  - Project index: `plans/PROJECT_OVERVIEW.md`

## What’s Done
### Core SDK + CLI
- Added TON support across the core SDK (address derivation, balance, send, fee estimate, history, explorer URLs).
- New TON module: `src/ton/` (types, address, explorer, transaction, provider).
- `src/app-service.ts` now exposes TON methods (address, balance, portfolio, send, history, explorer URLs).
- `src/config-utils.ts` applies Toncenter RPC API keys from `.env` (per-network keys or fallback).
- `config.json` includes `ton-mainnet` and `ton-testnet` with Toncenter JSON-RPC URLs.
- Prices: added TON support in `src/price-service.ts`, CoinGecko/Coinpaprika mappings.
- Tests updated to include TON flows and they passed earlier via `npm test`.

### Extension (Phase 1/2)
- Background worker now supports TON:
  - Balance refresh uses portfolio path for TON.
  - Native TON price fetch (via price-service).
  - Send flow uses `walletService.sendTonTransaction` and tracks as pending.
  - Explorer history uses TON provider history.
  - `GET_NETWORK_CONFIG` includes `isTon` and `tonNetwork`.
  - Files: `extension/background/service-worker.ts`
- Popup UI:
  - TON address validation and placeholder (`EQ...` / `UQ...`).
  - Optional TON comment field on send.
  - Fee precision for TON (9 decimals).
  - Icon wiring for TON in network selector and token fallback.
  - Files: `extension/popup/components/MainWallet.tsx`, `extension/popup/components/SendTransactionView.tsx`
- Icons:
  - Extension TON SVG: `extension/assets/img/ton_symbol.svg` (already added).
  - Mobile wallet TON PNG: `mobile-wallet/assets/crypto/ton_symbol.png` (already added).

### Fixes
- Transaction history direction for TON fixed to compare raw addresses and classify incoming/outgoing properly.
  - File: `src/ton/explorer.ts`
- Buffer polyfill extended with `copy()` to support `@ton/core` usage in the extension.
  - File: `src/buffer-polyfill.ts`

## Known Issues / Risks
- Extension needs a rebuild after recent changes; if `Buffer.copy` errors still appear, confirm that the build picked up `src/buffer-polyfill.ts` changes.
- TON history may still appear as “sent” only if the address format mismatch or history is cached; test with a known incoming tx hash and refresh.

## What’s Left
### Extension
- Build + reload extension (`npm run build:extension`) and verify:
  - Send TON with comment (optional) and pending status handling.
  - Activity history shows both sent and received for TON.
- If UI needs TON icon in other places, confirm mappings in `MainWallet` and add as needed.

### Mobile Wallet
- Wire the new TON PNG into the mobile wallet UI token icon mapping if not already used.

### General
- Confirm `.env` keys for Toncenter are present:
  - `TONCENTER_API_KEY_TON_MAINNET`
  - `TONCENTER_API_KEY_TON_TESTNET`
  - Optional fallback `TONCENTER_API_KEY`

## File Pointers (Key Changes)
- Core TON module: `src/ton/`
- Core app service: `src/app-service.ts`
- Config + env keys: `src/config-utils.ts`, `config.json`
- Prices: `src/price-service.ts`, `src/price-providers/coinpaprika.ts`, `src/price-providers/coingecko.ts`
- Extension background: `extension/background/service-worker.ts`
- Extension UI: `extension/popup/components/MainWallet.tsx`, `extension/popup/components/SendTransactionView.tsx`
- Buffer polyfill fix: `src/buffer-polyfill.ts`
- TON icons: `extension/assets/img/ton_symbol.svg`, `mobile-wallet/assets/crypto/ton_symbol.png`

