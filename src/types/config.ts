export interface NetworkConfig {
  rpcUrl: string | string[];
  chainId: number;
  nativeSymbol: string;
  nativeName: string;
  blockExplorer?: string;
  name?: string;
}

export interface Config {
  defaultNetwork: string;
  network: string;
  networks: Record<string, NetworkConfig>;
}

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  name: string;
  type?: 'native' | 'erc20';
}

export type TokenRegistry = Record<string, Token[]>;
