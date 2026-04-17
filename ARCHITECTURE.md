# Architecture Documentation

## Project Overview

This is a **multi-platform cryptocurrency wallet** supporting Ethereum (and EVM chains), Bitcoin, Solana, XRP, and TON. The project follows a shared-core architecture where a single SDK (`/src`) is used across three platforms:

1. **CLI** - Node.js command-line interface
2. **Browser Extension** - Chrome extension with React UI
3. **Mobile App** - React Native app built with Expo

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE SDK (/src)                          │
│  Blockchain logic, crypto, wallet management, multi-chain   │
│            support (EVM, Bitcoin, Solana, XRP, TON)         │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────┴────────┬──────────────────┐
    ▼                 ▼                  ▼
┌─────────┐    ┌──────────────┐   ┌─────────────────┐
│   CLI   │    │  Extension   │   │  Mobile Wallet  │
│         │    │              │   │                 │
│ Node.js │    │  Browser     │   │  React Native   │
│ inquirer│    │  React       │   │  Expo           │
└─────────┘    └──────────────┘   └─────────────────┘
```

## Core Architecture Patterns

### 1. Adapter Pattern (Storage & Crypto)

The SDK abstracts platform-specific APIs behind unified interfaces:

#### Storage Adapters

```typescript
interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}
```

**Implementations:**
- `FileStorage` (`/src/storage.ts`) - Node.js fs module
- `MemoryStorage` (`/src/storage.ts`) - In-memory for tests
- `ChromeStorageAdapter` (`/src/chrome-storage.ts`) - chrome.storage.local
- `MobileStorageAdapter` (`/mobile-wallet/services/`) - SecureStore + AsyncStorage

#### Crypto Adapters

```typescript
interface CryptoAdapter {
  randomBytes(length: number): Buffer | Uint8Array;
  pbkdf2Sync(password, salt, iterations, keyLength, digest): Buffer | Uint8Array;
  createCipheriv(algorithm, key, iv): Cipher;
  createDecipheriv(algorithm, key, iv): Decipher;
}
```

**Implementations:**
- `NodeCryptoAdapter` - Node.js crypto module
- `WebCryptoAdapter` - asmcrypto.js for browsers
- `MobileCryptoAdapter` - react-native-quick-crypto (native performance)

### 2. Service Layer (WalletAppService)

**File:** `/src/app-service.ts`

UI-agnostic orchestration layer that provides:
- Wallet lifecycle management (create, import, load, save, delete)
- Token registry management (built-in + custom tokens)
- Network switching with persistence
- Portfolio queries across networks
- Transaction coordination

### 3. Chain-Specific Modules

Each blockchain has isolated modules:

```
src/
├── bitcoin/
│   ├── address.ts       # BIP-44 derivation
│   ├── provider.ts      # Blockchain interaction
│   ├── explorer.ts      # Mempool.space API
│   ├── transaction.ts   # TX building
│   └── types.ts
├── solana/
│   ├── address.ts       # Ed25519 derivation
│   ├── provider.ts      # Solana RPC
│   ├── explorer.ts      # Solscan API
│   ├── transaction.ts   # TX building
│   └── types.ts
├── ethereum/            # EVM chains
├── xrp/                 # XRP Ledger
└── ton/                 # TON blockchain
```

## Platform Integration

### CLI Integration

**Entry Point:** `/src/index.ts`

- Uses `FileStorage` for persistent data
- Uses `NodeCryptoAdapter` for encryption
- Interactive terminal UI with inquirer
- Direct calls to `WalletAppService`

### Browser Extension Integration

**Architecture:**

```
extension/
├── manifest.json              # Manifest V3 configuration
├── background/
│   └── service-worker.ts      # Message handler & wallet state
├── content/
│   ├── injected.ts           # Content script
│   └── provider.ts           # EIP-1193 provider
└── popup/                     # React UI
    ├── App.tsx
    └── components/
