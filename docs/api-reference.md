# API Reference

This reference summarizes the public SDK and service surfaces used by the
project. Source is the authority; keep this file in sync with exported
functions and types.

## SDK Entrypoints

Node and CLI contexts:

```ts
import {
  Wallet,
  WalletAppService,
  FileStorage,
  MemoryStorage,
  createProviderFactory,
} from 'simple-wallet/sdk';
```

Browser-like contexts:

```ts
import {
  Wallet,
  WalletAppService,
  MemoryStorage,
  createProviderFactory,
} from 'simple-wallet/sdk-browser';
```

`sdk-browser` installs the Buffer polyfill and configures the WebCrypto adapter
on import. Manual crypto adapter setup is exported from `simple-wallet/sdk`
for environments that need explicit control.

## Wallet

`Wallet` owns encrypted wallet data, account derivation, private-key import,
and low-level chain operations.

Common lifecycle methods:

- `initialize(): Promise<void>`
- `createNewWallet(password: string): WalletInfo`
- `importWallet(mnemonic: string, password: string, accountIndex?: number): WalletInfo`
- `importFromPrivateKey(key: string, type: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton', password: string): WalletInfo`
- `loadWallet(name: string, password: string, accountIndex?: number | null): WalletInfo | null`
- `loadWalletAsync(name: string, password: string, accountIndex?: number | null): Promise<WalletInfo | null>`
- `saveWallet(name?: string): string`
- `deleteWallet(name: string): boolean`
- `switchAccount(index: number): { address: string; accountIndex: number }`
- `getAccountAddress(index: number): string`
- `getCurrentAccountIndex(): number`

EVM methods:

- `getAddress(): string`
- `getBalance(): Promise<string>`
- `getTokenBalance(token: Token): Promise<string>`
- `getPortfolio(tokens?: Token[]): Promise<Array<{ token: Token; balance: string; error?: string }>>`
- `sendTransaction(to: string, amount: string): Promise<{ hash: string; blockNumber: number; gasUsed: string }>`
- `sendToken(token: Token, to: string, amount: string): Promise<{ hash: string; blockNumber: number; gasUsed: string }>`
- `getTokenMetadata(address: string): Promise<TokenMetadata>`

Bitcoin methods:

- `getBitcoinAddress(network?: 'mainnet' | 'testnet', accountIndex?: number): BitcoinAddressInfo`
- `getBitcoinPrivateKey(password: string, network?: 'mainnet' | 'testnet'): string`

Solana methods:

- `getSolanaAddress(accountIndex?: number): SolanaAddressInfo`
- `getSolanaPrivateKey(password: string): string`

XRP methods:

- `getXRPAddress(accountIndex?: number): XRPAddressInfo`
- `getXRPPrivateKey(password: string): string`

TON methods:

- `getTonAddress(accountIndex?: number): TonAddressInfo`

Sensitive export methods:

- `getPrivateKey(password: string): string`
- `getMnemonic(password: string): string`
- `exportWallet(name: string, path: string): boolean`
- `importFromBackup(path: string, password: string): string`

## WalletAppService

`WalletAppService` is the platform-facing orchestration layer. UIs should use
this service for wallet lifecycle, token registry, network switching,
portfolio, transaction, history, and platform-independent send behavior.

Lifecycle and account methods:

- `initialize(): Promise<void>`
- `createWallet(password: string): WalletInfo`
- `importWallet(mnemonic: string, password: string, index?: number): WalletInfo`
- `importFromPrivateKey(key: string, type: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton', password: string): WalletInfo`
- `loadWallet(name: string, password: string, index?: number | null): WalletInfo | null`
- `loadWalletAsync(name: string, password: string, index?: number | null): Promise<WalletInfo | null>`
- `saveWallet(name?: string): string`
- `deleteWallet(name: string): boolean`
- `switchAccount(index: number): { address: string; accountIndex: number }`
- `getAddress(): string`
- `getBalance(): Promise<string>`
- `getAccountAddress(index: number): string`

Network and token methods:

