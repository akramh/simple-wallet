# Simple Crypto Wallet

A command-line Ethereum wallet and Chrome extension supporting testnet and mainnet operations, written in TypeScript with full type safety. Also provides a programmatic SDK for integration into browser extensions, mobile apps, and other applications.

## Features

- 🆕 Create new wallet with 12-word mnemonic phrase
- 📥 Import existing wallet from mnemonic
- 💰 Check wallet balance (ETH + ERC-20 tokens)
- 📤 Send ETH or ERC-20 token transactions
- 📥 Display receive address
- ⚙️ Switch between Sepolia testnet and Ethereum mainnet
- 🔒 Password-protected wallet encryption
- 🔄 Multi-network support (Ethereum, Polygon, Base, Arbitrum, Optimism, etc.)
- 💼 Multi-account support (BIP-44 HD wallet)
- 📦 Token management (add custom ERC-20 tokens)
- 🛡️ Atomic file writes with automatic backups
- 🔁 RPC failover with retry mechanism

## Installation

```bash
npm install
```

## Usage

### Development (TypeScript)

Run TypeScript directly without building:

```bash
npm run dev
```

### Production

Build and run the compiled JavaScript:

```bash
# Build TypeScript to JavaScript
npm run build

# Run the compiled code
npm start
```

Or simply:

```bash
npm start
```

(This will automatically build first)

### Type Checking

Check types without building:

```bash
npm run type-check
```

## Testing

Run the automated tests (unit + headless menu smoke tests):

```bash
npm test
```

These tests run offline with mocked providers/contracts and stubbed prompts (no real RPC calls). The CLI is suppressed when `NODE_ENV=test`.

**All 9 tests passing:** ✅
- Crypto utilities (password validation, encryption/decryption)
- Balance checking and portfolio aggregation
- Network switching
- RPC failover mechanism
- Token metadata caching
- Transaction validation

## Configuration

Edit `config.json` to change the default network or add custom RPC endpoints:

```json
{
  "network": "sepolia",
  "networks": {
    "sepolia": {
      "name": "Sepolia Testnet",
      "rpcUrl": "https://rpc.sepolia.org",
      "chainId": 11155111
    },
    "mainnet": {
      "name": "Ethereum Mainnet",
      "rpcUrl": "https://eth.llamarpc.com",
      "chainId": 1
    }
  }
}
```

## Security Notes

⚠️ **IMPORTANT SECURITY WARNINGS:**

1. **Never share your mnemonic phrase** - Anyone with your mnemonic can access your funds
2. **Back up your mnemonic** - Store it securely offline
3. **Keep wallet.json secure** - This file contains sensitive data
4. **Use testnet first** - Test all operations on Sepolia before using mainnet
5. **This is a demo wallet** - For production use, consider hardware wallets or established solutions

## Getting Testnet ETH

To test the wallet on Sepolia testnet:
- Visit a Sepolia faucet (search "Sepolia faucet")
- Enter your wallet address
- Receive free test ETH

## Switching Networks

Use the "Change Network" option in the menu to switch between Sepolia testnet and Ethereum mainnet. The application will restart after changing networks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Interfaces                                 │
├─────────────────────────────┬───────────────────────────────────────────────┤
│      CLI (index.ts)         │           Chrome Extension                    │
│   - Interactive menus       │         - React UI (popup/)                   │
│   - Terminal prompts        │         - Service worker                      │
└─────────────┬───────────────┴───────────────────────┬───────────────────────┘
              │                                       │
              ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WalletAppService (app-service.ts)                        │
│              UI-agnostic orchestration layer for all wallet ops             │
│   - Wallet lifecycle (create, import, load, save, delete)                   │
│   - Token registry (built-in + custom tokens)                               │
│   - Network switching with persistence                                      │
│   - Portfolio queries and transaction sending                               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────────────┐
│  Wallet (wallet.ts) │ │ Storage Adapters    │ │ ExplorerAPI                 │
│  - BIP-44 HD wallet │ │ - FileStorage       │ │ - Etherscan V2 API          │
│  - AES-256-GCM      │ │ - MemoryStorage     │ │ - Transaction history       │
│  - RPC failover     │ │ - ChromeStorage     │ │ - Result caching            │
│  - Token operations │ └─────────────────────┘ └─────────────────────────────┘
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌──────────────────┐
│ Crypto   │ │ Provider Factory │
│ Utils    │ │ (providers.ts)   │
│ - PBKDF2 │ │ - ethers.js v6   │
│ - AES    │ │ - RPC connection │
└────┬─────┘ └──────────────────┘
     │
     ▼
