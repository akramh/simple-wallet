# Mobile Wallet Handoff Document

**Date**: December 18, 2024
**Status**: Active Development
**Last Updated By**: Claude (Opus 4.5)

This document provides a comprehensive overview of the mobile wallet codebase for the next developer/agent taking over.

---

## Table of Contents
1. [Current State Summary](#current-state-summary)
2. [Architecture Overview](#architecture-overview)
3. [Navigation Flow](#navigation-flow)
4. [State Management](#state-management)
5. [Services Layer](#services-layer)
6. [Components & Hooks](#components--hooks)
7. [Known Issues & Bugs](#known-issues--bugs)
8. [Incomplete Features](#incomplete-features)
9. [Technical Debt](#technical-debt)
10. [Security Considerations](#security-considerations)
11. [Test Coverage](#test-coverage)
12. [Remaining Tasks](#remaining-tasks)
13. [Quick Reference](#quick-reference)

---

## Current State Summary

The mobile wallet is a React Native/Expo application that provides multi-chain cryptocurrency wallet functionality. It shares core business logic with the CLI and Chrome extension via the shared SDK (`src/`).

### What's Working
- Wallet creation, import, and unlock flows
- Multi-chain support (EVM, Bitcoin, Solana, XRP)
- Balance display and refresh (single network and cross-network)
- Transaction history with filtering
- Send transactions (including XRP destination tags)
- Receive with QR code display
- Network switching
- HD account derivation (multiple accounts per wallet)
- Multiple wallet support
- Biometric authentication (OS-level security via SecureStore)
- Auto-lock after 15 minutes
- Price fetching and portfolio valuation

### What's Not Working / Incomplete
- Swap functionality (button disabled)
- Buy crypto functionality (button disabled)
- Change password feature (stubbed)
- Add custom network (button exists, no handler)
- dApp connections / WalletConnect
- Deep linking
- Push notifications

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React Native UI                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Expo Router (File-based)                   ││
│  │  app/(auth)/*  │  app/(tabs)/*  │  app/*.tsx (modals)   ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Zustand Store (walletStore.ts)             ││
│  │         + Optimized Selectors (selectors.ts)            ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              WalletBridge Service                        ││
│  │         (Adapts shared SDK to React Native)             ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│           ┌────────────────┼────────────────┐               │
│           ▼                ▼                ▼               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │MobileStorage │ │MobileCrypto  │ │ Shared SDK   │        │
│  │  Adapter     │ │  Adapter     │ │ (@wallet/*)  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│         │                │                                   │
│         ▼                ▼                                   │
│  ┌──────────────┐ ┌──────────────┐                         │
│  │AsyncStorage  │ │quick-crypto  │                         │
│  │SecureStore   │ │(C++ JSI)     │                         │
│  └──────────────┘ └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root layout, initializes wallet store |
| `app/index.tsx` | Entry routing logic (welcome/unlock/main) |
| `store/walletStore.ts` | Global Zustand state (~500 lines) |
| `store/selectors.ts` | Optimized selectors with `useShallow` |
| `services/WalletBridge.ts` | Core service adapter (~1200 lines) |
| `services/MobileStorageAdapter.ts` | AsyncStorage + SecureStore |
| `services/MobileCryptoAdapter.ts` | Native crypto via quick-crypto |
| `hooks/useBiometrics.ts` | OS-level biometric auth |

---

## Navigation Flow

```
App Start
    │
    ▼
_layout.tsx (initialize store)
    │
    ▼
index.tsx (routing decision)
    │
    ├─── isLoading? ──────────► Loading spinner
    │
    ├─── !hasWallet? ─────────► /(auth)/welcome
    │                                │
    │                    ┌───────────┴───────────┐
    │                    ▼                       ▼
    │              create.tsx              import.tsx
    │                    │                       │
    │                    ▼                       │
    │              backup.tsx                    │
    │                    │                       │
    │                    └───────────┬───────────┘
    │                                ▼
    ├─── !isUnlocked? ────────► /(auth)/unlock
    │                                │
    │                                ▼
    └─── else ────────────────► /(tabs)/wallet
                                     │
                        ┌────────────┼────────────┐
                        ▼            ▼            ▼
                   activity.tsx  portfolio.tsx  profile.tsx

Modal Screens (presented over tabs):
- send.tsx (3-step wizard)
- receive.tsx (QR + address)
- network-select.tsx
- secret-phrase.tsx (password-gated)
- wallet-manage.tsx
- account-manage.tsx
```

---

## State Management

### Zustand Store Structure

```typescript
// store/walletStore.ts
interface WalletStoreState {
  // Core session state
  isLoading: boolean;
  isInitialized: boolean;
  isUnlocked: boolean;
  hasWallet: boolean;
  error: string | null;

  // Current wallet/network/account
  network: string;
  address: string | null;
  currentWalletName: string | null;
  currentAccountIndex: number;

  // Lists
  walletList: WalletInfo[];
  accounts: AccountInfo[];
  networks: Record<string, NetworkConfig>;
  enabledNetworks: string[];

  // Balances & Prices
  balances: TokenBalance[];
  isRefreshingBalances: boolean;
  balancesLastUpdated: number | null;
  prices: Record<string, number>;
  totalValue: number;
  formattedTotal: string;
  isLoadingPrices: boolean;

  // Cross-network portfolio
  allNetworkHoldings: any[];  // ⚠️ NEEDS TYPING
  allNetworkTotals: { totalValue: number; formattedTotal: string };

  // Transactions
  transactions: Transaction[];
  isLoadingTransactions: boolean;
  transactionFilter: 'all' | 'sent' | 'received';
  transactionsLastUpdated: number | null;
}
```

### Selector Pattern

The app uses optimized selectors to prevent re-renders:

```typescript
// BAD - subscribes to entire store
const { balances, network } = useWalletStore();

// GOOD - subscribes to specific slice
const balances = useBalancesSelector();
const network = useNetworkSelector();

// BEST - screen-specific composite
const { address, balances, network, refreshBalances } = useWalletScreenSelector();
```

**Available Screen Selectors:**
- `useWalletScreenSelector` - Main wallet tab
- `useActivityScreenSelector` - Transaction history
- `usePortfolioScreenSelector` - Portfolio view
- `useProfileScreenSelector` - Settings
- `useSendScreenSelector` - Send modal
- `useUnlockScreenSelector` - Unlock screen
- `useNetworkSelectScreenSelector` - Network picker

---

## Services Layer

### WalletBridge (`services/WalletBridge.ts`)

The bridge adapts the shared SDK to React Native:

```typescript
class WalletBridge {
  // Session management
  private sessionPassword: string | null = null;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private autoLockTimeoutMs = 15 * 60 * 1000; // 15 min

  // Core operations
  async createWallet(password, name?): Promise<CreateWalletResult>
  async importWallet(mnemonic, password, name?): Promise<ImportWalletResult>
  async unlockWallet(password, name?): Promise<UnlockWalletResult>
  async lockWallet(): Promise<void>

  // Balances & Prices
  async refreshBalances(): Promise<TokenBalance[]>
  async getTokenPrices(balances): Promise<PriceResult>

  // Transactions
  async getTransactions(): Promise<Transaction[]>
  async sendTransaction(token, to, amount, destTag?): Promise<TxResult>
  async getGasEstimate(token, to, amount): Promise<GasEstimate>

  // Account management
  async getAccounts(): Promise<AccountsResult>
  async createAccount(): Promise<AccountResult>
  async switchAccount(index): Promise<void>

  // Security
  async getSecretPhrase(password): Promise<string>
  async getPrivateKey(password): Promise<string>
}

export const walletBridge = new WalletBridge(); // Singleton
```

### Mobile Adapters

**MobileStorageAdapter:**
- `AsyncStorage` for non-sensitive data (config, tx history, cache)
- `SecureStore` for wallet blobs (encrypted mnemonic)
- In-memory cache for sync reads required by SDK

**MobileCryptoAdapter:**
- Uses `react-native-quick-crypto` (C++ via JSI) for PBKDF2
- **Critical**: Standard JS PBKDF2 takes ~16s on Hermes, quick-crypto takes ~20ms
- Falls back to `@noble/hashes` in Jest tests

---

## Components & Hooks

### Reusable Components (`components/`)

| Component | Purpose |
|-----------|---------|
| `Button` | Primary/secondary/ghost/danger variants |
| `Input` | Password toggle, icons, error states |
| `Toast` | Animated notifications (success/error/info) |
| `EmptyState` | Generic empty state with icon |
| `NetworkBadge` | Network name + testnet indicator |
| `QRCode` | QR code display |
| `TokenCard` | Token with icon + balance |
| `TransactionDetailsModal` | Full tx details with explorer links |

### Custom Hooks (`hooks/`)

| Hook | Purpose |
|------|---------|
| `useWallet` | Facade over store, truncated address |
| `useBalances` | Auto-refresh, staleness check, helpers |
| `useTransaction` | Gas estimation, send with auto-refresh |
| `useBiometrics` | OS-level biometric auth |
| `useClipboard` | Copy/paste with haptic feedback |

---

## Known Issues & Bugs

### Critical
1. **`allNetworkHoldings: any[]`** - Missing type definition (line 74 in walletStore.ts)
2. **Gas estimation errors silent** - `send.tsx` line 76 only logs to console, no user feedback

### High Priority
3. **Block explorer URLs hardcoded** - `TransactionDetailsModal` has hardcoded URLs for Etherscan, Mempool, Solscan - fails for testnets/custom networks
4. **No network timeout handling** - API calls can hang indefinitely
5. **No error boundaries** - Screen crashes not caught
6. **Transaction list not paginated** - Performance issue with 100+ transactions

### Medium Priority
7. **"Forgot password?"** navigates to import - Should show recovery instructions first
8. **24h portfolio change hardcoded** - Shows "+0.00%" always (`portfolio.tsx` line 57)
9. **QR scanner stays open after scan** - No visual feedback on successful scan
10. **No input sanitization** - Address validation only checks length

### Low Priority
11. **Inline component definitions** - Many screens define components inline
12. **Magic strings scattered** - Network keys, storage keys not centralized
13. **Inconsistent error logging** - Mix of console.error patterns

---

## Incomplete Features

| Feature | Location | Status |
|---------|----------|--------|
| Swap | `wallet.tsx` lines 115-124 | Button disabled |
| Buy crypto | `wallet.tsx` lines 115-124 | Button disabled |
| Change password | `profile.tsx` line 232 | Stubbed, no implementation |
| Theme switcher | `profile.tsx` line 242 | Only "Dark" shown |
| Currency selector | `profile.tsx` line 249 | Only "USD" shown |
| Connected apps | `profile.tsx` line 210 | No dApp connection UI |
| Add custom network | `network-select.tsx` line 89 | Button exists, no handler |
| Deep linking | - | Not implemented |
| Push notifications | - | Not implemented |
| WalletConnect | - | Not implemented |

---

## Technical Debt

### Type Safety
- `any` types in WalletBridge (~51 instances across mobile-wallet)
- `allNetworkHoldings` untyped
- Some error messages use `as any` casting

### Code Organization
- WalletBridge is ~1200 lines (should split by domain)
- walletStore is ~500 lines (should split into slices)
- Inline components in screens should be extracted
- Repeated formatting logic (address truncation, dates, currency)

### Missing Abstractions
- No centralized constants file
- No formatting utilities module
- No error handling utilities
- No API timeout/retry logic

---

## Security Considerations

### Implemented
- Session password in memory only, cleared on lock
- Auto-lock after 15 minutes inactivity
- Biometric auth via OS-level SecureStore (`requireAuthentication: true`)
- iOS: Keychain with `kSecAccessControlBiometryAny`
- Android: Keystore with biometric-gated keys (API 23+)
- Keys invalidated when biometric settings change
- Mnemonic never stored in app state (only encrypted blob in SecureStore)

### Missing/Recommended
- **Screenshot prevention** - Use `FLAG_SECURE` on Android, `UIScreen.capturedDidChangeNotification` on iOS for sensitive screens
- **Copy warning** - No warning when copying sensitive data (address, mnemonic)
- **Recovery phrase timeout** - Phrase display has no auto-hide timeout
- **Clipboard clearing** - Sensitive data stays in clipboard indefinitely
- **Jailbreak/root detection** - No detection implemented

---

## Test Coverage

### Current Coverage
- 11 test files, 60 tests passing
- ~1300 lines of test code

### What's Tested
- `walletStore.test.ts` - Store actions and state transitions
- `selectors.test.ts` - Selector isolation and composition
- `WalletBridge.test.ts` - Service methods
- `useWallet.test.tsx` - Hook behavior
- `useBalances.test.tsx` - Balance hook
- `useTransaction.test.tsx` - Transaction hook
- `useBiometrics.test.tsx` - Biometric flow
- `useClipboard.test.tsx` - Clipboard operations
- `MobileStorageAdapter.test.ts` - Storage adapter
- `MobileCryptoAdapter.test.ts` - Crypto adapter
- `activityScreen.test.ts` - Activity screen logic

### What's NOT Tested
- Component rendering (NativeWind className issues in Jest)
- Screen integration tests
- Navigation flow tests
- Error boundary behavior
- Multi-network scenarios
- Edge cases (gas estimation failure, network timeout)

---

## Remaining Tasks

### From Original Analysis (Pending)
1. **Split WalletBridge and walletStore** - Break into domain modules (auth, transactions, balances, network)
2. **Eliminate `any` types** - Add proper type definitions
3. **Add error boundaries** - Catch and handle screen crashes
4. **Extract formatting utilities** - Consolidate address/date/currency formatting

### Recommended Additions
5. **Add pagination** to transaction list
6. **Implement retry logic** for failed API calls
7. **Add network timeout handling**
8. **Implement deep linking**
9. **Add screenshot prevention** for sensitive screens
10. **Create component tests** (mock NativeWind properly)

---

## Quick Reference

### Running the App
```bash
cd mobile-wallet
npm install
npx expo prebuild --clean  # Required for native modules
npm run ios    # or npm run android
```

### Running Tests
```bash
cd mobile-wallet
npm test
```

### Type Checking
```bash
cd mobile-wallet
npm run typecheck
```

### Key Environment Variables
- None currently required (RPC endpoints in config.json)

### Metro Config Notes
- Path aliases: `@wallet/*` → `../src/*`
- Stubs in `stubs/` for Node-only modules
- Crypto polyfill loaded in `index.js`

### Common Issues
1. **PBKDF2 slow** - Ensure `react-native-quick-crypto` is installed and prebuild ran
2. **Metro resolution** - Clear cache: `npx expo start -c`
3. **SecureStore errors** - Requires real device or properly configured simulator

---

## File Locations Quick Reference

```
mobile-wallet/
├── app/
│   ├── _layout.tsx          # Root layout
│   ├── index.tsx            # Entry routing
│   ├── (auth)/              # Auth screens
│   │   ├── welcome.tsx
│   │   ├── create.tsx
│   │   ├── import.tsx
│   │   ├── backup.tsx
│   │   └── unlock.tsx
│   ├── (tabs)/              # Main app tabs
│   │   ├── wallet.tsx
│   │   ├── activity.tsx
│   │   ├── portfolio.tsx
│   │   └── profile.tsx
│   ├── send.tsx             # Send modal
│   ├── receive.tsx          # Receive modal
│   ├── network-select.tsx   # Network picker
│   ├── secret-phrase.tsx    # View mnemonic
│   ├── wallet-manage.tsx    # Wallet management
│   └── account-manage.tsx   # Account management
├── components/              # Reusable UI
├── hooks/                   # Custom hooks
├── store/
│   ├── walletStore.ts       # Zustand store
│   ├── selectors.ts         # Optimized selectors
│   └── index.ts             # Barrel export
├── services/
│   ├── WalletBridge.ts      # Core service
│   ├── MobileStorageAdapter.ts
│   ├── MobileCryptoAdapter.ts
│   └── price-service.ts     # Re-exports from SDK
├── contexts/
│   └── ToastContext.tsx     # Toast provider
├── __tests__/               # Jest tests
├── stubs/                   # Node module stubs
├── metro.config.js          # Bundler config
└── jest.setup.js            # Test setup
```

---

*This document should be updated as changes are made to the codebase.*