- `setNetwork(networkKey: string, options?: SetNetworkOptions): Promise<void>`
- `getTokensForNetwork(networkKey: string): Token[]`
- `addCustomToken(networkKey: string, token: Token): void`
- `removeCustomToken(networkKey: string, address: string): void`
- `findTokenBySymbol(networkKey: string, symbol: string): Token | undefined`
- `getPortfolioForNetwork(networkKey: string): Promise<Array<{ token: Token; balance: string; error?: string; availableBalance?: string; reservedBalance?: string; isActivated?: boolean }>>`
- `fetchBalances(tokens: Token[]): Promise<Array<{ token: Token; balance: string; error?: string }>>`
- `sendToken(token: Token, to: string, amount: string): Promise<{ hash: string; blockNumber: number; gasUsed: string }>`

Chain-specific service methods include:

- `getBitcoinAddress(): BitcoinAddressInfo | null`
- `getBitcoinTransactionHistory(limit?: number): Promise<NormalizedBitcoinTransaction[]>`
- `getBitcoinTransactionUrl(txid: string): string`
- `getBitcoinAddressUrl(address?: string): string`
- `getBitcoinPrivateKey(password: string, networkKey?: string): string`
- `sendBitcoinTransaction(toAddress: string, amountBtc: string, password: string): Promise<{ hash: string; feeSats: number; feeBtc: string; vbytes: number }>`
- `getSolanaAddress(): SolanaAddressInfo | null`
- `sendSolanaTransaction(toAddress: string, amountSol: string, password: string): Promise<SolTransferResult>`
- `sendSolanaTokenTransaction(token: Token, toAddress: string, amount: string, password: string): Promise<SolTransferResult>`
- `getSolanaTransactionHistory(limit?: number): Promise<NormalizedSolanaTransaction[]>`
- `getSolanaTransactionHistoryForAddress(address: string, limit?: number): Promise<NormalizedSolanaTransaction[]>`
- `getXRPAddress(): XRPAddressInfo | null`
- `getXRPTransactionHistory(limit?: number): Promise<NormalizedXRPTransaction[]>`
- `getXRPTransactionHistoryForAddress(address: string, limit?: number, networkKey?: string): Promise<NormalizedXRPTransaction[]>`
- `getXRPTransactionUrl(hash: string): string`
- `getXRPAddressUrl(address?: string): string`
- `getXRPPrivateKey(password: string): string`
- `sendXRPTransaction(toAddress: string, amountXrp: string, password: string, destinationTag?: number): Promise<{ hash: string; feeDrops: number; feeXrp: string }>`
- `estimateXRPTransaction(toAddress: string, amountXrp: string, destinationTag?: number): Promise<TransactionEstimate>`
- `getTonAddress(): TonAddressInfo | null`
- `getTonTransactionHistory(limit?: number): Promise<NormalizedTonTransaction[]>`
- `getTonTransactionHistoryForAddress(address: string, limit?: number, networkKey?: string): Promise<NormalizedTonTransaction[]>`
- `getTonTransactionUrl(hash: string): string`
- `getTonAddressUrl(address?: string): string`
- `sendTonTransaction(toAddress: string, amountTon: string, password: string, comment?: string): Promise<{ hash: string }>`

## StorageAdapter

```ts
interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}
```

Use `FileStorage` for Node, `MemoryStorage` for tests, `ChromeStorageAdapter`
for the extension, and `MobileStorageAdapter` for React Native.

## Crypto Adapters

```ts
import { setCryptoAdapter, createWebCryptoAdapter } from 'simple-wallet/sdk';

setCryptoAdapter(createWebCryptoAdapter());
```

The extension and mobile bridge set the adapter at startup. `sdk-browser`
auto-configures WebCrypto on import. Shared core code should not call platform
crypto APIs directly.

## Type Notes

- Amount strings are usually human-denominated token amounts unless a method
  explicitly documents base units.
- Network keys are config keys such as `mainnet`, `solana-mainnet`, and
  `ton-testnet`.
- Timestamps must document seconds vs milliseconds at the API boundary.
- Address case rules differ by chain; see [security](./security.md).
