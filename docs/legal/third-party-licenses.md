# Third-Party Open Source Licenses

This project uses open source software. This file summarizes notable license
families and the LGPL component that requires explicit attribution.

## LGPL Licensed Components

### rpc-websockets v9.3.2

- License: LGPL-3.0-only
- Copyright: Elpheria j.d.o.o.
- Repository: `https://github.com/elpheria/rpc-websockets`
- Used by: `@solana/web3.js` as a transitive dependency

`rpc-websockets` is used as an unmodified npm dependency for WebSocket RPC
communication.

## MIT Licensed Components

Common MIT-licensed dependencies include:

- `@solana/web3.js`
- `ethers`
- `react`
- `react-native`
- `expo`
- `bip39`
- `bitcoinjs-lib`
- `tweetnacl`
- `@noble/secp256k1`
- `buffer`
- `chalk`
- `dotenv`
- `inquirer`
- `typescript`
- `vite`
- `tailwindcss`

## Other License Families

- ISC: `xrpl`
- Apache-2.0: `@ton/core`, `@ton/ton`
- BSD-style: `bip32` and selected transitive dependencies

## Full License Checks

For complete license texts and dependency summaries:

```bash
npx license-checker --summary

cd mobile-wallet
npx license-checker --summary
```

Individual package license files are available under `node_modules/` and
`mobile-wallet/node_modules/` after installation.