```

**Key Features:**
- Background service worker manages wallet state
- Auto-lock after 15 minutes
- Message passing between popup, content, and background
- EIP-1193 provider injection for dApp compatibility
- ChromeStorageAdapter for persistence
- WebCryptoAdapter for browser-safe crypto

### Mobile App Integration

**Framework:** React Native + Expo SDK 54

**Architecture:**

```
mobile-wallet/
├── app/                       # Expo Router (file-based)
│   ├── (auth)/               # Auth flow screens
│   ├── (tabs)/               # Main tab navigation
│   └── [modals]/             # Modal screens
├── services/
│   ├── MobileStorageAdapter.ts
│   ├── MobileCryptoAdapter.ts
│   └── WalletBridge.ts       # Adapter for WalletAppService
└── store/
    └── walletStore.ts         # Zustand state management
```

**Key Features:**
- Native crypto via react-native-quick-crypto (800x faster than JS)
- Secure storage with expo-secure-store (OS Keychain/Keystore)
- Biometric authentication
- NativeWind for styling (Tailwind CSS)
- React Query for data fetching

### Performance Optimization: Mobile Crypto

**Challenge:** PBKDF2 with 100k iterations is ~16 seconds in Hermes JS

**Solution:** Native crypto via JSI (JavaScript Interface)

| Engine | PBKDF2 100k | Implementation |
|--------|-------------|----------------|
| Native C++ (quick-crypto) | **~20ms** | OpenSSL via JSI |
| V8 (Node.js) | ~20ms | JIT optimization |
| Hermes (React Native) | ~16,000ms | AOT bytecode, no optimization |

**Dependencies:**
- `react-native-quick-crypto@0.7.15` - Calls `fastpbkdf2.c` via JSI
- `@craftzdog/react-native-buffer` - Buffer polyfill
- `OpenSSL-Universal` pod - iOS build requirement

## Supported Blockchains

| Blockchain | Type | Networks | Key Derivation |
|------------|------|----------|----------------|
| Ethereum | EVM | Mainnet, Sepolia | BIP-44 (m/44'/60'/0'/0) |
| Layer 2 | EVM | Base, Arbitrum, Optimism, Linea | BIP-44 (m/44'/60'/0'/0) |
| Sidechains | EVM | Polygon, Avalanche, BSC | BIP-44 (m/44'/60'/0'/0) |
| Bitcoin | UTXO | Mainnet, Testnet | BIP-44 (m/44'/0'/0'/0) |
| Solana | Account | Mainnet, Devnet | Ed25519 (m/44'/501'/0'/0') |
| XRP | Ledger | Mainnet, Testnet | BIP-44 (m/44'/144'/0'/0) |
| TON | Account | Mainnet, Testnet | Ed25519 |

## Key Dependencies

### Core SDK (`/src`)

```json
{
  "ethers": "^6.9.0",              // EVM interaction
  "@solana/web3.js": "^1.98.4",    // Solana interaction
  "bitcoinjs-lib": "^7.0.0",       // Bitcoin tx building
  "xrpl": "^4.1.0",                // XRP Ledger
  "@ton/core": "^0.57.0",          // TON blockchain
  "bip39": "^3.1.0",               // Mnemonic generation
  "bip32": "^5.0.0",               // HD key derivation
  "asmcrypto.js": "^2.3.2"         // Browser crypto polyfill
}
```

### Extension (`/extension`)

```json
{
  "react": "^18.2.0",
  "vite": "^5.0.0",
  "@vitejs/plugin-react": "^4.2.0"
}
```

### Mobile (`/mobile-wallet`)

```json
{
  "expo": "~54.0.30",
  "react-native": "0.81.5",
  "expo-router": "~6.0.21",
  "react-native-quick-crypto": "^0.7.15",
  "zustand": "^4.5.0",
  "@tanstack/react-query": "^5.45.0",
  "nativewind": "^4.0.0"
}
```

## Security Architecture

### Encryption

- **Algorithm:** AES-256-GCM
- **Key Derivation:** PBKDF2 with 100,000 iterations
- **Salt:** Random 32-byte salt per wallet
- **IV:** Random 16-byte IV per encryption

### Key Management

- **Mnemonic:** BIP-39 12-word phrase
- **HD Wallet:** BIP-44 hierarchical deterministic wallet
- **Private Keys:** Derived from mnemonic, never stored directly
- **Password:** XOR-obfuscated in memory, cleared on lock

### Session Management

- **Auto-lock:** 15 minutes of inactivity (extension)
- **Biometrics:** Face ID / Touch ID support (mobile)
- **Secure Storage:**
  - CLI: Encrypted JSON files
  - Extension: chrome.storage.local (encrypted)
  - Mobile: expo-secure-store (OS Keychain)

## Network Configuration

Networks are defined in `/config.json`:

```typescript
interface Config {
  network: string;                    // Current network
  defaultNetwork: string;             // Fallback network
  showTestnets: boolean;              // UI visibility toggle
  networks: Record<string, NetworkConfig>;
}

