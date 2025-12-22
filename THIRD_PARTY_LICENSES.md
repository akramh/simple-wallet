# Third-Party Open Source Licenses

This project uses the following open source software components. We are grateful to the open source community for their contributions.

## LGPL Licensed Components

### rpc-websockets v9.3.2

**License:** LGPL-3.0-only
**Copyright:** Elpheria j.d.o.o.
**Repository:** https://github.com/elpheria/rpc-websockets
**Used by:** @solana/web3.js (transitive dependency)

```
Copyright (c) Elpheria j.d.o.o.

rpc-websockets is an Open Source project licensed under the terms of
the LGPLv3 license. Please see <https://www.gnu.org/licenses/lgpl-3.0.html>
for license text.

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 3 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this library; if not, see <https://www.gnu.org/licenses/lgpl-3.0.html>.
```

**Note:** This package is dynamically linked as a Node.js dependency and is used for WebSocket RPC communication with the Solana blockchain.

---

## MIT Licensed Components

The majority of dependencies in this project are licensed under the MIT License, including but not limited to:

- **@solana/web3.js** v1.98.4 - Solana JavaScript SDK
- **ethers** v6.13.1 - Ethereum library for JavaScript
- **React** v18.2.0 & v19.1.0 - JavaScript library for building user interfaces
- **React Native** v0.81.5 - Framework for building native apps
- **Expo** ~54.0.30 - Platform for making universal native apps
- **bip39** v3.1.0 - Bitcoin BIP39 mnemonic generation
- **bitcoinjs-lib** v7.0.0 - Bitcoin library for JavaScript
- **tweetnacl** v1.0.3 - Cryptographic library
- **@noble/secp256k1** v3.0.0 - Elliptic curve cryptography
- **buffer** v6.0.3 - Node.js Buffer API for browsers
- **chalk** v5.6.2 - Terminal string styling
- **dotenv** v17.2.3 - Loads environment variables
- **inquirer** v9.2.12 - Interactive command line interface
- **TypeScript** v5.9.3 - TypeScript compiler
- **Vite** v5.0.0 - Frontend build tool
- **TailwindCSS** v4.1.17 - Utility-first CSS framework

---

## ISC Licensed Components

- **xrpl** v4.1.0 - JavaScript/TypeScript library for XRP Ledger

---

## Apache-2.0 Licensed Components

- **@ton/core** v0.57.0 - TON blockchain core library
- **@ton/ton** v13.0.0 - TON blockchain JavaScript SDK

---

## BSD Licensed Components

- **bip32** v5.0.0 - BIP32 hierarchical deterministic keys (BSD-2-Clause)

---

## Full License Information

For complete license texts and a comprehensive list of all dependencies, please run:

```bash
# For root project
npx license-checker --summary

# For mobile wallet
cd mobile-wallet && npx license-checker --summary
```

Or view individual package licenses in:
- `node_modules/<package-name>/LICENSE`
- `mobile-wallet/node_modules/<package-name>/LICENSE`

---

## License Compliance

All components are used in compliance with their respective licenses. The LGPL-licensed component (rpc-websockets) is:
- Dynamically linked (not statically compiled)
- Used as an unmodified Node.js dependency
- Properly attributed in this document
- Available for replacement by end users through standard npm dependency management

---

**Last Updated:** December 21, 2025
