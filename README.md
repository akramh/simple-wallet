# Simple Wallet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built on Alchemy](https://img.shields.io/badge/Built%20on-Alchemy-6f4cff.svg)](https://www.alchemy.com/)
[![Platforms](https://img.shields.io/badge/platforms-CLI%20%7C%20Chrome%20%7C%20Mobile-informational.svg)](#platforms)
[![Chains](https://img.shields.io/badge/chains-EVM%20%C2%B7%20Bitcoin%20%C2%B7%20Solana%20%C2%B7%20XRP%20%C2%B7%20TON-blue.svg)](#supported-chains)

**A multi-chain wallet built on [Alchemy](https://www.alchemy.com/). One API key
powers RPC (EVM + Solana), transaction history, prices, and portfolio data —
across a CLI, a Chrome extension, and a mobile app, all from one shared
TypeScript core.**

It's also a **reference implementation for using Alchemy's APIs**: real,
production-shaped code showing the Alchemy JSON-RPC, Transfers, Prices, and
Portfolio Data APIs working together across nine EVM chains plus Solana.

👉 **Start here: [How Simple Wallet uses Alchemy](./docs/alchemy.md)** — a guided
tour of every Alchemy integration, with links straight into the code.

## Why this is a good Alchemy showcase

- **One key, many chains.** A single `ALCHEMY_API_KEY` serves nine EVM networks
  and Solana — the hostname selects the chain, so there's no per-chain key
  sprawl. ([details](./docs/alchemy.md#the-one-key-many-chains-model))
- **Four Alchemy products, working together:**
  - **JSON-RPC** — balances, token reads, gas, and sends (EVM + Solana)
  - **Transfers API** — `alchemy_getAssetTransfers` for transaction history
  - **Prices API** — first-priority USD token prices
  - **Portfolio Data API** — balances + prices + metadata in a single call
- **Three real UIs, one core.** The same integration code backs the CLI,
  extension, and mobile app — you can see how the key is injected under Node,
  Vite, and Expo.
- **Graceful fallback.** Alchemy is preferred everywhere; public RPC, Etherscan
  V2, and CoinGecko fill gaps without changing callers.

## Quick start (about 5 minutes)

**Prerequisites:** Node.js 18+ and npm.

```bash
# 1. Clone and install
git clone https://github.com/akramh/simple-wallet.git
cd simple-wallet
npm install

# 2. Configure your Alchemy key
cp .env.example .env
# Get a free key at https://dashboard.alchemy.com/ and set ALCHEMY_API_KEY in .env

# 3. Run the CLI
npm run dev
```

That single key is all you need to fetch balances, history, and prices across
every supported EVM chain and Solana. Every other key in `.env.example` is
optional (non-Alchemy chains and higher rate limits).

### Chrome extension

```bash
npm run build:extension
# Load dist-extension/ as an unpacked extension at chrome://extensions/
```

The extension build reads `VITE_ALCHEMY_API_KEY`.

### Mobile app

```bash
cd mobile-wallet
npm install
npm start
```

Native crypto requires a development build (not Expo Go). Mobile reads
`EXPO_PUBLIC_ALCHEMY_API_KEY`.

## Platforms

- **CLI** — Node.js entrypoint at `src/index.ts`
- **Chrome extension** — Manifest V3 extension under `extension/`
- **Mobile app** — Expo + React Native app under `mobile-wallet/`
- **SDK** — Node and browser entrypoints exported from `src/sdk.ts` and
  `src/sdk-browser.ts`

## Supported Chains

- **EVM** — Ethereum, Sepolia, Base, Arbitrum, Optimism, Polygon, Avalanche,
  BNB Smart Chain, Linea *(Alchemy RPC + Transfers/Portfolio/Prices)*
- **Solana** — mainnet and devnet *(Alchemy RPC)*
- **Bitcoin** — mainnet and testnet *(mempool.space)*
- **XRP Ledger** — mainnet and testnet *(xrpl WebSocket)*
- **TON** — mainnet and testnet *(Toncenter)*

## Screenshots

<!-- TODO: add screenshots of the extension popup and mobile app here. -->
_Screenshots coming soon._

## Documentation

All detailed project documentation lives under `docs/`.

- **[How Simple Wallet uses Alchemy](./docs/alchemy.md)** — the Alchemy integration tour
- [Documentation index](./docs/README.md)
- [Getting started](./docs/getting-started.md)
- [Architecture](./docs/architecture.md)
- [API reference](./docs/api-reference.md)
- [Development workflow](./docs/development.md)
- [Testing](./docs/testing.md)
- [Security](./docs/security.md)
- [External APIs and environment variables](./docs/external-apis-and-env.md)
- [CLI](./docs/platforms/cli.md)
- [Chrome extension](./docs/platforms/extension.md)
- [Mobile app](./docs/platforms/mobile.md)
- [License compliance](./docs/legal/license-compliance.md)
- [Third-party licenses](./docs/legal/third-party-licenses.md)

## Core Commands

```bash
npm run build              # Compile TypeScript to dist/
npm run type-check         # Type-check root project
npm test                   # Build and run root node:test suite
npm run build:extension    # Build dist-extension/
npm run watch:extension    # Rebuild extension on change
```

Mobile commands run from `mobile-wallet/`:

```bash
npm start                  # Start Expo
npm run ios                # Run iOS development build
npm run android            # Run Android development build
npm run typecheck          # Type-check mobile app
npm test                   # Run Jest tests
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev
setup, build/test loops, and the security expectations for wallet changes.

## Security

This is wallet software. Treat mnemonic phrases, private keys, wallet backups,
and platform storage carefully. The security invariants are documented in
[docs/security.md](./docs/security.md); review them before touching storage,
crypto, signing, dApp approvals, or network/RPC behavior. To report a
vulnerability, see [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
