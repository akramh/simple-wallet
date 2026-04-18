# Mobile App

The mobile app is an Expo + React Native wallet in `mobile-wallet/`. It uses
expo-router, Zustand, React Query, NativeWind, SecureStore, AsyncStorage, and
native crypto through `react-native-quick-crypto`.

## Commands

Run from `mobile-wallet/`:

```bash
npm start
npm run ios
npm run android
npm run web
npm run typecheck
npm run lint
npm test
```

E2E:

```bash
npm run e2e:ios:build
npm run e2e:ios:test
```

## Native Builds

Wallet unlock uses native crypto for PBKDF2 performance. Use a development
build for real wallet flows:

```bash
npx expo prebuild --clean
npm run ios
```

Expo Go does not provide the native crypto environment required for full wallet
functionality.

## Architecture

```text
mobile-wallet/app/          expo-router screens
mobile-wallet/store/        Zustand state
mobile-wallet/hooks/        React hooks
mobile-wallet/services/     platform adapters and WalletBridge
mobile-wallet/components/   reusable UI components
```

Important services:

- `services/WalletBridge.ts`: adapts `WalletAppService` to mobile workflows
- `services/MobileStorageAdapter.ts`: routes sensitive data to SecureStore and
  non-sensitive data to AsyncStorage
- `services/MobileCryptoAdapter.ts`: uses `react-native-quick-crypto` first,
  with fallbacks for test and limited runtime contexts
- `services/crypto-polyfill.js`: initializes crypto globals

`mobile-wallet/index.js` must load crypto and Buffer polyfills before
`expo-router/entry`.

## Storage Policy

- Encrypted wallet data is sensitive and belongs in SecureStore.
- Non-sensitive cache and UI state can use AsyncStorage.
- Session state should be cleared on lock.
- Do not persist mnemonic or private-key material in plaintext.

## Environment

Mobile config reads environment variables through `mobile-wallet/app.config.js`
and exposes them via Expo Constants:

- `ALCHEMY_API_KEY` or `EXPO_PUBLIC_ALCHEMY_API_KEY`
- `COINGECKO_API_KEY`
- `EXPLORER_API_KEY`
- `EXPLORER_API_KEY_SOLANA_MAINNET` and `EXPLORER_API_KEY_SOLANA_DEVNET`
  are still loadable but effectively unused by current Solana runtime paths
- `TONCENTER_API_KEY_TON_MAINNET` and `TONCENTER_API_KEY_TON_TESTNET`
- `HELIUS_API_KEY` only for legacy config placeholders

See [external APIs and environment variables](../external-apis-and-env.md).

## Tests

Use Jest for stores, hooks, services, and UI behavior:

```bash
npm test
npm test -- __tests__/walletStore.test.ts
npm test -- -t "<name pattern>"
```

Use Detox only for small user-flow smoke tests.
