# Simple Crypto Wallet

A multi-chain cryptocurrency wallet with CLI and Chrome extension interfaces, supporting Ethereum (EVM chains), Bitcoin, and Solana. Written in TypeScript with full type safety. Also provides a programmatic SDK for integration into browser extensions, mobile apps, and other applications.

## Features

### Multi-Chain Support
- **Ethereum & EVM Chains** - Mainnet, Sepolia, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, Linea
- **Bitcoin** - Mainnet and Testnet support
- **Solana** - Mainnet and Devnet support

### Core Wallet Features
- Create new wallet with 12-word BIP-39 mnemonic phrase
- Import existing wallet from mnemonic
- Password-protected wallet encryption (AES-256-GCM)
- Multi-account support (BIP-44 HD wallet)
- Wallet import/export with backup functionality

### EVM Features
- Check wallet balance (ETH + ERC-20 tokens)
- Send ETH or ERC-20 token transactions
- Token management (add custom ERC-20 tokens)
- Portfolio aggregation with real-time price data
- RPC failover with retry mechanism

### Bitcoin Features
- BTC address generation and balance checking
- Send BTC transactions
- Transaction history via Mempool.space API

### Solana Features
- SOL address generation and balance checking
- Send SOL transactions
- Transaction history via Solscan API

### Additional Features
- QR code display for receiving
- Block explorer integration (Etherscan, Solscan, Mempool.space, etc.)
- Atomic file writes with automatic backups
- Light/dark theme toggle (extension)

## Supported Networks

| Blockchain | Networks |
|------------|----------|
| Ethereum | Mainnet, Sepolia Testnet |
| Layer 2 | Base, Arbitrum, Optimism, Linea |
| Sidechains | Polygon, Avalanche, BSC |
| Bitcoin | Mainnet, Testnet |
| Solana | Mainnet, Devnet |

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

**19 test files covering:**
- Wallet creation and import
- Crypto utilities (password validation, encryption/decryption)
- Balance checking and portfolio aggregation
- Network switching and RPC failover
- Token metadata caching
- Bitcoin functionality (address, explorer, transactions)
- Solana functionality (address, explorer, transactions)
- Chrome storage adapter
- Price service
- Transaction history

## Configuration

Edit `config.json` to change the default network or add custom RPC endpoints:

```json
{
  "network": "mainnet",
  "networks": {
    "mainnet": {
      "type": "evm",
      "name": "Ethereum Mainnet",
      "rpcUrl": "https://eth.llamarpc.com",
      "chainId": 1,
      "nativeSymbol": "ETH"
    },
    "bitcoin-mainnet": {
      "type": "bitcoin",
      "name": "Bitcoin Mainnet",
      "bitcoinNetwork": "mainnet",
      "nativeSymbol": "BTC"
    },
    "solana-mainnet": {
      "type": "solana",
      "name": "Solana Mainnet",
      "rpcUrl": "https://api.mainnet-beta.solana.com",
      "nativeSymbol": "SOL"
    }
  }
}
```

### Environment Variables

Explorer and RPC API keys are provided through environment variables:

1. Copy `.env.example` to `.env`.
2. Set a global fallback key via `EXPLORER_API_KEY` or network-specific keys like `EXPLORER_API_KEY_MAINNET` and `EXPLORER_API_KEY_SEPOLIA` (uppercase the network key from `config.json`, e.g., `BASE`, `ARBITRUM`, `OPTIMISM`, `POLYGON`, `AVALANCHE`, `BSC`, `LINEA`).
3. For networks whose keys contain non-alphanumeric characters (e.g. `solana-mainnet`), use underscores: `EXPLORER_API_KEY_SOLANA_MAINNET` (same for `VITE_`).
4. For Solana RPC access via Helius, set `HELIUS_API_KEY` (or `VITE_HELIUS_API_KEY` for the extension).
5. For the Chrome extension build, Vite uses `VITE_`-prefixed variables (e.g., `VITE_EXPLORER_API_KEY_MAINNET` or `VITE_EXPLORER_API_KEY_BASE`).

