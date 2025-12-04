export interface EncryptionResult {
  encrypted: string;
  salt: string;
  iv: string;
  authTag: string;
}

export interface EncryptedWallet {
  name: string;
  encryptedMnemonic: string;
  salt: string;
  iv: string;
  authTag: string;
  network: string;
  currentAccountIndex: number;
  createdAt: string;
}

export interface WalletsFile {
  version: string;
  wallets: EncryptedWallet[];
}

export interface PortfolioToken {
  symbol: string;
  balance: string;
  formattedBalance: string;
  address?: string;
  type: 'native' | 'erc20';
  name?: string;
  decimals?: number;
}

export interface TransactionResult {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed?: string;
  blockNumber?: number;
}

export interface TokenMetadata {
  symbol: string;
  decimals: number;
  name: string;
}
