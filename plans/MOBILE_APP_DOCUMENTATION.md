# Mobile App Documentation

## Overview

The Mobile App (`mobile-wallet/`) is a high-performance, non-custodial crypto wallet built with **React Native** and **Expo SDK 54**. It brings the multi-chain capabilities of the Core SDK to iOS and Android, featuring a native look and feel, biometric security, and optimized cryptography.

## Architecture

The application is built on a layered architecture that bridges the Node.js-centric Core SDK to the React Native runtime.

```mermaid
graph TD
    UI[React Native UI (Expo Router)] --> Store[Zustand Store (walletStore)]
    Store --> Bridge[WalletBridge Service]
    
    subgraph "Native Adapters"
    Bridge --> Storage[MobileStorageAdapter]
    Bridge --> Crypto[MobileCryptoAdapter]
    end
    
    subgraph "Core SDK (Shared)"
    Bridge --> Service[WalletAppService]
    Service --> Wallet[Wallet Core]
    end
    
    Storage --> Secure[Expo SecureStore (Keychain)]
    Storage --> Async[AsyncStorage]
    Crypto --> Quick[react-native-quick-crypto (C++)]
```

### 1. State Management (`store/walletStore.ts`)
The app uses **Zustand** for global UI state. The store is the single source of truth for the UI but **never** holds sensitive data (like passwords or private keys).
-   **Reactive Data**: Balances, Prices, Transactions, Network status.
-   **Actions**: `unlock()`, `refreshBalances()`, `sendTransaction()`.
-   **Persistence**: Persists non-sensitive preferences (like `enabledNetworks`) via AsyncStorage.

### 2. Service Layer (`services/WalletBridge.ts`)
A Singleton service that acts as the facade for the Core SDK.
-   **Session Management**: Holds the `sessionPassword` in memory. It is cleared on lock or timeout.
-   **Auto-Lock**: A 15-minute inactivity timer automatically clears the session.
-   **Request Deduplication**: Prevents API spam by deduplicating in-flight balance and price requests.
-   **Lazy Loading**: Dynamically requires the Core SDK modules (`@wallet/*`) only when needed to optimize startup time.

### 3. Navigation (`app/`)
Uses **Expo Router** for file-based routing.
-   `app/_layout.tsx`: Root provider setup (QueryClient, SafeArea, Toast).
-   `app/(auth)/*`: Login, Import, and Creation flows.
-   `app/(tabs)/*`: Main wallet interface (Wallet, Activity, Portfolio, Profile).
-   `app/*.tsx`: Modals (Send, Receive, Network Select).

## Critical Adapters

The Mobile App requires specialized adapters to run the Node.js-based Core SDK in a React Native environment.

### 1. Crypto Adapter (`services/MobileCryptoAdapter.ts`)
**Problem**: The standard JS implementation of PBKDF2 (used for wallet encryption) takes ~16 seconds on the Hermes engine because Hermes is optimized for AOT size, not JIT loop performance.
**Solution**: We use `react-native-quick-crypto`, which binds to native C++ OpenSSL via JSI.
-   **Performance**: Reduces PBKDF2 (100k iterations) time from **16,000ms** to **~20ms**.
-   **Fallback**: Uses `@noble/hashes` (pure JS) for Jest tests where native modules are unavailable.
-   **Async Wrapper**: Wraps sync crypto calls in `setTimeout` to yield to the UI thread during heavy operations.

### 2. Storage Adapter (`services/MobileStorageAdapter.ts`)
**Problem**: We need secure storage for keys but also large storage for history.
**Solution**: A hybrid adapter.
-   **SecureStore**: Used for `wallets.json` (encrypted blobs). Maps to iOS Keychain / Android Keystore.
-   **AsyncStorage**: Used for `config.json`, transaction history, and cache.
-   **Sync Read**: The Core SDK requires synchronous `readJSON`. The adapter loads all data into an in-memory `Map` cache on startup (`initialize()`).

## Build & Configuration

### Metro Config (`metro.config.js`)
The bundler is heavily customized to support the monorepo and shared code.
-   **Monorepo Support**: `watchFolders` includes `../src`.
-   **Path Aliases**: Maps `@wallet/*` to `../src/*`.
-   **Stubs**: Redirects Node-only modules to local polyfills in `stubs/`:
    -   `crypto` → `stubs/crypto.js`
    -   `fs` → `stubs/fs.js`
    -   `bip32` → `stubs/bip32.js` (Replaces WASM dependency with pure JS)
    -   `tiny-secp256k1` → `stubs/tiny-secp256k1.js` (Replaces WASM dependency)

### Dependencies
-   **Native Modules**: Requires `npx expo prebuild` (cannot run in Expo Go).
-   **Polyfills**: `react-native-buffer`, `events`, `stream-browserify`.

## Key Features

### 1. Multi-Chain Support
The app supports all chains from the Core SDK:
-   **EVM**: Ethereum, Base, Polygon, etc. (using `ethers` + `ExplorerAPI`).
-   **Bitcoin**: Native SegWit addresses (using `stubs/bitcoin-index.js`).
-   **Solana**: SOL support (using `@solana/web3.js`).
-   **XRP**: Native XRP support (using `xrpl`).

### 2. Biometric Auth
-   Uses `expo-local-authentication`.
-   On success, retrieves the session password from SecureStore (if the user enabled "Remember Me").

### 3. Price & Portfolio
-   **Caching**: Prices are cached for 60 seconds.
-   **Aggregation**: `refreshAllNetworks` fetches balances across all enabled chains in parallel (with bounded concurrency) to show a global portfolio value.

### 4. Native Experience
-   **Haptic Feedback**: Uses `expo-haptics` for tactile interactions on buttons and successful transactions.
-   **Native Navigation**: Uses native stack and tab navigators for fluid screen transitions.
-   **QR Scanner**: Integrated camera support via `expo-camera` for scanning recipient addresses (Pending full implementation).

## Development Guide

### Setup
```bash
cd mobile-wallet
npm install
# Generate native folders (ios/android)
npx expo prebuild --clean
```

### Running
```bash
# iOS Simulator
npm run ios
# Android Emulator
npm run android
```

### Testing
-   **Unit Tests**: `npm test` (Uses Jest + `@testing-library/react-native`).
    -   *Note*: Mocks native modules like `react-native-quick-crypto`.
-   **E2E Tests**: Detox configuration is present (`detox.config.js`) for full flow testing.

### Shared Code Constraints
When editing the shared SDK (`src/`) for mobile compatibility:
-   **Avoid Node.js specific APIs**: Do not use `fs.readFileSync` or `crypto.randomBytes` directly. Use the injected Adapters.
-   **No WebAssembly**: Since React Native does not support WASM, any library using it must be stubbed or replaced with a pure JS or JSI equivalent.
-   **Sync vs Async**: Prefer async methods for heavy operations to keep the mobile UI responsive.

## Known Limitations / Gotchas
1.  **Hermes & BigInt**: Hermes supports `BigInt`, so we don't need a polyfill, but be careful with `JSON.stringify` on objects containing BigInts (handled in SDK).
2.  **WASM**: React Native does not support WebAssembly. Any library using WASM (like `tiny-secp256k1`) MUST be stubbed with a pure JS or C++ JSI alternative.
3.  **SecureStore Size**: Has a 2KB limit on some Android devices. We only store the encrypted wallet blob, not the entire transaction history, in SecureStore.