The CLI automatically loads `.env` via `dotenv`, and the extension build injects values from `import.meta.env`.

## Security Notes

**IMPORTANT SECURITY WARNINGS:**

1. **Never share your mnemonic phrase** - Anyone with your mnemonic can access your funds
2. **Back up your mnemonic** - Store it securely offline
3. **Keep wallets.json secure** - This file contains encrypted wallet data
4. **Use testnet first** - Test all operations on testnets before using mainnet
5. **This is a demo wallet** - For production use, consider hardware wallets or established solutions

### Address Format Notes

- **Solana addresses** are base58 and **case-sensitive**. Changing letter casing produces a different address.
- **Bitcoin addresses** support multiple formats (Legacy, SegWit, Native SegWit).
- **Ethereum addresses** are case-insensitive but use mixed-case checksums (EIP-55).

## Getting Testnet Funds

### Ethereum (Sepolia)
- Visit a Sepolia faucet (search "Sepolia faucet")
- Enter your wallet address
- Receive free test ETH

### Bitcoin (Testnet)
- Visit a Bitcoin testnet faucet (search "Bitcoin testnet faucet")
- Enter your testnet address
- Receive free test BTC

### Solana (Devnet)
- Use the Solana CLI: `solana airdrop 1 <address> --url devnet`
- Or visit a Solana devnet faucet

## Switching Networks

Use the "Change Network" option in the menu to switch between networks. The application will restart after changing networks.

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
│   - Price service integration                                               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────────────┐
│  Wallet (wallet.ts) │ │ Storage Adapters    │ │ ExplorerAPI                 │
│  - BIP-44 HD wallet │ │ - FileStorage       │ │ - Etherscan V2 API          │
│  - AES-256-GCM      │ │ - MemoryStorage     │ │ - Mempool.space API         │
│  - RPC failover     │ │ - ChromeStorage     │ │ - Solscan API               │
│  - Token operations │ └─────────────────────┘ │ - Transaction history       │
└──────────┬──────────┘                         └─────────────────────────────┘
           │
     ┌─────┴─────────────────────────┐
     ▼                ▼              ▼
┌──────────┐ ┌──────────────┐ ┌──────────────┐
│ Bitcoin  │ │ Solana       │ │ EVM Provider │
│ Module   │ │ Module       │ │ Factory      │
│ - Keys   │ │ - Keys       │ │ - ethers.js  │
│ - TX     │ │ - TX         │ │ - RPC calls  │
└──────────┘ └──────────────┘ └──────────────┘
     │              │               │
     ▼              ▼               ▼
