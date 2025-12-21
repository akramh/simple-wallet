# Mobile TON Handoff

## Context
- Branch includes fixes across shared SDK, mobile app, and extension to stabilize TON support.
- Primary issues: TON base64 decoding crash, missing Buffer APIs, wrong address for TON on unlock/account switch, fee estimation returning 0, send bounce behavior, missing tx hash, and UX gaps in mobile/extension.

## Key Fixes
- **Base64 decoding**: Stubbed `react-native-quick-base64` to `base64-js` to avoid broken native decoding (`mobile-wallet/stubs/react-native-quick-base64.js`, `mobile-wallet/metro.config.js`).
- **PBKDF2**: Added RN stub for `react-native-fast-pbkdf2` used by TON crypto (`mobile-wallet/stubs/react-native-fast-pbkdf2.js`).
- **Buffer**: Mobile uses `@craftzdog/react-native-buffer` for full API (needed by TON).
- **TON hash**: `TonProvider.sendTransaction` now polls Toncenter for a real tx hash after seqno increments (`src/ton/provider.ts`).
- **Fee estimation**: TON fee estimate now uses correct `estimateExternalMessageFee` payload and sums `source_fees` fields; removed reliance on missing `source_fees.total` (`src/ton/provider.ts`).
- **Account index**: TON signing/fee estimation now uses the current account index (fixes account2->account1 showing same sender) (`src/app-service.ts`, `src/ton/provider.ts`).
- **Address formatting**: Default TON address formatting is non-bounceable for display (`src/ton/address.ts`, `src/ton/types.ts`, `src/ton/explorer.ts`).
- **Status logic**: TON tx status logic now avoids marking incoming credits as failed; send/receive detection prefers outgoing if outbound messages exist (`src/ton/explorer.ts`).
- **Bounce flag**: Transfer bounce flag derived from friendly address; removed forced `bounce: true` in provider (`src/ton/transaction.ts`, `src/ton/provider.ts`).
- **CLI follow-up**: CLI now polls for TON hash when missing; confirmation shows balance (`src/index.ts`, `src/ui-helpers.ts`).
- **Extension follow-up**: Extension send view polls for TON hash if pending (`extension/popup/components/SendTransactionView.tsx`).
- **Mobile UI**: Send confirmation is now a modal (not system alert), includes network fee, hash (pending if missing), explorer link, copy-to-clipboard with toast, and TON comment support (`mobile-wallet/app/send.tsx`).
- **Explorer link**: TON explorer links added in mobile transaction details modal (`mobile-wallet/components/TransactionDetailsModal.tsx`).

## Tests Added/Updated
- `tests/ton.test.js` (bounce flag, hash decode, seqno fallback)
- `tests/ton-explorer.test.js` (TON tx normalization and matching)
- `tests/app-service.test.js` (TON fee estimation uses mnemonic; send passes account index)
- Mobile: `mobile-wallet/__tests__/WalletBridge-ton.test.ts`, `mobile-wallet/__tests__/walletStore-ton.test.ts`, `mobile-wallet/__tests__/TransactionDetailsModal.test.tsx`, `mobile-wallet/__tests__/send-screen.test.tsx`
- `npm test` passed after changes.

## Remaining Notes
- Mobile fee estimation previously returned 0 due to missing `source_fees.total`; now fixed by summing fields.
- If TON hash still missing, the polling window in `TonProvider` is 12s and CLI/extension have additional polling.
- Non-bounceable addresses are default for display; sending bounce derives from address flags.

## Files Touched (high level)
- Shared SDK: `src/ton/*`, `src/app-service.ts`, `src/index.ts`, `src/ui-helpers.ts`
- Mobile: `mobile-wallet/app/send.tsx`, `mobile-wallet/metro.config.js`, `mobile-wallet/components/TransactionDetailsModal.tsx`, `mobile-wallet/store/walletStore.ts`, `mobile-wallet/services/WalletBridge.ts`
- Extension: `extension/popup/components/SendTransactionView.tsx`
