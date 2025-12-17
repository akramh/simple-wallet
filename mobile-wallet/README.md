# Simple Wallet Mobile App

React Native mobile app for the Simple Wallet crypto wallet, built with Expo.

## Tech Stack

- **Framework**: [Expo SDK 52](https://expo.dev/) + React Native
- **Navigation**: [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing)
- **Styling**: [NativeWind](https://www.nativewind.dev/) (Tailwind CSS for React Native)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) + [React Query](https://tanstack.com/query)
- **Storage**: `expo-secure-store` (sensitive) + `@react-native-async-storage/async-storage`

## Project Structure

```
mobile-wallet/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Auth flow
│   │   ├── _layout.tsx    # Auth stack navigator
│   │   ├── welcome.tsx    # Welcome/onboarding
│   │   ├── create.tsx     # Create new wallet
│   │   ├── import.tsx     # Import existing wallet
│   │   ├── unlock.tsx     # Unlock with password/biometrics
│   │   └── backup.tsx     # Backup recovery phrase
│   ├── (tabs)/            # Main tab navigation
│   │   ├── _layout.tsx    # Tab navigator config
│   │   ├── wallet.tsx     # Token balances & quick actions
│   │   ├── activity.tsx   # Transaction history
│   │   ├── portfolio.tsx  # Holdings breakdown
│   │   └── profile.tsx    # Settings & account
│   ├── _layout.tsx        # Root layout (providers)
│   ├── index.tsx          # Entry redirect logic
│   ├── send.tsx           # Send modal
│   ├── receive.tsx        # Receive modal with QR
│   └── network-select.tsx # Network selector modal
├── components/            # Reusable UI components
│   ├── Button.tsx         # Primary/secondary/ghost buttons
│   ├── Input.tsx          # Text input with validation
│   ├── TokenCard.tsx      # Token balance row
│   ├── TransactionItem.tsx # Transaction history item
│   ├── NetworkBadge.tsx   # Network indicator
│   ├── QRCode.tsx         # QR code display
│   └── EmptyState.tsx     # Empty placeholder
├── hooks/                 # Custom React hooks
│   ├── useWallet.ts       # Wallet state & actions
│   ├── useBalances.ts     # Token balances & prices
│   ├── useTransaction.ts  # Send transaction logic
│   ├── useBiometrics.ts   # Biometric authentication
│   └── useClipboard.ts    # Clipboard with haptics
├── services/              # Platform adapters & wallet bridge
│   ├── MobileStorageAdapter.ts  # SecureStore + AsyncStorage
│   ├── MobileCryptoAdapter.ts   # Native crypto via quick-crypto
│   └── WalletBridge.ts    # Bridge to WalletAppService
├── store/                 # Zustand state management
│   └── walletStore.ts     # Global wallet state
└── [config files]         # TypeScript, Tailwind, Metro, etc.
```

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (Mac) or Android Emulator

### Installation

```bash
cd mobile-wallet
npm install
```

### Development

```bash
# Start development server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Integration with Core Wallet

The mobile app shares the core wallet SDK (`../src/`) via:

1. **WalletBridge** - Provides the same API as the extension's service worker
2. **MobileStorageAdapter** - Implements `StorageAdapter` interface using secure storage
3. **MobileCryptoAdapter** - Implements `CryptoAdapter` interface for React Native

### Crypto Performance

The app uses `react-native-quick-crypto@0.7.15` for native-speed PBKDF2:

| Engine | PBKDF2 100k | Why |
|--------|-------------|-----|
| Native C++ (quick-crypto) | **~20ms** | OpenSSL optimizations, full CPU speed |
| V8 (Node.js) | ~20ms | JIT compiles hot loops |
| Hermes (React Native) | ~16,000ms | AOT bytecode, no loop optimization |

**Why Hermes is 800x slower for crypto:**
- Hermes is optimized for fast app startup (AOT compilation), not CPU-intensive loops
- PBKDF2 with 100k iterations = 200k+ SHA256 operations
- Each SHA256 has 64 rounds of bitwise operations
- Pure JavaScript in Hermes doesn't benefit from JIT optimization

**Solution (same as MetaMask):**
- Uses `react-native-quick-crypto@0.7.15` which calls `fastpbkdf2.c` via JSI
- Native C code runs at full CPU speed with OpenSSL optimizations
- Wallet unlock is now instant (~20ms) instead of 16+ seconds

**Dependencies:**
- `react-native-quick-crypto@0.7.15` - Native crypto via JSI
- `@craftzdog/react-native-buffer` - Buffer polyfill for quick-crypto
- `OpenSSL-Universal` pod - Required for iOS build

**After pulling changes**, rebuild native modules:
```bash
npx expo prebuild --clean
```

### Configuring Module Resolution

To integrate with the shared `src/` code, update `metro.config.js`:

```js
config.resolver.extraNodeModules = {
  '@wallet': path.resolve(__dirname, '../src'),
};
config.watchFolders = [
  path.resolve(__dirname, '../src'),
];
```

## Features

### Implemented ✅
- [x] Project scaffolding (Expo SDK 52, NativeWind, TypeScript)
- [x] Platform adapters (MobileStorageAdapter, MobileCryptoAdapter with native crypto)
- [x] WalletBridge service layer (mirrors extension API)
- [x] Zustand store with wallet state management
- [x] Navigation shell (expo-router tabs + stacks + modals)
- [x] Auth flow screens (welcome, create, import, unlock, backup)
- [x] Main tab screens (wallet, activity, portfolio, profile)
- [x] Modal screens (send, receive with QR, network-select)
- [x] Reusable UI components (Button, Input, TokenCard, etc.)
- [x] Custom hooks (useWallet, useBalances, useTransaction)
- [x] Biometric authentication (Face ID / Touch ID)
- [x] QR code generation for receive address
- [x] Clipboard with haptic feedback

### Pending (Phase 2+)
- [ ] Wire WalletBridge to actual core SDK modules
- [ ] QR code scanning for send
- [ ] Token price fetching integration
- [ ] Transaction history from explorer APIs
- [ ] Push notifications
- [ ] WalletConnect / dApp browser

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    UI Layer                       │
│  (React Native screens + NativeWind styling)      │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│              Zustand Store                        │
│  (walletStore: state + actions)                   │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│              WalletBridge                         │
│  (Mobile adapter for WalletAppService)            │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│           Platform Adapters                       │
│  MobileStorageAdapter  │  MobileCryptoAdapter     │
│  (expo-secure-store)   │  (expo-crypto/subtle)    │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│              Core Wallet SDK                      │
│  WalletAppService, Wallet, Providers (../src)     │
└──────────────────────────────────────────────────┘
```

## Scripts

```bash
npm start          # Start Expo dev server
npm run ios        # Run on iOS simulator
npm run android    # Run on Android emulator
npm run build:ios  # Build iOS app
npm run build:android  # Build Android app
npm run lint       # Run ESLint
npm run type-check # Run TypeScript compiler
```

## License

See root [LICENSE](../LICENSE) file.
