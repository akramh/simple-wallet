# API Reference

Complete API documentation for the Simple Crypto Wallet SDK.

## Installation & Setup

### Node.js / CLI

```bash
npm install simple-crypto-wallet
```

```typescript
import { Wallet, WalletAppService, FileStorage, createProviderFactory } from 'simple-crypto-wallet/sdk';
import config from './config.json' assert { type: 'json' };

const storage = new FileStorage();
const wallet = new Wallet(config, storage, createProviderFactory());
const service = new WalletAppService(wallet, config, { storage });
await service.initialize();
```

### Browser / Extension

```bash
npm install simple-crypto-wallet
```

```typescript
import { Wallet, WalletAppService, MemoryStorage, createProviderFactory } from 'simple-crypto-wallet/sdk-browser';
import config from './config.json';

const storage = new MemoryStorage(); // or implement custom storage
const wallet = new Wallet(config, storage, createProviderFactory());
const service = new WalletAppService(wallet, config, { storage });
await service.initialize();
```

## Core Classes

### Wallet

The main wallet class providing multi-chain HD wallet functionality.

#### Constructor

```typescript
new Wallet(
  config: Config,
  storage: StorageAdapter,
  providerFactory: ProviderFactory
)
```

**Parameters:**
- `config` - Network configuration object
- `storage` - Storage adapter implementation
- `providerFactory` - Provider factory for creating RPC providers

#### Methods

##### initialize()

Initialize the wallet and connect to RPC provider.

```typescript
wallet.initialize(): Promise<void>
```

**Example:**
```typescript
await wallet.initialize();
```

---

##### createNewWallet(password)

Create a new HD wallet with a randomly generated mnemonic.

```typescript
wallet.createNewWallet(password: string): Promise<WalletInfo>
```

**Parameters:**
- `password` - Password for encrypting the wallet

**Returns:**
```typescript
interface WalletInfo {
  address: string;
  mnemonic: string;
  privateKey: string;
}
```

**Example:**
```typescript
const walletInfo = await wallet.createNewWallet('SecurePassword123!');
console.log('Address:', walletInfo.address);
console.log('Mnemonic:', walletInfo.mnemonic);
// IMPORTANT: Securely store the mnemonic!
```

---

##### importWallet(mnemonic, password, accountIndex?)

Import an existing wallet from a BIP-39 mnemonic phrase.

```typescript
wallet.importWallet(
  mnemonic: string,
  password: string,
  accountIndex?: number
): Promise<WalletInfo>
```

**Parameters:**
- `mnemonic` - 12-word BIP-39 mnemonic phrase
- `password` - Password for encrypting the wallet
- `accountIndex` - Optional BIP-44 account index (default: 0)

**Example:**
```typescript
const walletInfo = await wallet.importWallet(
  'witch collapse practice feed shame open despair creek road again ice least',
  'SecurePassword123!'
);
```

---

##### loadWallet(name, password, accountIndex?)

Load an existing wallet from storage.

```typescript
wallet.loadWallet(
  name: string,
  password: string,
  accountIndex?: number
): Promise<void>
```

**Parameters:**
- `name` - Wallet name/identifier
- `password` - Wallet password
- `accountIndex` - Optional BIP-44 account index (default: 0)

**Example:**
```typescript
await wallet.loadWallet('MyWallet', 'SecurePassword123!');
```

---

##### saveWallet(name?)

Save the current wallet to storage.

```typescript
wallet.saveWallet(name?: string): void
```

**Parameters:**
- `name` - Optional wallet name (defaults to current name)

**Example:**
```typescript
wallet.saveWallet('MyWallet');
```

---

##### deleteWallet(name)

Delete a wallet from storage.

```typescript
wallet.deleteWallet(name: string): void
```

**Parameters:**
- `name` - Wallet name to delete

**Example:**
```typescript
wallet.deleteWallet('MyWallet');
```

---

##### switchAccount(index)

Switch to a different BIP-44 account.

```typescript
wallet.switchAccount(index: number): Promise<AccountInfo>
```

**Parameters:**
- `index` - BIP-44 account index

**Returns:**
```typescript
interface AccountInfo {
  address: string;
  index: number;
}
```

