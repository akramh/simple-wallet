# Simple Crypto Wallet - Mobile App

React Native mobile app for multi-chain cryptocurrency wallet management. Built with Expo for iOS and Android, supporting Ethereum (EVM chains), Bitcoin, Solana, XRP, and TON.

## Tech Stack

- **Framework**: [Expo SDK 54](https://expo.dev/) + React Native 0.81.5
- **Navigation**: [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing)
- **Styling**: [NativeWind](https://www.nativewind.dev/) (Tailwind CSS for React Native)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) + [React Query](https://tanstack.com/query)
- **Storage**: `expo-secure-store` (encrypted) + `@react-native-async-storage/async-storage`
- **Crypto**: `react-native-quick-crypto` (native performance via JSI)
- **Authentication**: `expo-local-authentication` (biometrics)

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

## Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (Mac) or Android Emulator/Device
- Xcode (for iOS development)
- Android Studio (for Android development)

### Installation

1. Clone the repository and navigate to the mobile-wallet directory:
```bash
git clone <repository-url>
cd simple-wallet/mobile-wallet
npm install
```

2. Prebuild native modules (required after fresh install or dependency changes):
```bash
npx expo prebuild --clean
```

### Development

```bash
# Start Expo development server
npm start

# Run on iOS (requires Mac with Xcode)
npm run ios

# Run on Android (requires Android Studio or connected device)
npm run android

# Run in Expo Go app (limited crypto functionality)
# Note: Native crypto requires development build, not Expo Go
```

### Building for Production

```bash
# Build for iOS
npm run build:ios

# Build for Android
npm run build:android
```

## Features

### Multi-Chain Support
- **Ethereum & EVM Chains** - Mainnet, Sepolia, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, Linea
- **Bitcoin** - Mainnet and Testnet
- **Solana** - Mainnet and Devnet
- **XRP** - XRP Ledger Mainnet and Testnet
- **TON** - TON blockchain Mainnet and Testnet

### Wallet Features
- Create new wallet with BIP-39 mnemonic
- Import existing wallet
- Biometric authentication (Face ID / Touch ID)
- Multi-account support (HD wallet)
- Secure storage with OS Keychain/Keystore

### Transaction Features
- Send native tokens (ETH, BTC, SOL, XRP, TON)
- Send ERC-20 tokens
- QR code generation for receiving
- QR code scanning for sending
- Transaction history
- Real-time balance updates
- Background transaction notifications (approx. 15 min interval)

### User Experience
- Pull-to-refresh balances
- Network visibility toggle (hide testnets)
- Token visibility management
- Portfolio view with USD values
- Activity feed
- Dark mode support

## Integration with Core SDK

The mobile app shares the core wallet SDK (`../src/`) via platform adapters:

1. **WalletBridge** (`services/WalletBridge.ts`) - Provides the same API as the extension's service worker
2. **MobileStorageAdapter** (`services/MobileStorageAdapter.ts`) - Implements `StorageAdapter` using expo-secure-store
3. **MobileCryptoAdapter** (`services/MobileCryptoAdapter.ts`) - Implements `CryptoAdapter` using react-native-quick-crypto

This architecture enables ~90% code reuse with the CLI and browser extension.

## Performance Optimization: Native Crypto

### The Problem

React Native's Hermes engine is optimized for fast app startup (AOT compilation) but is extremely slow for CPU-intensive cryptographic operations:

| Engine | PBKDF2 (100k iterations) | Performance |
|--------|--------------------------|-------------|
| Native C++ (quick-crypto) | **~20ms** | OpenSSL optimizations |
| V8 (Node.js) | ~20ms | JIT optimization |
| Hermes (React Native) | ~16,000ms | **800x slower!** |

### The Solution

We use `react-native-quick-crypto@0.7.15` (same approach as MetaMask):

- Calls native `fastpbkdf2.c` via JSI (JavaScript Interface)
- Native C++ code runs at full CPU speed
- Uses OpenSSL hardware acceleration
- **Result:** Wallet unlock is instant (~20ms) instead of 16+ seconds

### Why Hermes is Slow for Crypto

- PBKDF2 with 100k iterations = 200k+ SHA256 operations
- Each SHA256 has 64 rounds of bitwise operations
- Pure JavaScript in Hermes doesn't benefit from JIT
- AOT compilation doesn't optimize CPU-intensive loops

### Dependencies

```json
{
  "react-native-quick-crypto": "^0.7.15",
  "@craftzdog/react-native-buffer": "^2.0.0"
}
```

**iOS:** Requires `OpenSSL-Universal` pod (auto-installed via prebuild)

### After Updating Dependencies

Always rebuild native modules:
```bash
npx expo prebuild --clean
```

## Module Resolution Configuration

The app imports the shared SDK from `../src/` via Metro bundler configuration:

**`metro.config.js`:**
```javascript
config.resolver.extraNodeModules = {
  '@wallet': path.resolve(__dirname, '../src'),
};
config.watchFolders = [
  path.resolve(__dirname, '../src'),
];
```

**Import example:**
```typescript
import { Wallet, WalletAppService } from '@wallet/sdk';
```

## Implementation Status

### Core Features ✅
- Project scaffolding (Expo SDK 54, NativeWind, TypeScript)
- Platform adapters (MobileStorageAdapter, MobileCryptoAdapter with native crypto)
- WalletBridge service layer integrated with core SDK
- Zustand store with wallet state management
- Navigation shell (expo-router tabs + stacks + modals)
- Auth flow screens (welcome, create, import, unlock, backup)
- Main tab screens (wallet, activity, portfolio, profile)
- Modal screens (send, receive with QR, network-select)
- Reusable UI components (Button, Input, TokenCard, etc.)
- Custom hooks (useWallet, useBalances, useTransaction)
- Biometric authentication (Face ID / Touch ID)
- QR code generation for receive address
- Clipboard with haptic feedback
- Multi-chain support (EVM, Bitcoin, Solana, XRP, TON)
- Token visibility management
- Network visibility toggle (hide testnets)
- Pull-to-refresh balances
- Real-time portfolio pricing

### Future Enhancements
- QR code scanning for send addresses
- WalletConnect integration
- dApp browser
- Hardware wallet support
- Advanced transaction history filtering
- Fiat on-ramp integration

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

## Available Scripts

```bash
# Development
npm start                # Start Expo dev server
npm run ios             # Run on iOS simulator
npm run android         # Run on Android emulator

# Production builds
npm run build:ios       # Build iOS app
npm run build:android   # Build Android app

# Code quality
npm run lint            # Run ESLint
npm run type-check      # Run TypeScript compiler
npm test                # Run unit tests

# Native modules
npx expo prebuild       # Generate native projects
npx expo prebuild --clean  # Clean rebuild native modules
```

## Security Best Practices

**IMPORTANT:** This is a development wallet. For production use:
- Use strong, unique passwords (12+ characters)
- Back up your recovery phrase securely offline
- Never share private keys or mnemonics
- Test on testnets before using mainnet
- Verify addresses before sending transactions
- Enable biometric authentication for added security

**For Production Deployment:**
- Implement rate limiting for failed unlock attempts
- Add transaction simulation before signing
- Implement app attestation (iOS/Android)
- Add certificate pinning for RPC endpoints
- Perform professional security audit
- Consider integrating with hardware security modules

## Related Documentation

- **[Root README](../README.md)** - Project overview and features
- **[Architecture Guide](../ARCHITECTURE.md)** - Technical architecture and design patterns
- **[API Reference](../API_REFERENCE.md)** - SDK API documentation
- **[Extension README](../extension/README.md)** - Browser extension setup

## License

MIT - See root [LICENSE](../LICENSE) file.
