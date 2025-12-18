# Mobile App Documentation

## Overview

The Mobile App (`mobile-wallet/`) is a React Native application built with **Expo SDK 54**. It brings the full multi-chain capabilities of the Core SDK to iOS and Android devices. It emphasizes performance and native feel while reusing the business logic from `src/`.

## Architecture

The mobile app bridges the Node.js-centric Core SDK to the React Native environment using the **Adapter Pattern**.

### 1. The Bridge (`services/WalletBridge.ts`)
Since the Core SDK is designed for Node/Web, the Mobile App uses a Singleton `WalletBridge` to adapt it.
-   **Lazy Loading**: Initializes the `WalletAppService` only when needed.
-   **Method Exposure**: Exposes simplified async methods for the UI (e.g., `createWallet`, `getBalances`).
-   **Session Management**: Handles the master password session in memory (Zustand store).

### 2. Native Polyfills & Adapters
React Native does not have the standard Node.js `crypto` or `fs` modules.

#### Crypto Adapter (`services/MobileCryptoAdapter.ts`)
**CRITICAL**: We use `react-native-quick-crypto` via JSI (JavaScript Interface) for native C++ performance.
-   **Why?** standard JS implementations of PBKDF2 (key derivation) take ~16s on Hermes. `quick-crypto` takes ~20ms.
-   **Implementation**: The adapter implements the shared `CryptoAdapter` interface using `quick-crypto`.

#### Storage Adapter (`services/MobileStorageAdapter.ts`)
-   **Sensitive Data**: Uses `expo-secure-store` (Keychain/Keystore) for preferences and sensitive flags.
-   **Large Data**: Uses `@react-native-async-storage/async-storage` for the encrypted wallet blobs and transaction history.

#### Metro Configuration (`metro.config.js`)
To make the shared `src/` folder compatible:
-   **Path Aliases**: Maps `@wallet/*` to `../src/*`.
-   **Stubs**: Redirects Node-only modules (like `stream`, `path`) to browser-compatible polyfills or empty stubs in `mobile-wallet/stubs/`.

### 3. UI Layer
-   **Framework**: Expo Router (file-based routing in `app/`).
-   **Styling**: NativeWind (Tailwind CSS).
-   **State**: Zustand (`store/walletStore.ts`) for reactive global state.

### 4. Zustand Store with Optimized Selectors
The mobile app uses optimized Zustand selectors (`store/selectors.ts`) to prevent unnecessary re-renders:

```typescript
// BAD - subscribes to entire store, re-renders on any change
const { balances, network } = useWalletStore();

// GOOD - only re-renders when specific slice changes
import { useBalancesSelector, useNetworkSelector } from '../store';
const balances = useBalancesSelector();
const network = useNetworkSelector();

// Screen-specific composite selectors for common patterns
import { useWalletScreenSelector } from '../store';
const { address, balances, network, refreshBalances } = useWalletScreenSelector();
```

Available screen selectors:
-   `useWalletScreenSelector` - Main wallet view
-   `useActivityScreenSelector` - Transaction history
-   `usePortfolioScreenSelector` - Portfolio overview
-   `useProfileScreenSelector` - Settings/profile
-   `useSendScreenSelector` - Send transaction
-   `useUnlockScreenSelector` - Unlock/auth
-   `useNetworkSelectScreenSelector` - Network selection

## Key Features

-   **Biometrics**: Supports FaceID/TouchID to unlock the wallet using OS-level hardware security (see Security section).
-   **Haptic Feedback**: Uses `expo-haptics` for tactile interactions.
-   **Native Navigation**: Stack and Tab navigation via Expo Router.
-   **Scanner**: Camera integration for scanning QR codes (pending implementation).

## Development Guide

### Setup
```bash
cd mobile-wallet
npm install
npx expo prebuild --clean # Required for native crypto modules
```

### Running
-   `npm run ios`: Launches in iOS Simulator.
-   `npm run android`: Launches in Android Emulator.

### Shared Code Constraints
When editing `src/` (Core SDK):
-   **Avoid Node.js specific APIs**: Do not use `fs.readFileSync` or `crypto.randomBytes` directly. Use the injected Adapters.
-   **BigInt**: React Native (Hermes) supports BigInt, so modern JS is fine.

## Security

### Biometric Authentication
The mobile app uses **OS-level biometric protection** via `expo-secure-store` with `requireAuthentication: true`. This provides hardware-backed security:

-   **iOS**: Uses Keychain with `kSecAccessControlBiometryAny` access control. The Secure Enclave handles biometric verification before releasing secrets.
-   **Android**: Uses Android Keystore with biometric-gated keys (API 23+).

**Implementation** (`hooks/useBiometrics.ts`):
```typescript
const BIOMETRIC_SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to unlock your wallet',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
```

**Key Security Properties**:
-   Biometric prompt is handled by the OS, not the app layer (resistant to runtime bypass attacks)
-   Keys are automatically invalidated when biometric settings change (new fingerprint, etc.)
-   Password is only released after successful biometric verification at the hardware level

### Session Password
The master password is held in memory (`WalletBridge.sessionPassword`) only while the wallet is unlocked. It is cleared on lock and never persisted to disk unencrypted.

### Auto-Lock
The app automatically locks after 15 minutes of inactivity, clearing the session password from memory.
