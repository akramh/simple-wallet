import { ethers } from 'ethers';
import type { Config } from './types/index.js';

export interface ProviderFactory {
  createProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider;
}

// Default provider factory creating ethers JsonRpcProvider instances.
export class DefaultProviderFactory implements ProviderFactory {
  createProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(rpcUrl, chainId);
  }
}

export function createProviderFactory(): ProviderFactory {
  return new DefaultProviderFactory();
}
