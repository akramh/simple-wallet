import type { Config, Token, TokenRegistry, TokenMetadata } from './types/index.js';
import { Wallet } from './wallet.js';
import { MemoryStorage, type StorageAdapter } from './storage.js';
import type { ProviderFactory } from './providers.js';

// Options controlling how network changes are persisted.
interface SetNetworkOptions {
  persist?: boolean;
}

type WalletInfo = {
  address: string;
  mnemonic: string;
  privateKey: string;
};

/**
 * WalletAppService centralizes non-UI wallet operations so the same logic can
 * be reused by different frontends (CLI, browser extension, mobile, etc.).
 */
export class WalletAppService {
  config: Config & { network: string };
  wallet: Wallet;
  tokenListPath: string;
  customTokenPath: string;
  configPath: string;
  builtInTokens: TokenRegistry;
  customTokens: TokenRegistry;
  storage: StorageAdapter;

  constructor(
    wallet: Wallet,
    config: Config & { network: string },
    options: {
      tokenListPath?: string;
      customTokenPath?: string;
      configPath?: string;
      storage?: StorageAdapter;
      providerFactory?: ProviderFactory;
    } = {}
  ) {
    if (options.providerFactory) {
      wallet.providerFactory = options.providerFactory;
    }
    this.wallet = wallet;
    this.config = config;
    // Default to in-memory storage to remain browser-safe unless provided.
    this.storage = options.storage || new MemoryStorage();
    this.tokenListPath = options.tokenListPath ?? 'tokens.json';
    this.customTokenPath = options.customTokenPath ?? 'tokens-user.json';
    this.configPath = options.configPath ?? 'config.json';

    this.builtInTokens = this.safeReadRegistry(this.tokenListPath);
    this.customTokens = this.safeReadRegistry(this.customTokenPath);
  }

  async initialize(): Promise<void> {
    await this.wallet.initialize();
  }

  createWallet(password: string): WalletInfo {
    return this.wallet.createNewWallet(password);
  }

  importWallet(mnemonic: string, password: string, accountIndex: number = 0): WalletInfo {
    return this.wallet.importWallet(mnemonic, password, accountIndex);
  }

  loadWallet(walletName: string, password: string, accountIndex: number | null = null): WalletInfo | null {
    return this.wallet.loadWallet(walletName, password, accountIndex);
  }

  saveWallet(walletName?: string): string {
    return this.wallet.saveWallet(walletName);
  }

  deleteWallet(walletName: string): boolean {
    return this.wallet.deleteWallet(walletName);
  }

  getWalletAccounts(walletName: string): Record<number, { address: string; createdAt: string }> {
    return this.wallet.getWalletAccounts(walletName);
  }

  getAllWallets(): Record<string, any> {
    return this.wallet.getAllWallets();
  }

  switchAccount(index: number): { address: string; accountIndex: number } {
    return this.wallet.switchAccount(index);
  }

  getAccountAddress(index: number): string {
    return this.wallet.getAccountAddress(index);
  }

  getAddress(): string {
    return this.wallet.getAddress();
  }

  getBalance(): Promise<string> {
    return this.wallet.getBalance();
  }

  async getPortfolioForNetwork(networkKey: string): Promise<{ token: Token; balance: string; error?: string }[]> {
    const tokens = this.getTokensForNetwork(networkKey);
    return this.wallet.getPortfolio(tokens);
  }

  async sendToken(token: Token, toAddress: string, amount: string): Promise<{ hash: string; blockNumber: number; gasUsed: string }> {
    return this.wallet.sendToken(token, toAddress, amount);
  }

  async getTokenMetadata(address: string): Promise<TokenMetadata> {
    return this.wallet.getTokenMetadata(address);
  }

  private safeReadRegistry(path: string): TokenRegistry {
    return this.storage.readJSON<TokenRegistry>(path, {});
  }

  private saveCustomTokens(): void {
    this.storage.writeJSON(this.customTokenPath, this.customTokens);
  }

  getNativeToken(networkKey: string): Token {
    const networkConfig = this.config.networks[networkKey] || {};
    const symbol = networkConfig.nativeSymbol || 'ETH';
    const name = networkConfig.nativeName || networkConfig.name || 'Ether';
    return {
      symbol,
      type: 'native',
      decimals: 18,
      name,
      address: ''
    };
  }

  getTokensForNetwork(networkKey: string): Token[] {
    const tokens: Token[] = [];
    const nativeToken = this.getNativeToken(networkKey);

    // Always include native token first
    tokens.push(nativeToken);

    const seenAddresses = new Set<string>();
    const appendToken = (token: Token): void => {
      if (token.type === 'native') {
        return;
      }
      if (!token.address) {
        return;
      }
      const key = token.address.toLowerCase();
      if (seenAddresses.has(key)) {
        return;
      }
      seenAddresses.add(key);
      tokens.push({
        ...token,
        address: token.address.toLowerCase()
      });
    };

    (this.builtInTokens[networkKey] || []).forEach(appendToken);
    (this.customTokens[networkKey] || []).forEach(appendToken);

    return tokens;
  }

  getCustomTokens(networkKey: string): Token[] {
    return this.customTokens[networkKey] || [];
  }

  findTokenBySymbol(networkKey: string, symbol: string): Token | undefined {
    const tokens = this.getTokensForNetwork(networkKey);
    return tokens.find(t => t.symbol.toLowerCase() === symbol.toLowerCase());
  }

  addCustomToken(networkKey: string, token: Token): void {
    if (!this.customTokens[networkKey]) {
      this.customTokens[networkKey] = [];
    }

    const address = token.address?.toLowerCase() || '';
    const existingIndex = this.customTokens[networkKey].findIndex(
      t => t.address?.toLowerCase() === address
    );

    if (existingIndex >= 0) {
      this.customTokens[networkKey][existingIndex] = {
        ...this.customTokens[networkKey][existingIndex],
        ...token,
        address
      };
    } else {
      this.customTokens[networkKey].push({
        ...token,
        address
      });
    }

    this.saveCustomTokens();
  }

  removeCustomToken(networkKey: string, address: string): void {
    if (!this.customTokens[networkKey]) return;
    this.customTokens[networkKey] = this.customTokens[networkKey].filter(
      t => t.address.toLowerCase() !== address.toLowerCase()
    );
    this.saveCustomTokens();
  }

  async setNetwork(networkKey: string, options: SetNetworkOptions = {}): Promise<void> {
    const persist = options.persist ?? true;
    this.config.network = networkKey;
    await this.wallet.setNetwork(networkKey);

    if (persist && process.env.NODE_ENV !== 'test') {
      this.storage.writeJSON(this.configPath, this.config);
    }
  }
}