**Example:**
```typescript
const account = await wallet.switchAccount(1);
console.log('New address:', account.address);
```

---

### EVM Operations

##### getAddress()

Get the current Ethereum address.

```typescript
wallet.getAddress(): string
```

**Example:**
```typescript
const address = wallet.getAddress();
// "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

---

##### getBalance()

Get the native currency balance (ETH, MATIC, etc.).

```typescript
wallet.getBalance(): Promise<string>
```

**Returns:** Balance in ether (not wei)

**Example:**
```typescript
const balance = await wallet.getBalance();
console.log(`Balance: ${balance} ETH`);
```

---

##### getTokenBalance(token)

Get the balance of an ERC-20 token.

```typescript
wallet.getTokenBalance(token: Token): Promise<string>
```

**Parameters:**
- `token` - Token object with address and decimals

**Example:**
```typescript
const usdcToken = {
  symbol: 'USDC',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  name: 'USD Coin'
};
const balance = await wallet.getTokenBalance(usdcToken);
console.log(`Balance: ${balance} USDC`);
```

---

##### getPortfolio(tokens)

Get balances for multiple tokens at once.

```typescript
wallet.getPortfolio(tokens: Token[]): Promise<TokenBalance[]>
```

**Returns:**
```typescript
interface TokenBalance {
  token: Token;
  balance: string;
}
```

**Example:**
```typescript
const tokens = [ethToken, usdcToken, daiToken];
const portfolio = await wallet.getPortfolio(tokens);
portfolio.forEach(({ token, balance }) => {
  console.log(`${token.symbol}: ${balance}`);
});
```

---

##### sendTransaction(to, amount)

Send native currency (ETH, MATIC, etc.).

```typescript
wallet.sendTransaction(to: string, amount: string): Promise<string>
```

**Parameters:**
- `to` - Recipient address
- `amount` - Amount in ether (not wei)

**Returns:** Transaction hash

**Example:**
```typescript
const txHash = await wallet.sendTransaction(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  '0.1'
);
console.log('Transaction:', txHash);
```

---

##### sendToken(token, to, amount)

Send ERC-20 tokens.

```typescript
wallet.sendToken(token: Token, to: string, amount: string): Promise<string>
```

**Parameters:**
- `token` - Token object
- `to` - Recipient address
- `amount` - Amount in token units (not smallest units)

**Returns:** Transaction hash

**Example:**
```typescript
const txHash = await wallet.sendToken(
  usdcToken,
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  '100'
);
```

---

##### getTokenMetadata(address)

Fetch on-chain token metadata.

```typescript
wallet.getTokenMetadata(address: string): Promise<TokenMetadata>
```

**Returns:**
```typescript
interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}
```

**Example:**
```typescript
const metadata = await wallet.getTokenMetadata('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
console.log(metadata); // { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
```

---

### Bitcoin Operations

##### getBitcoinAddress()

Get the current Bitcoin address.

```typescript
wallet.getBitcoinAddress(): string
```

**Example:**
```typescript
const address = wallet.getBitcoinAddress();
// "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
```

---

##### getBitcoinBalance()

Get Bitcoin balance.

```typescript
wallet.getBitcoinBalance(): Promise<number>
```

**Returns:** Balance in BTC

**Example:**
```typescript
const balance = await wallet.getBitcoinBalance();
console.log(`Balance: ${balance} BTC`);
```

---

##### sendBitcoin(to, amountBtc)

Send Bitcoin.

```typescript
wallet.sendBitcoin(to: string, amountBtc: number): Promise<string>
```

**Parameters:**
- `to` - Recipient Bitcoin address
- `amountBtc` - Amount in BTC

**Returns:** Transaction hash

**Example:**
```typescript
const txHash = await wallet.sendBitcoin('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 0.001);
```

---

### Solana Operations

##### getSolanaAddress()

Get the current Solana address.

```typescript
wallet.getSolanaAddress(): string
```

**Example:**
```typescript
const address = wallet.getSolanaAddress();
// "7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv"
```

---

##### getSolanaBalance()

Get Solana balance.

```typescript
wallet.getSolanaBalance(): Promise<number>
```

**Returns:** Balance in SOL

**Example:**
```typescript
const balance = await wallet.getSolanaBalance();
console.log(`Balance: ${balance} SOL`);
```

---

##### sendSolana(to, amountSol)

Send Solana.

```typescript
wallet.sendSolana(to: string, amountSol: number): Promise<string>
```

**Parameters:**
- `to` - Recipient Solana address (case-sensitive base58)
- `amountSol` - Amount in SOL

**Returns:** Transaction signature

**Example:**
```typescript
const signature = await wallet.sendSolana('7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv', 0.1);
```

---

### XRP Operations

Similar pattern to Bitcoin and Solana:
- `getXrpAddress()`
- `getXrpBalance()`
- `sendXrp(to, amountXrp)`

### TON Operations

Similar pattern:
- `getTonAddress()`
- `getTonBalance()`
- `sendTon(to, amountTon)`

---

### Security Methods

##### getPrivateKey(password)

Get the private key (requires password verification).

```typescript
wallet.getPrivateKey(password: string): string
```

**Example:**
```typescript
const privateKey = wallet.getPrivateKey('SecurePassword123!');
// WARNING: Never expose private keys!
```

---

##### getMnemonic(password)

Get the mnemonic phrase (requires password verification).

```typescript
wallet.getMnemonic(password: string): string
```

**Example:**
```typescript
const mnemonic = wallet.getMnemonic('SecurePassword123!');
// WARNING: Never expose mnemonics!
```

---

##### exportWallet(name, path)

Export wallet to a backup file.

```typescript
wallet.exportWallet(name: string, path: string): void
```

---

##### importFromBackup(path, password)

Import wallet from a backup file.

```typescript
wallet.importFromBackup(path: string, password: string): Promise<void>
```

---

## WalletAppService

UI-agnostic service layer for wallet operations.

### Constructor

```typescript
new WalletAppService(
  wallet: Wallet,
  config: Config,
  options: { storage: StorageAdapter }
)
```

### Methods

##### initialize()

Initialize the service.

```typescript
service.initialize(): Promise<void>
```

---

##### createWallet(password)

Create a new wallet.

```typescript
service.createWallet(password: string): Promise<WalletInfo>
```

---

##### importWallet(mnemonic, password, index?)

Import wallet from mnemonic.

```typescript
service.importWallet(
  mnemonic: string,
  password: string,
  index?: number
): Promise<WalletInfo>
```

---

##### loadWallet(name, password, index?)

Load saved wallet.

```typescript
service.loadWallet(
  name: string,
  password: string,
  index?: number
): Promise<void>
```

---

##### getTokensForNetwork(networkKey)

Get all tokens (native + ERC-20) for a network.

```typescript
service.getTokensForNetwork(networkKey: string): Token[]
```

**Example:**
```typescript
const tokens = service.getTokensForNetwork('mainnet');
tokens.forEach(token => {
  console.log(token.symbol, token.name);
});
```

---

##### addCustomToken(networkKey, token)

Add a custom ERC-20 token.

```typescript
service.addCustomToken(networkKey: string, token: Token): void
```

**Example:**
```typescript
service.addCustomToken('mainnet', {
  symbol: 'CUSTOM',
  address: '0x...',
  decimals: 18,
  name: 'Custom Token'
});
```

---

##### removeCustomToken(networkKey, address)

Remove a custom token.

```typescript
service.removeCustomToken(networkKey: string, address: string): void
```

---

##### findTokenBySymbol(networkKey, symbol)

Find a token by its symbol.

```typescript
service.findTokenBySymbol(networkKey: string, symbol: string): Token | undefined
```

---

##### setNetwork(networkKey, options?)

Switch to a different network.

```typescript
service.setNetwork(
  networkKey: string,
  options?: { reinitialize?: boolean }
): Promise<void>
```

**Example:**
```typescript
await service.setNetwork('polygon');
```

---

##### getPortfolioForNetwork(networkKey)

Get all token balances for a network.

```typescript
service.getPortfolioForNetwork(networkKey: string): Promise<TokenBalance[]>
```

**Example:**
```typescript
const portfolio = await service.getPortfolioForNetwork('mainnet');
portfolio.forEach(({ token, balance }) => {
  console.log(`${token.symbol}: ${balance}`);
});
```

---

##### sendToken(token, to, amount)

Send a token transaction.

```typescript
service.sendToken(token: Token, to: string, amount: string): Promise<string>
```

---

## Storage Adapters

### StorageAdapter Interface

```typescript
interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}
```

### FileStorage

File system storage for Node.js.

```typescript
import { FileStorage } from 'simple-crypto-wallet/sdk';

const storage = new FileStorage();
```

### MemoryStorage

In-memory storage for tests or ephemeral sessions.

```typescript
import { MemoryStorage } from 'simple-crypto-wallet/sdk';

const storage = new MemoryStorage();
```

### Custom Implementation Example

```typescript
class CustomStorage implements StorageAdapter {
  readJSON<T>(path: string, fallback: T): T {
    // Your implementation
  }

  writeJSON<T>(path: string, data: T): void {
    // Your implementation
  }

  exists(path: string): boolean {
    // Your implementation
  }

  readFile(path: string): string | null {
    // Your implementation
  }

  writeFile(path: string, contents: string): void {
    // Your implementation
  }
}
```

---

## Provider Factory

### createProviderFactory()

Create a default provider factory.

```typescript
import { createProviderFactory } from 'simple-crypto-wallet/sdk';

const factory = createProviderFactory();
```

### DefaultProviderFactory

```typescript
import { DefaultProviderFactory } from 'simple-crypto-wallet/sdk';

const factory = new DefaultProviderFactory();
const provider = factory.createProvider('https://eth.llamarpc.com', 1);
```

### Custom Provider Factory

```typescript
import { ProviderFactory } from 'simple-crypto-wallet/sdk';
import { JsonRpcProvider } from 'ethers';

class CustomProviderFactory implements ProviderFactory {
  createProvider(rpcUrl: string, chainId: number): JsonRpcProvider {
    // Your custom implementation
    // Useful for mocking in tests
  }
}
```

---

## Crypto Adapters

### setCryptoAdapter(adapter)

Switch crypto backend.

```typescript
import { setCryptoAdapter, createWebCryptoAdapter } from 'simple-crypto-wallet/sdk';

// For browsers
setCryptoAdapter(createWebCryptoAdapter());
```

### createNodeCryptoAdapter()

Create Node.js crypto adapter (default for CLI/Node).

```typescript
import { createNodeCryptoAdapter } from 'simple-crypto-wallet/sdk';

const adapter = createNodeCryptoAdapter();
```

### createWebCryptoAdapter()

Create browser crypto adapter (uses asmcrypto.js).

```typescript
import { createWebCryptoAdapter } from 'simple-crypto-wallet/sdk';

const adapter = createWebCryptoAdapter();
```

---

## Type Definitions

### Config

```typescript
interface Config {
  network: string;
  defaultNetwork: string;
  showTestnets?: boolean;
  networks: Record<string, NetworkConfig>;
}
```

### NetworkConfig

```typescript
type NetworkConfig =
  | EVMNetworkConfig
  | BitcoinNetworkConfig
  | SolanaNetworkConfig
  | XRPNetworkConfig
  | TonNetworkConfig;

interface EVMNetworkConfig {
  type?: 'evm';
  rpcUrl: string | string[];
  chainId: number;
  nativeSymbol: string;
  nativeName: string;
  blockExplorer?: string;
  explorerApiUrl?: string;
  explorerApiKey?: string;
  isTestnet?: boolean;
}

interface BitcoinNetworkConfig {
  type: 'bitcoin';
  bitcoinNetwork: 'mainnet' | 'testnet';
  nativeSymbol: string;
  nativeName: string;
  isTestnet?: boolean;
}

interface SolanaNetworkConfig {
  type: 'solana';
  rpcUrl: string | string[];
  nativeSymbol: string;
  nativeName: string;
  isTestnet?: boolean;
}
```

### Token

```typescript
interface Token {
  symbol: string;
  address: string;        // 'native' for native tokens
  decimals: number;
  name: string;
  type?: 'native' | 'erc20';
  icon?: string;
}
```

### WalletInfo

```typescript
interface WalletInfo {
  address: string;
  mnemonic: string;
  privateKey: string;
}
```

### AccountInfo

```typescript
interface AccountInfo {
  address: string;
  index: number;
}
```

### TokenBalance

```typescript
interface TokenBalance {
  token: Token;
  balance: string;
}
```

---

## Error Handling

All async methods can throw errors. Always use try-catch:

```typescript
try {
  const balance = await wallet.getBalance();
  console.log('Balance:', balance);
} catch (error) {
  console.error('Failed to get balance:', error.message);
}
```

Common errors:
- `Invalid password` - Wrong wallet password
- `Wallet not found` - Wallet doesn't exist in storage
- `Invalid mnemonic` - Invalid BIP-39 phrase
- `Network error` - RPC connection failure
- `Insufficient funds` - Not enough balance for transaction

---

## Best Practices

### Security

1. **Never log or expose:**
   - Private keys
   - Mnemonic phrases
   - Passwords

2. **Always:**
   - Use strong passwords (12+ characters, mixed case, numbers, symbols)
   - Store mnemonics offline in a secure location
   - Test on testnets before mainnet
   - Validate addresses before sending

### Performance

1. **Batch operations:**
   ```typescript
   // Good: One call
   const portfolio = await wallet.getPortfolio(tokens);

   // Bad: Multiple calls
   for (const token of tokens) {
     await wallet.getTokenBalance(token);
   }
   ```

2. **Cache balances:**
   ```typescript
   // Cache for 30 seconds to avoid excessive RPC calls
   let cachedBalance: string | null = null;
   let cacheTime = 0;

   async function getBalanceCached() {
     if (Date.now() - cacheTime < 30000 && cachedBalance) {
       return cachedBalance;
     }
     cachedBalance = await wallet.getBalance();
     cacheTime = Date.now();
     return cachedBalance;
   }
   ```

### Testing

Use `MemoryStorage` and custom `ProviderFactory`:

```typescript
import { Wallet, MemoryStorage } from 'simple-crypto-wallet/sdk';

// Mock provider factory
class MockProviderFactory {
  createProvider() {
    return mockProvider; // Your mocked provider
  }
}

const wallet = new Wallet(config, new MemoryStorage(), new MockProviderFactory());
```

---

## Examples

### Complete Node.js Example

```typescript
import { WalletAppService, Wallet, FileStorage, createProviderFactory } from 'simple-crypto-wallet/sdk';
import config from './config.json' assert { type: 'json' };

async function main() {
  // Setup
  const storage = new FileStorage();
  const wallet = new Wallet(config, storage, createProviderFactory());
  const service = new WalletAppService(wallet, config, { storage });
  await service.initialize();

  // Create wallet
  const walletInfo = await service.createWallet('SecurePassword123!');
  console.log('Created wallet:', walletInfo.address);
  console.log('Save this mnemonic:', walletInfo.mnemonic);

  // Save wallet
  wallet.saveWallet('MyWallet');

  // Get balance
  const balance = await wallet.getBalance();
  console.log('Balance:', balance, 'ETH');

  // Get all tokens
  const tokens = service.getTokensForNetwork('mainnet');
  const portfolio = await wallet.getPortfolio(tokens);
  console.log('Portfolio:', portfolio);
}

main().catch(console.error);
```

### Complete Browser Example

```typescript
import { WalletAppService, Wallet, MemoryStorage, createProviderFactory } from 'simple-crypto-wallet/sdk-browser';
import { setCryptoAdapter, createWebCryptoAdapter } from 'simple-crypto-wallet/sdk-browser';

// Setup WebCrypto
setCryptoAdapter(createWebCryptoAdapter());

async function initWallet() {
  const storage = new MemoryStorage();
  const wallet = new Wallet(config, storage, createProviderFactory());
  const service = new WalletAppService(wallet, config, { storage });
  await service.initialize();

  // Import wallet
  await service.importWallet(
    'witch collapse practice feed shame open despair creek road again ice least',
    'SecurePassword123!'
  );

  // Switch network
  await service.setNetwork('polygon');

  // Send transaction
  const txHash = await wallet.sendTransaction(
    '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    '0.1'
  );
  console.log('Transaction:', txHash);
}
```

---

## Support

- **Issues:** [GitHub Issues](https://github.com/yourusername/simple-wallet/issues)
- **Documentation:** [README.md](./README.md)
- **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)