type NetworkConfig =
  | EVMNetworkConfig
  | BitcoinNetworkConfig
  | SolanaNetworkConfig
  | XRPNetworkConfig
  | TonNetworkConfig;
```

### RPC Failover

Networks support multiple RPC URLs for redundancy:

```json
{
  "rpcUrl": [
    "https://primary-rpc.com",
    "https://fallback-rpc.com"
  ]
}
```

## Token Registry

### Built-in Tokens

Defined in `/tokens.json`:

```json
{
  "mainnet": [
    {
      "symbol": "ETH",
      "address": "native",
      "decimals": 18,
      "name": "Ethereum",
      "type": "native"
    }
  ]
}
```

### Custom Tokens

Stored in `/tokens-user.json` (auto-generated)

### Token Interface

```typescript
interface Token {
  symbol: string;
  address: string;           // 'native' or contract address
  decimals: number;
  name: string;
  type?: 'native' | 'erc20';
  icon?: string;             // Asset path
}
```

## Testing Strategy

**27 test files** in `/tests/`:

```
tests/
├── wallet.test.js              # Core wallet operations
├── app-service.test.js         # Service layer
├── crypto-utils.test.js        # Encryption/decryption
├── bitcoin.test.js             # Bitcoin functionality
├── solana.test.js              # Solana functionality
├── xrp.test.js                 # XRP functionality
├── ton.test.js                 # TON functionality
└── [19 more test files]
```

**Coverage:**
- Unit tests with mocked providers
- Integration tests for multi-chain operations
- Headless menu smoke tests
- All tests run offline (no real RPC calls)

## Build Process

### CLI

```bash
npm run build    # tsc → dist/
npm start        # Run compiled code
```

### Extension

```bash
npm run build:extension    # Vite → dist-extension/
npm run watch:extension    # Development mode
```

### Mobile

```bash
npm run ios       # Expo prebuild + run iOS
npm run android   # Expo prebuild + run Android
```

## API Reference

### Core Classes

#### Wallet

Core HD wallet implementation:

```typescript
class Wallet {
  // Lifecycle
  initialize(): Promise<void>;

  // Wallet management
  createNewWallet(password: string): Promise<WalletInfo>;
  importWallet(mnemonic: string, password: string, accountIndex?: number): Promise<WalletInfo>;
  loadWallet(name: string, password: string, accountIndex?: number): Promise<void>;

  // EVM operations
  getAddress(): string;
  getBalance(): Promise<string>;
  sendTransaction(to: string, amount: string): Promise<string>;

  // Bitcoin operations
  getBitcoinAddress(): string;
  getBitcoinBalance(): Promise<number>;
  sendBitcoin(to: string, amountBtc: number): Promise<string>;

  // Solana operations
  getSolanaAddress(): string;
  getSolanaBalance(): Promise<number>;
  sendSolana(to: string, amountSol: number): Promise<string>;

  // XRP operations
  // TON operations
}
```

#### WalletAppService

UI-agnostic orchestration layer:

```typescript
class WalletAppService {
  createWallet(password: string): Promise<WalletInfo>;
  importWallet(mnemonic: string, password: string, index?: number): Promise<WalletInfo>;
  loadWallet(name: string, password: string, index?: number): Promise<void>;

