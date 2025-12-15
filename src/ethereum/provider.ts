/**
 * @fileoverview Ethereum provider handling RPC connections and chain interactions.
 */

import { ethers } from 'ethers';
import { Config, Token, TokenMetadata } from '../types/index.js';
import { ProviderFactory } from '../providers.js';
import { ERC20_ABI, EthereumPortfolioResult, EthereumTransactionReceipt } from './types.js';

export class EthereumProvider {
  private config: Config;
  private providerFactory: ProviderFactory;
  
  // State managed by this provider
  private provider: ethers.JsonRpcProvider | null = null;
  private providers: Record<string, ethers.JsonRpcProvider> = {};
  private rpcIndex: Record<string, number> = {};
  private tokenMetadataCache: Record<string, TokenMetadata> = {};
  
  // Injectable Contract class for testing
  ContractClass: typeof ethers.Contract = ethers.Contract;

  constructor(config: Config, providerFactory?: ProviderFactory) {
    this.config = config;
    this.providerFactory = providerFactory || {
      createProvider: (rpcUrl: string, chainId: number) => new ethers.JsonRpcProvider(rpcUrl, chainId)
    };
  }

  /**
   * Execute an RPC operation with exponential backoff retry.
   */
  async retryRpcRequest<T>(operation: () => Promise<T>, maxRetries: number = 3, baseDelay: number = 1000): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await Promise.race<T>([
          operation(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), 30000)
          )
        ]);
        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Get the current active provider.
   */
  getProvider(): ethers.JsonRpcProvider | null {
    return this.provider;
  }

  setProviderFactory(factory: ProviderFactory) {
    this.providerFactory = factory;
  }

  /**
   * Get list of RPC URLs for a network.
   */
  private getRpcList(networkKey: string): string[] {
    const networkConfig = this.config.networks[networkKey];
    if (!networkConfig) return [];
    if (networkConfig.type && networkConfig.type !== 'evm') return []; // Only for EVM (or undefined/implied)

    const urls: string[] = [];
    if (networkConfig.rpcUrl) {
      if (Array.isArray(networkConfig.rpcUrl)) {
        urls.push(...networkConfig.rpcUrl);
      } else {
        urls.push(networkConfig.rpcUrl);
      }
    }
    return [...new Set(urls)];
  }

  /**
   * Ensure a working provider exists for the network.
   */
  async ensureProvider(networkKey: string): Promise<ethers.JsonRpcProvider> {
    const networkConfig = this.config.networks[networkKey];
    if (networkConfig?.type && networkConfig.type !== 'evm') {
      throw new Error(`Network ${networkKey} is not an EVM network`);
    }

    const rpcList = this.getRpcList(networkKey);
    if (!rpcList.length) {
      throw new Error('No RPC URLs configured for network');
    }

    if (this.providers[networkKey]) {
      this.provider = this.providers[networkKey];
      return this.provider;
    }

    let lastError: Error | undefined;
    for (let i = 0; i < rpcList.length; i++) {
      const rpcUrl = rpcList[i];
      const chainId = (networkConfig as { chainId: number }).chainId;
      const candidate = this.providerFactory.createProvider(rpcUrl, chainId);
      
      try {
        await this.retryRpcRequest(() => candidate.getBlockNumber(), 2, 2000);
        this.providers[networkKey] = candidate;
        this.rpcIndex[networkKey] = i;
        this.provider = candidate;
        return candidate;
      } catch (error) {
        lastError = error as Error;
      }
    }

    throw new Error(`All RPC endpoints failed for ${networkKey}: ${lastError?.message || 'unknown error'}`);
  }

  /**
   * Get native currency balance (ETH).
   */
  async getBalance(address: string): Promise<string> {
    if (!this.provider) throw new Error('No provider connected');

    try {
      const balance = await this.retryRpcRequest(
        () => this.provider!.getBalance(address),
        3,
        1000
      );
      return ethers.formatEther(balance);
    } catch (error) {
      if ((error as Error).message.includes('timeout')) {
        throw new Error('Network request timed out. Please check your internet connection or try a different RPC endpoint.');
      }
      throw error;
    }
  }

  /**
   * Get token contract instance.
   */
  getTokenContract(address: string, signer?: ethers.Signer): ethers.Contract {
    if (!this.provider) throw new Error('No provider connected');
    return new this.ContractClass(address, ERC20_ABI, signer || this.provider);
  }

  /**
   * Get token metadata.
   */
  async getTokenMetadata(address: string): Promise<TokenMetadata> {
    if (!address) throw new Error('Token address is required');

    const key = address.toLowerCase();
    if (this.tokenMetadataCache[key]) {
      return this.tokenMetadataCache[key];
    }

    const contract = this.getTokenContract(address);

    try {
      const [symbol, name, decimals] = await Promise.all([
        this.retryRpcRequest(() => contract.symbol()),
        this.retryRpcRequest(() => contract.name()),
        this.retryRpcRequest(() => contract.decimals())
      ]);

      const meta: TokenMetadata = {
        symbol,
        name,
        decimals: Number(decimals)
      };

      this.tokenMetadataCache[key] = meta;
      return meta;
    } catch (error) {
      throw new Error(`Unable to fetch token metadata: ${(error as Error).message}`);
    }
  }

  /**
   * Get token balance.
   */
  async getTokenBalance(token: Token, address: string): Promise<string> {
    if (!this.provider) throw new Error('No provider connected');

    if (token.type === 'native') {
      return this.getBalance(address);
    }

    const decimals = typeof token.decimals === 'number' 
      ? token.decimals 
      : (await this.getTokenMetadata(token.address)).decimals;

    const contract = this.getTokenContract(token.address);

    try {
      const balance = await this.retryRpcRequest(() => contract.balanceOf(address));
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      const err = error as any;
      if (err.code === 'BAD_DATA') {
        throw new Error('Token read failed: RPC returned empty/invalid data (check token address, network, or try another RPC)');
      }
      if (err.message?.includes('timeout')) {
        throw new Error('Token balance request timed out. Try again or switch RPC.');
      }
      throw error;
    }
  }

  /**
   * Get portfolio balances.
   */
  async getPortfolio(tokens: Token[], address: string): Promise<EthereumPortfolioResult[]> {
    const promises = tokens.map(async (token): Promise<EthereumPortfolioResult> => {
      try {
        const balance = await this.getTokenBalance(token, address);
        return { token, balance };
      } catch (error) {
        return { token, balance: 'Error', error: (error as Error).message };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Send native ETH transaction.
   */
  async sendTransaction(signer: ethers.Signer, toAddress: string, amount: string): Promise<EthereumTransactionReceipt> {
    if (!this.provider) throw new Error('No provider connected');

    try {
      const value = ethers.parseEther(amount);
      const fromAddress = await signer.getAddress();
      const balance = await this.retryRpcRequest(() => this.provider!.getBalance(fromAddress));

      let gasLimit: bigint;
      let gasPrice: bigint;
      try {
        gasLimit = await this.retryRpcRequest(() =>
          this.provider!.estimateGas({
            to: toAddress,
            value: value,
            from: fromAddress
          })
        );
        gasLimit = (gasLimit * 120n) / 100n;

        const feeData = await this.retryRpcRequest(() => this.provider!.getFeeData());
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        gasLimit = 21000n;
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      const estimatedGasCost = gasLimit * gasPrice;
      const totalCost = value + estimatedGasCost;

      if (balance < totalCost) {
        const balanceEth = ethers.formatEther(balance);
        const neededEth = ethers.formatEther(totalCost);
        const gasCostEth = ethers.formatEther(estimatedGasCost);
        throw new Error(
          `Insufficient balance. You have ${balanceEth} ETH but need ${neededEth} ETH (${amount} ETH + ~${gasCostEth} ETH gas)`
        );
      }

      const tx = await signer.sendTransaction({
        to: toAddress,
        value: value,
        gasLimit: gasLimit
      });

      const receipt = await this.retryRpcRequest<ethers.TransactionReceipt | null>(
        () => tx.wait(),
        5,
        2000
      );

      if (!receipt) {
        throw new Error('Transaction receipt not received');
      }

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      const err = error as any;
      if (err.message?.includes('insufficient funds')) {
        throw new Error('Insufficient funds for transaction');
      }
      if (err.message?.includes('nonce')) {
        throw new Error('Transaction nonce error. Please try again.');
      }
      if (err.message?.includes('gas')) {
        throw new Error(`Gas estimation failed: ${err.message}`);
      }
      if (err.code === 'CALL_EXCEPTION') {
        throw new Error('Transaction would fail. Check recipient address and amount.');
      }

      throw error;
    }
  }

  /**
   * Send ERC-20 Token transaction.
   */
  async sendToken(signer: ethers.Signer, token: Token, toAddress: string, amount: string): Promise<EthereumTransactionReceipt> {
    if (!this.provider) throw new Error('No provider connected');

    if (token.type === 'native') {
      return this.sendTransaction(signer, toAddress, amount);
    }

    try {
      const decimals = typeof token.decimals === 'number' 
      ? token.decimals 
      : (await this.getTokenMetadata(token.address)).decimals;
      
      const value = ethers.parseUnits(amount, decimals);
      const contract = this.getTokenContract(token.address, signer);
      const fromAddress = await signer.getAddress();
      const nativeBalance = await this.retryRpcRequest(() => this.provider!.getBalance(fromAddress));

      let gasLimit: bigint;
      let gasPrice: bigint;
      try {
        gasLimit = await this.retryRpcRequest(() => contract.transfer.estimateGas(toAddress, value));
        gasLimit = (gasLimit * 120n) / 100n;

        const feeData = await this.retryRpcRequest(() => this.provider!.getFeeData());
        gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
      } catch (gasError) {
        gasLimit = 120000n;
        gasPrice = ethers.parseUnits('20', 'gwei');
      }

      const estimatedGasCost = gasPrice ? gasLimit * gasPrice : 0n;
      if (nativeBalance < estimatedGasCost) {
        const neededEth = ethers.formatEther(estimatedGasCost);
        const balanceEth = ethers.formatEther(nativeBalance);
        throw new Error(`Insufficient ETH for gas. Need ~${neededEth} ETH, have ${balanceEth} ETH.`);
      }

      const tx = await this.retryRpcRequest(() => contract.transfer(toAddress, value, { gasLimit }));
      const receipt = await this.retryRpcRequest<ethers.TransactionReceipt | null>(() => tx.wait(), 5, 2000);

      if (!receipt) {
        throw new Error('Transaction receipt not received');
      }

      return {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      const err = error as any;
      if (err.message?.includes('insufficient funds')) {
        throw new Error('Insufficient balance for token transfer');
      }
      if (err.code === 'CALL_EXCEPTION') {
        throw new Error('Token transfer would fail. Check recipient and amount.');
      }
      throw error;
    }
  }
}
