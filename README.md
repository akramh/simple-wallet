# Simple Crypto Wallet

A multi-platform, multi-chain wallet built around a shared TypeScript core.
The same core SDK powers a Node CLI, a Chrome extension, and an Expo mobile
app.

## Platforms

- CLI: Node.js entrypoint at `src/index.ts`
- Chrome extension: Manifest V3 extension under `extension/`
- Mobile app: Expo + React Native app under `mobile-wallet/`
- SDK: Node and browser entrypoints exported from `src/sdk.ts` and
  `src/sdk-browser.ts`

## Supported Chains

- Ethereum and EVM networks: Ethereum, Sepolia, Base, Arbitrum, Optimism,
  Polygon, Avalanche, BNB Smart Chain, and Linea
- Bitcoin: mainnet and testnet
- Solana: mainnet and devnet
- XRP Ledger: mainnet and testnet
- TON: mainnet and testnet

## Quick Start

Install root dependencies:

```bash
npm install
```

Run the CLI in TypeScript development mode:

```bash
npm run dev
```

Build and run the compiled CLI:

```bash
npm start
```

Build the Chrome extension:

```bash
npm run build:extension
```

Run the mobile app:

```bash
cd mobile-wallet
npm install
npm start
```

Native mobile crypto requires a development build, not Expo Go.

## Documentation

All detailed project documentation lives under `docs/`.

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

## Security

This is wallet software. Treat mnemonic phrases, private keys, wallet backups,
and platform storage carefully. The security invariants are documented in
[docs/security.md](./docs/security.md); review them before touching storage,
crypto, signing, dApp approvals, or network/RPC behavior.

## License

MIT. See [LICENSE](./LICENSE).
