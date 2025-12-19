# Project Overview & Documentation Index

Welcome to the Simple Crypto Wallet project. This is a multi-platform, multi-chain wallet solution that runs as a CLI, Chrome Extension, and Mobile App (iOS/Android), all powered by a single shared TypeScript core.

## Documentation Index

Detailed documentation for each component of the system can be found in the following files:

-   **[Core SDK](./CORE_SDK_DOCUMENTATION.md)** (`src/`)
    -   The shared business logic, cryptography, and chain integrations.
    -   Explains the `WalletAppService`, Providers, and Adapter patterns.
    
-   **[CLI](./CLI_DOCUMENTATION.md)** (`src/index.ts`)
    -   The developer tool and terminal interface.
    -   Explains the menu system and configuration.

-   **[Chrome Extension](./EXTENSION_DOCUMENTATION.md)** (`extension/`)
    -   The browser-based wallet.
    -   Explains Manifest V3, Message Passing, and dApp Injection.

-   **[Mobile App](./MOBILE_APP_DOCUMENTATION.md)** (`mobile-wallet/`)
    -   The React Native / Expo application.
    -   Explains the Bridge architecture, Native Modules (Crypto), and Metro config.

## supported Chains

| Chain | Network Types | Features |
|-------|---------------|----------|
| **Ethereum** (and EVM) | Mainnet, Testnets, L2s | Balance, Send, ERC-20, History, dApp |
| **Bitcoin** | Mainnet, Testnet | Balance, Send, History |
| **Solana** | Mainnet, Devnet | Balance, Send, History |
| **XRP** | Mainnet, Testnet | Balance, Send (w/ Dest Tag), History |

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run CLI
```bash
npm start
```

### 3. Build Extension
```bash
npm run build:extension
```

### 4. Run Mobile App
```bash
cd mobile-wallet
npm install
npm run ios # or android
```