┌─────────────────────────────────┐
│ CryptoAdapter                   │
│ - NodeCryptoAdapter (Node.js)   │
│ - WebCryptoAdapter (Browser)    │
└─────────────────────────────────┘
```

## Project Structure

```
simple-wallet/
├── src/                       # TypeScript source files
│   ├── types/                 # Type definitions
│   │   ├── config.ts          # Network & token types
│   │   ├── wallet.ts          # Wallet & transaction types
│   │   └── index.ts           # Type exports
│   ├── index.ts               # CLI entry point with menus
│   ├── wallet.ts              # Core HD wallet implementation
│   ├── app-service.ts         # UI-neutral service layer
│   ├── storage.ts             # Storage adapters (File/Memory)
│   ├── providers.ts           # Provider factory abstraction
│   ├── crypto-utils.ts        # Encryption utilities
│   ├── crypto-adapter.ts      # Node + WebCrypto adapters
│   ├── explorer-api.ts        # Block explorer integration
│   ├── ui-helpers.ts          # Terminal UI formatting
│   ├── sdk.ts                 # SDK entry for Node/CLI
│   └── sdk-browser.ts         # SDK entry for browser/extension
├── extension/                 # Chrome extension source
│   ├── manifest.json          # Extension manifest
│   ├── background/            # Service worker
│   ├── content/               # Content scripts
│   ├── sidepanel/             # Side panel UI
│   └── popup/                 # React components
├── dist/                      # Compiled JavaScript (generated)
├── dist-extension/            # Extension build (generated)
├── tests/                     # Test files
│   ├── wallet.test.js         # Wallet class tests
│   ├── app-service.test.js    # Service layer tests
│   ├── crypto-utils.test.js   # Encryption tests
│   ├── storage.test.js        # Storage adapter tests
│   └── menu.test.js           # CLI menu tests
├── config.json                # Network configuration
├── tokens.json                # Built-in ERC-20 token registry
├── tokens-user.json           # User-added custom tokens (auto-generated)
├── wallets.json               # Encrypted wallet storage (auto-generated)
├── tsconfig.json              # TypeScript configuration
├── vite.config.extension.ts   # Extension build config
├── package.json               # Dependencies and scripts
└── .gitignore                 # Protects sensitive files from git
```

## TypeScript Features

This project uses TypeScript with:
- ✅ **Strict Mode Enabled** - Maximum type safety
- ✅ **Full Type Coverage** - All functions and variables typed
- ✅ **Generic Types** - Type-safe JSON operations
- ✅ **Type Guards** - Proper error handling
- ✅ **Source Maps** - Easy debugging
- ✅ **Declaration Files** - Type definitions for consumers

## Programmatic SDK (for browser/extension/mobile)

You can use the wallet logic without the CLI via the SDK entries:

- Node/CLI: `import { WalletAppService, FileStorage, createProviderFactory } from 'simple-crypto-wallet/sdk'`
- Browser/extension: `import { WalletAppService, MemoryStorage } from 'simple-crypto-wallet/sdk-browser'`

Key building blocks:
- **Wallet**: core ETH + ERC-20 logic, accepts `StorageAdapter` + `ProviderFactory`
- **WalletAppService**: UI-neutral orchestration (tokens, networks, wallet lifecycle)
- **StorageAdapter**: `FileStorage` (Node) or `MemoryStorage` (for tests/browser); implement your own for IndexedDB/etc.
- **ProviderFactory**: supplies ethers providers; swap in custom providers for testing or CSP requirements
- **Crypto adapters**: default Node crypto; swap to WebCrypto with `setCryptoAdapter(createWebCryptoAdapter())`

Example (Node):
```ts
import { Wallet, WalletAppService, FileStorage, createProviderFactory } from 'simple-crypto-wallet/sdk';
import config from './config.json' assert { type: 'json' };

const storage = new FileStorage();
const wallet = new Wallet(config, storage, createProviderFactory());
const svc = new WalletAppService(wallet, config, { storage });
await svc.initialize();
```

Example (browser/extension):
```ts
import { Wallet, WalletAppService, MemoryStorage, createProviderFactory } from 'simple-crypto-wallet/sdk-browser';
import config from './config.json';

const storage = new MemoryStorage(); // replace with your own persistent adapter
const wallet = new Wallet(config, storage, createProviderFactory());
const svc = new WalletAppService(wallet, config, { storage });
await svc.initialize();
```

Testing tips:
- Use `MemoryStorage` to keep tests hermetic.
- Inject a custom `ProviderFactory` with mocked providers to avoid network calls.

## API Reference

### Core Classes

#### `Wallet`

The core HD wallet implementation for Ethereum and EVM-compatible chains.

```typescript
import { Wallet, FileStorage, createProviderFactory } from 'simple-crypto-wallet/sdk';

