# XRP Token Support Handoff

This branch adds XRP (XRP Ledger) support to the multi-chain wallet CLI, following the same provider/service patterns as the existing Bitcoin and Solana integrations.

## Scope

- Address derivation (BIP-44): `m/44'/144'/account'/0/0`
- Balance queries (with reserve math)
- Transaction history (Payments only; XRP native only)
- Sending XRP (Payment tx), with optional destination tag

## Constraints / Non-goals

- Uses `xrpl` (xrpl.js) v4 and WebSocket connections to XRPL nodes
- Amounts are handled internally as **drops** (integer), displayed as XRP (6 decimals)
- Reserve assumptions: `10 XRP` base + `2 XRP` per owned object
- Non-goals: issued currencies / trust lines, DEX trading, multisig, X-address encode/decode

## Architecture

- `src/xrp/types.ts`: constants + types + unit conversion helpers (`dropsToXrp`, `parseXrpToDropsExact`, reserve math)
- `src/xrp/address.ts`: BIP-44 derivation + `new Wallet(publicKey, privateKey)` using the derived BIP-32 keypair
- `src/xrp/explorer.ts`: xrpl.js `Client` wrapper (WebSocket), with simple in-memory caching
- `src/xrp/provider.ts`: unified provider API matching Bitcoin/Solana patterns
- `src/xrp/transaction.ts`: Payment build/sign/validation (reserve checks, destination tag validation)
- `src/app-service.ts`: high-level XRP operations exposed to the CLI
- `src/index.ts`: CLI integration (send flow, history view, portfolio pricing)

## CLI Notes

- Networks added in `config.json`: `xrp-mainnet`, `xrp-testnet`
- Destination tag is prompted as optional; validated as uint32 (`0..4294967295`)
- Reserve is always validated before sending; user may be blocked by the 10 XRP account activation minimum

## Current State

- Address derivation, balances, portfolio display, transaction history, and send flow implemented
- Unit and integration-style tests added in `tests/xrp.test.js`
- Local test run: all tests passing (415 total)

## Phase 5: Extension UI (pending)

- Update `extension/popup/components/MainWallet.tsx` (XRP balances + actions)
- Update `extension/popup/components/SendTransactionView.tsx` (destination tag UX)
- Update `extension/popup/components/ReceiveView.tsx` (XRP receive + destination tag guidance)
- Update `extension/popup/components/ActivityView.tsx` (XRP history rendering)
- Update `extension/popup/components/ui/NetworkSelector.tsx` (XRP networks)
- Update `extension/background/service-worker.ts` (wire XRP provider/service calls)

## Phase 6: Polish & Testing (pending)

- Add/verify XRP icon assets in the extension
- End-to-end CLI testing on XRPL testnet (funded accounts)
- End-to-end extension testing on XRPL testnet
- Reserve requirement UI warnings (10 XRP base + 2 XRP per owned object)
- Documentation updates

## Known Risks / Tech Debt

- WebSocket connection management is on-demand; may want pooling/reuse if usage grows
- A few `as any` casts are used due to xrpl.js v4 typing gaps (algorithm enum + tx typing)