  getTokensForNetwork(networkKey: string): Token[];
  addCustomToken(networkKey: string, token: Token): void;

  setNetwork(networkKey: string, options?): Promise<void>;
  getPortfolioForNetwork(networkKey: string): Promise<TokenBalance[]>;
  sendToken(token: Token, to: string, amount: string): Promise<string>;
}
```

## Extension Message Flow

### dApp Integration (EIP-1193)

```
1. dApp → Provider: window.ethereum.request({ method: 'eth_requestAccounts' })
2. Provider → Content Script: postMessage
3. Content Script → Service Worker: chrome.runtime.sendMessage
4. Service Worker: Process request, show approval UI if needed
5. Service Worker → Content Script: Response
6. Content Script → Provider: postMessage
7. Provider → dApp: Resolve promise
```

### Supported Methods

- `eth_requestAccounts` - Connect wallet
- `eth_accounts` - Get connected accounts
- `eth_chainId` - Get current chain ID
- `eth_sendTransaction` - Send transaction (with approval)
- `personal_sign` - Sign message
- `eth_sign_typed_data_v4` - Sign typed data

## File Structure

```
refactor4/
├── src/                       # Core SDK (shared across all platforms)
│   ├── bitcoin/               # Bitcoin support
│   ├── solana/                # Solana support
│   ├── ethereum/              # EVM support
│   ├── xrp/                   # XRP Ledger support
│   ├── ton/                   # TON support
│   ├── types/                 # TypeScript definitions
│   ├── wallet.ts              # Core wallet class
│   ├── app-service.ts         # Service layer
│   ├── storage.ts             # Storage adapters
│   ├── crypto-utils.ts        # Encryption utilities
│   ├── sdk.ts                 # Node/CLI entry point
│   └── sdk-browser.ts         # Browser/extension entry point
├── extension/                 # Chrome extension
│   ├── manifest.json
│   ├── background/
│   ├── content/
│   └── popup/
├── mobile-wallet/             # React Native app
│   ├── app/                   # Expo Router screens
│   ├── services/              # Platform adapters
│   └── store/                 # State management
├── tests/                     # Test suite (27 files)
├── plans/                     # Design docs & feature plans
├── config.json                # Network configuration
├── tokens.json                # Built-in token registry
└── README.md                  # Main documentation
```

## Environment Variables

### CLI

`.env` file:
```
# Primary: Alchemy (one key covers EVM RPC + Solana RPC + Transfers API)
ALCHEMY_API_KEY=your_key

# Etherscan fallback — only needed for avalanche/bsc/linea tx history
# (Alchemy Transfers doesn't support those chains)
EXPLORER_API_KEY=your_key
EXPLORER_API_KEY_AVALANCHE=optional_specific_key
EXPLORER_API_KEY_BSC=optional_specific_key
EXPLORER_API_KEY_LINEA=optional_specific_key
```

### Extension

`VITE_`-prefixed in `.env`:
```
VITE_ALCHEMY_API_KEY=your_key
VITE_EXPLORER_API_KEY=your_etherscan_key  # for avalanche/bsc/linea only
```

### Mobile

Expo managed via `app.config.js`; reads `ALCHEMY_API_KEY` (or `EXPO_PUBLIC_ALCHEMY_API_KEY`) from root `.env` and ships it via `expo-constants`. Placeholders in `config.json` are substituted in `mobile-wallet/config/bundled-config.ts::applyApiKeysToNetworks`.

## Code Reuse Strategy

- **Core Logic:** 100% shared across platforms (`/src`)
- **Platform Adapters:** Thin wrappers for environment APIs
- **UI Layer:** Platform-specific (React web vs React Native)

**Shared Code Percentage: ~90%**

## Future Enhancements

See `/plans` directory for:
- Token interface standardization
- Mobile wallet improvements
- Price provider refactoring
- Transaction history enhancements
- TON network integration details