const wallet = new Wallet(config, new FileStorage(), createProviderFactory());
await wallet.initialize();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `initialize()` | Set up RPC provider connection. Call before any blockchain ops. |
| `createNewWallet(password)` | Create new HD wallet with random mnemonic. Returns `{ address, mnemonic, privateKey }`. |
| `importWallet(mnemonic, password, accountIndex?)` | Import wallet from BIP-39 mnemonic. |
| `loadWallet(name, password, accountIndex?)` | Load and decrypt wallet from storage. |
| `saveWallet(name?)` | Save current wallet to storage. |
| `deleteWallet(name)` | Remove wallet from storage. |
| `switchAccount(index)` | Switch to different BIP-44 account. |
| `getAddress()` | Get current wallet address. |
| `getBalance()` | Get native currency balance (ETH). |
| `getTokenBalance(token)` | Get ERC-20 token balance. |
| `getPortfolio(tokens)` | Get balances for multiple tokens. |
| `sendTransaction(to, amount)` | Send native currency. |
| `sendToken(token, to, amount)` | Send ERC-20 token. |
| `getTokenMetadata(address)` | Fetch on-chain token metadata. |
| `exportWallet(name, path)` | Export wallet to backup file. |
| `importFromBackup(path, password)` | Import wallet from backup. |
| `getPrivateKey(password)` | Get private key (requires password). |
| `getMnemonic(password)` | Get mnemonic phrase (requires password). |

#### `WalletAppService`

UI-agnostic orchestration layer that wraps `Wallet` with token registry and network management.

```typescript
import { WalletAppService, Wallet, FileStorage } from 'simple-crypto-wallet/sdk';

const storage = new FileStorage();
const wallet = new Wallet(config, storage);
const service = new WalletAppService(wallet, config, { storage });
await service.initialize();
```

**Methods:**

| Method | Description |
|--------|-------------|
| `createWallet(password)` | Create new wallet. |
| `importWallet(mnemonic, password, index?)` | Import from mnemonic. |
| `loadWallet(name, password, index?)` | Load saved wallet. |
| `saveWallet(name?)` | Save current wallet. |
| `getTokensForNetwork(networkKey)` | Get all tokens (native + ERC-20) for a network. |
| `addCustomToken(networkKey, token)` | Add custom ERC-20 token. |
| `removeCustomToken(networkKey, address)` | Remove custom token. |
| `findTokenBySymbol(networkKey, symbol)` | Find token by symbol. |
| `setNetwork(networkKey, options?)` | Switch blockchain network. |
| `getPortfolioForNetwork(networkKey)` | Get all token balances. |
| `sendToken(token, to, amount)` | Send token transaction. |

### Storage Adapters

#### `StorageAdapter` (Interface)

```typescript
interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}
```

#### `FileStorage`

File system-backed storage for Node.js/CLI.

```typescript
import { FileStorage } from 'simple-crypto-wallet/sdk';
const storage = new FileStorage();
```

#### `MemoryStorage`

In-memory storage for tests or ephemeral sessions.

```typescript
import { MemoryStorage } from 'simple-crypto-wallet/sdk';
const storage = new MemoryStorage();
```

### Provider Factory

```typescript
import { createProviderFactory, DefaultProviderFactory } from 'simple-crypto-wallet/sdk';

// Use factory function
const factory = createProviderFactory();

// Or instantiate directly
const factory = new DefaultProviderFactory();

// Create provider for specific network
const provider = factory.createProvider('https://rpc.example.com', 1);
```

### Crypto Adapters

Switch crypto backend for browser compatibility:

```typescript
import { setCryptoAdapter, createWebCryptoAdapter } from 'simple-crypto-wallet/sdk';

// Switch to WebCrypto (for browsers)
setCryptoAdapter(createWebCryptoAdapter());
```

### Type Definitions

Key types exported from `simple-crypto-wallet/sdk`:

```typescript
// Network configuration
interface NetworkConfig {
  rpcUrl: string | string[];  // Supports failover
  chainId: number;
  nativeSymbol: string;
  nativeName: string;
  blockExplorer?: string;
  explorerApiUrl?: string;
  explorerApiKey?: string;
  name?: string;
}

// Token definition
interface Token {
  symbol: string;
  address: string;
  decimals: number;
  name: string;
  type?: 'native' | 'erc20';
}

// Application config
interface Config {
  defaultNetwork: string;
  network: string;
  networks: Record<string, NetworkConfig>;
}
```

## Chrome Extension

### Building the Extension

```bash
# Build for production
npm run build:extension

# Watch mode for development
npm run watch:extension
```

### Installing in Chrome

1. Build the extension: `npm run build:extension`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the `dist-extension/` directory
6. The wallet icon will appear in your Chrome toolbar

### Extension Features

- Create/import wallets with encrypted storage
- View balances across multiple networks
- Send ETH and ERC-20 tokens
- Add custom tokens
- View transaction history
- QR code for receiving
- Side panel interface

For detailed extension setup, see [EXTENSION_SETUP.md](./EXTENSION_SETUP.md).

## License

MIT
