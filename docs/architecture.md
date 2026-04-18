# Architecture

Simple Crypto Wallet uses one shared TypeScript core with thin platform
adapters for CLI, Chrome extension, and mobile.

## High-Level Shape

```text
CLI / Extension / Mobile
        |
        v
WalletAppService
        |
        +-- Wallet
        +-- StorageAdapter
        +-- CryptoAdapter
        +-- ProviderFactory
        +-- Token registry
        +-- Price and portfolio services
        |
        v
Chain modules: ethereum, bitcoin, solana, xrp, ton
```

## Shared Core

All chain-aware business logic lives in `src/`. UIs should call
`WalletAppService` instead of reaching into `Wallet` directly.

Important shared modules:

- `src/app-service.ts`: wallet lifecycle, network switching, token registry,
  portfolio queries, and send orchestration
- `src/wallet.ts`: encrypted wallet state, mnemonic/private-key import, HD
  derivation, and chain address helpers
- `src/storage.ts`: `StorageAdapter`, `FileStorage`, and `MemoryStorage`
- `src/chrome-storage.ts`: extension storage adapter
- `src/crypto-adapter.ts`: Node and WebCrypto-compatible crypto abstraction
- `src/providers.ts`: EVM provider factory
- `src/explorer-api.ts`: EVM transaction history through Alchemy Transfers or
  Etherscan V2 fallback
- `src/transaction-history.ts`: normalized cross-chain history helpers
- `src/unified-portfolio.ts` and `src/portfolio-api.ts`: portfolio aggregation
  and Alchemy Portfolio API integration
- `src/price-providers/`: Alchemy, CoinGecko, and CoinPaprika price providers

## Chain Modules

Each non-EVM chain is isolated under `src/<chain>/` with a consistent shape:

```text
address.ts
provider.ts
explorer.ts
transaction.ts
types.ts
index.ts
```

Current chain directories:

- `src/ethereum/`
- `src/bitcoin/`
- `src/solana/`
- `src/xrp/`
- `src/ton/`

## Adapters

### Storage

`StorageAdapter` decouples the core from platform storage:

- CLI: `FileStorage`
- Tests and ephemeral contexts: `MemoryStorage`
- Extension: `ChromeStorageAdapter`
- Mobile: `MobileStorageAdapter` in `mobile-wallet/services/`

### Crypto

`CryptoAdapter` decouples encryption and key derivation from platform APIs:

- Node/CLI uses Node crypto by default.
- Extension switches to WebCrypto with `setCryptoAdapter(createWebCryptoAdapter())`.
- Mobile uses `react-native-quick-crypto` through `MobileCryptoAdapter` for
  native-speed PBKDF2.

## Platform Flows

### CLI

`src/index.ts` initializes file storage and the shared service, then runs an
interactive menu. It is useful both as a wallet UI and as a direct integration
surface for shared-core behavior.

### Chrome Extension

The MV3 service worker owns decrypted wallet state. Popup and sidepanel UIs
send messages to the service worker and re-fetch state as needed.

```text
popup/sidepanel -> background/service-worker.ts -> WalletAppService
dApp -> content/provider.ts -> content/injected.ts -> service worker
```

The page-facing provider implements EIP-1193-style `window.ethereum.request()`
routing for account access, chain data, transactions, and signing approvals.

### Mobile

`mobile-wallet/index.js` loads crypto and Buffer polyfills before
`expo-router/entry`; this order is required. Screens live in `mobile-wallet/app/`.
State lives in `mobile-wallet/store/`, and `mobile-wallet/services/WalletBridge.ts`
adapts the shared service for React Native.

## Network Configuration

Networks live in root `config.json`. EVM and Solana RPC URLs can be a string or
an array for failover. Environment-variable placeholders are substituted at
load time by shared config helpers.

Alchemy is the primary configured provider for EVM RPC, Solana RPC, supported
EVM transaction history, current prices, and extension portfolio fast paths.
Etherscan V2 remains the transaction-history fallback for EVM chains not
covered by Alchemy Transfers.

See [external APIs and environment variables](./external-apis-and-env.md).

## Token Registry

Built-in tokens live in root `tokens.json`. Per-user custom tokens live in
`tokens-user.json` through the active storage adapter.

`WalletAppService` owns token registry access so platform UIs can share the
same add, remove, lookup, and portfolio behavior.

## Adding a Chain

1. Add a `src/<chain>/` module with address, provider, explorer, transaction,
   types, and index files.
2. Add network config types and type guards in `src/types/config.ts`.
3. Add wallet derivation/address support in `src/wallet.ts`.
4. Add service orchestration in `src/app-service.ts`.
5. Add config entries and token metadata where relevant.
6. Add root tests with mocked providers and no live network calls.
7. Validate extension and mobile surfaces if the new chain is user-facing there.