┌─────────────────────────────────────────────┐
│ CryptoAdapter                               │
│ - NodeCryptoAdapter (Node.js)               │
│ - WebCryptoAdapter (Browser)                │
└─────────────────────────────────────────────┘
```

## Project Structure

```
simple-wallet/
├── src/                       # TypeScript source files
│   ├── types/                 # Type definitions
│   │   ├── config.ts          # Network & token types (EVM/Bitcoin/Solana)
│   │   ├── wallet.ts          # Wallet & transaction types
│   │   └── index.ts           # Type exports
│   ├── bitcoin/               # Bitcoin support module
│   │   ├── address.ts         # Address derivation
│   │   ├── explorer.ts        # Mempool.space API integration
│   │   ├── provider.ts        # Bitcoin RPC provider
│   │   ├── transaction.ts     # TX building
│   │   ├── types.ts           # Bitcoin types
│   │   └── index.ts           # Module exports
│   ├── solana/                # Solana support module
│   │   ├── address.ts         # Address derivation (base58)
│   │   ├── explorer.ts        # Solscan API integration
│   │   ├── provider.ts        # Solana RPC provider
│   │   ├── transaction.ts     # TX building
│   │   ├── types.ts           # Solana types
│   │   └── index.ts           # Module exports
│   ├── index.ts               # CLI entry point with menus
│   ├── wallet.ts              # Core HD wallet implementation
│   ├── app-service.ts         # UI-neutral service layer
│   ├── storage.ts             # Storage adapters (File/Memory)
│   ├── chrome-storage.ts      # Chrome extension storage adapter
│   ├── providers.ts           # Provider factory abstraction
│   ├── crypto-utils.ts        # Encryption utilities
│   ├── crypto-adapter.ts      # Node + WebCrypto adapters
│   ├── explorer-api.ts        # Block explorer integration
│   ├── price-service.ts       # Token price data and portfolio valuation
│   ├── transaction-history.ts # Transaction history tracking
│   ├── config-utils.ts        # Configuration utilities
│   ├── ui-helpers.ts          # Terminal UI formatting
│   ├── sdk.ts                 # SDK entry for Node/CLI
│   └── sdk-browser.ts         # SDK entry for browser/extension
├── extension/                 # Chrome extension source
│   ├── manifest.json          # Extension manifest v3
│   ├── background/            # Service worker
│   ├── content/               # Content scripts
│   ├── sidepanel/             # Side panel UI
│   └── popup/                 # React components
│       └── components/        # UI components (MainWallet, Send, Receive, etc.)
├── dist/                      # Compiled JavaScript (generated)
├── dist-extension/            # Extension build (generated)
├── tests/                     # Test files (19 test files)
│   ├── wallet.test.js         # Wallet class tests
│   ├── app-service.test.js    # Service layer tests
│   ├── crypto-utils.test.js   # Encryption tests
│   ├── crypto-adapter.test.js # Crypto adapter tests
│   ├── storage.test.js        # Storage adapter tests
│   ├── chrome-storage.test.js # Chrome storage tests
│   ├── bitcoin.test.js        # Bitcoin functionality tests
│   ├── bitcoin-explorer.test.js
│   ├── bitcoin-transaction.test.js
│   ├── solana.test.js         # Solana tests
│   ├── solana-explorer.test.js
│   ├── solana-address-format.test.js
│   ├── explorer-api.test.js   # Explorer API tests
│   ├── transaction-history.test.js
│   ├── price-service.test.js  # Price service tests
│   ├── config-utils.test.js
│   ├── menu.test.js           # CLI menu tests
│   └── ui-helpers.test.js
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
- **Strict Mode Enabled** - Maximum type safety
- **Full Type Coverage** - All functions and variables typed
- **Generic Types** - Type-safe JSON operations
- **Type Guards** - Proper error handling
- **Source Maps** - Easy debugging
- **Declaration Files** - Type definitions for consumers

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
// Base network configuration
interface BaseNetworkConfig {
  name: string;
  nativeSymbol: string;
  nativeName: string;
  blockExplorer?: string;
}

// EVM network configuration
interface EVMNetworkConfig extends BaseNetworkConfig {
  type: 'evm';
  rpcUrl: string | string[];  // Supports failover
  chainId: number;
  explorerApiUrl?: string;
}

// Bitcoin network configuration
interface BitcoinNetworkConfig extends BaseNetworkConfig {
  type: 'bitcoin';
  bitcoinNetwork: 'mainnet' | 'testnet';
}

// Solana network configuration
interface SolanaNetworkConfig extends BaseNetworkConfig {
  type: 'solana';
  rpcUrl: string | string[];
}

// Union type for all networks
type NetworkConfig = EVMNetworkConfig | BitcoinNetworkConfig | SolanaNetworkConfig;

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
- View balances across multiple networks (EVM, Bitcoin, Solana)
- Send ETH, ERC-20 tokens, BTC, and SOL
- Add custom tokens
- View transaction history
- QR code for receiving
- Light/dark theme toggle
- Account switching
- Side panel interface

For detailed extension setup, see [EXTENSION_SETUP.md](./EXTENSION_SETUP.md).

## License

MIT
