/**
 * Explorer API Integration
 * 
 * Fetches transaction history from block explorer APIs (Etherscan-compatible).
 * Uses explorerApiUrl from network config.
 */

export interface ExplorerTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  txreceipt_status: string;
  functionName?: string;
  methodId?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
}

export interface NormalizedTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
  gasUsed: string;
  gasPrice: string;
  status: 'confirmed' | 'failed';
  type: 'send' | 'receive' | 'contract_interaction';
  network: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
}

interface NetworkExplorerConfig {
  apiUrl: string;
  chainId: number;
  apiKey?: string;
}

export class ExplorerAPI {
  private cache: Map<string, { data: NormalizedTransaction[]; timestamp: number }> = new Map();
  private cacheDuration = 30000; // 30 seconds cache
  private networkConfigs: Map<string, NetworkExplorerConfig> = new Map();
  private globalApiKey?: string;
  // Etherscan V2 unified endpoint
  private static V2_BASE_URL = 'https://api.etherscan.io/v2/api';

  /**
   * Set a global API key that applies to all networks
   */
  setApiKey(apiKey: string): void {
    this.globalApiKey = apiKey;
  }

  /**
   * Register a network's explorer API config
   */
  registerNetwork(network: string, explorerApiUrl: string, chainId: number, apiKey?: string): void {
    this.networkConfigs.set(network, { apiUrl: explorerApiUrl, chainId, apiKey });
  }

  /**
   * Register multiple networks at once, with optional global API key
   */
  registerNetworks(networks: Record<string, { explorerApiUrl?: string; chainId: number; explorerApiKey?: string }>, globalApiKey?: string): void {
    if (globalApiKey) {
      this.globalApiKey = globalApiKey;
    }
    for (const [network, config] of Object.entries(networks)) {
      if (config.explorerApiUrl) {
        this.networkConfigs.set(network, {
          apiUrl: config.explorerApiUrl,
          chainId: config.chainId,
          apiKey: config.explorerApiKey
        });
      }
    }
  }
  
  /**
   * Get the API key for a network (per-network or global)
   */
  private getApiKey(network: string): string | undefined {
    const config = this.networkConfigs.get(network);
    return config?.apiKey || this.globalApiKey;
  }

  /**
   * Get list of registered networks (for debugging)
   */
  getRegisteredNetworks(): string[] {
    return Array.from(this.networkConfigs.keys());
  }

  /**
   * Check if a network has explorer API support
   */
  isSupported(network: string): boolean {
    return this.networkConfigs.has(network);
  }

  /**
   * Fetch transaction history for an address from block explorer
   */
  async getTransactionHistory(
    address: string,
    network: string,
    page: number = 1,
    pageSize: number = 50
  ): Promise<NormalizedTransaction[]> {
    const cacheKey = `${network}:${address}:${page}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const config = this.networkConfigs.get(network);
    if (!config) {
      console.warn(`No explorer configured for network: ${network}`);
      return [];
    }

    try {
      // Fetch normal transactions
      const normalTxs = await this.fetchTransactions(
        config,
        address,
        'txlist',
        page,
        pageSize
      );

      // Fetch internal transactions (optional, for contract interactions)
      // const internalTxs = await this.fetchTransactions(config, address, 'txlistinternal', page, pageSize);

      // Normalize and merge
      const normalized = this.normalizeTransactions(normalTxs, address, network);

      // Cache the result
      this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });

      return normalized;
    } catch (error) {
      console.error(`Failed to fetch transactions from ${network} explorer:`, error);
      return [];
    }
  }

  /**
   * Fetch ERC-20 token transfers for an address
   */
  async getTokenTransfers(
    address: string,
    network: string,
    page: number = 1,
    pageSize: number = 50
  ): Promise<NormalizedTransaction[]> {
    const cacheKey = `${network}:${address}:tokens:${page}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const config = this.networkConfigs.get(network);
    if (!config) {
      return [];
    }

    try {
      const tokenTxs = await this.fetchTransactions(
        config,
        address,
        'tokentx',
        page,
        pageSize
      );

      const normalized = this.normalizeTokenTransfers(tokenTxs, address, network);
      this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });

      return normalized;
    } catch (error) {
      console.error(`Failed to fetch token transfers from ${network} explorer:`, error);
      return [];
    }
  }

  /**
   * Get combined transaction history (ETH + tokens)
   */
  async getAllTransactions(
    address: string,
    network: string,
    page: number = 1,
    pageSize: number = 25
  ): Promise<NormalizedTransaction[]> {
    // Fetch sequentially to avoid rate limiting (free tier is 5 req/sec)
    const ethTxs = await this.getTransactionHistory(address, network, page, pageSize);
    await this.sleep(300); // Small delay between requests
    const tokenTxs = await this.getTokenTransfers(address, network, page, pageSize);

    // Merge and sort by timestamp (newest first)
    const allTxs = [...ethTxs, ...tokenTxs];
    allTxs.sort((a, b) => b.timestamp - a.timestamp);

    // Remove duplicates (same hash)
    const seen = new Set<string>();
    return allTxs.filter(tx => {
      if (seen.has(tx.hash)) return false;
      seen.add(tx.hash);
      return true;
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchTransactions(
    config: NetworkExplorerConfig,
    address: string,
    action: string,
    page: number,
    pageSize: number,
    retryCount: number = 0
  ): Promise<ExplorerTransaction[]> {
    // Build params for Etherscan V2 API
    const params = new URLSearchParams({
      chainid: config.chainId.toString(),
      module: 'account',
      action,
      address,
      startblock: '0',
      endblock: '99999999',
      page: page.toString(),
      offset: pageSize.toString(),
      sort: 'desc'
    });

    // API key: use per-network key, or fall back to global key
    const apiKey = config.apiKey || this.globalApiKey;
    if (apiKey) {
      params.set('apikey', apiKey);
    }

    // Use V2 unified endpoint
    const url = `${ExplorerAPI.V2_BASE_URL}?${params}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn(`Explorer API returned status ${response.status}`);
        return [];
      }
      
      const data = await response.json() as { status: string; message: string; result: ExplorerTransaction[] | string };

      if (data.status === '1' && Array.isArray(data.result)) {
        return data.result;
      }

      // Status 0 with "No transactions found" is not an error
      if (data.message === 'No transactions found') {
        return [];
      }

      // Handle missing API key error
      if (data.result === 'Missing/Invalid API Key' || data.message?.includes('Invalid API Key')) {
        console.warn('Explorer API requires an API key. Get one from https://etherscan.io/apis');
        return [];
      }

      // Handle rate limiting with retry
      if (data.message?.includes('Max rate limit') || data.message?.includes('NOTOK') || data.result === 'Max rate limit reached') {
        if (retryCount < 2) {
          const delay = (retryCount + 1) * 1500; // 1.5s, 3s delays
          console.log(`Explorer API rate limited, retrying in ${delay}ms...`);
          await this.sleep(delay);
          return this.fetchTransactions(config, address, action, page, pageSize, retryCount + 1);
        }
        console.warn('Explorer API rate limited after retries:', data.message);
        return [];
      }

      // If result is a string (error message), log and return empty
      if (typeof data.result === 'string') {
        console.warn('Explorer API error:', data.result);
        return [];
      }

      console.warn('Explorer API unexpected response:', data.message);
      return [];
    } catch (error) {
      console.error('Failed to fetch from explorer API:', error);
      return [];
    }
  }

  private normalizeTransactions(
    txs: ExplorerTransaction[],
    address: string,
    network: string
  ): NormalizedTransaction[] {
    const lowerAddress = address.toLowerCase();

    return txs.map(tx => {
      const isSend = tx.from.toLowerCase() === lowerAddress;
      const isReceive = tx.to.toLowerCase() === lowerAddress;
      const isContract = tx.functionName || tx.methodId !== '0x';

      let type: 'send' | 'receive' | 'contract_interaction';
      if (isContract && !isReceive) {
        type = 'contract_interaction';
      } else if (isSend) {
        type = 'send';
      } else {
        type = 'receive';
      }

      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: tx.value,
        timestamp: parseInt(tx.timeStamp) * 1000,
        blockNumber: parseInt(tx.blockNumber),
        gasUsed: tx.gasUsed,
        gasPrice: tx.gasPrice,
        status: tx.isError === '0' && tx.txreceipt_status === '1' ? 'confirmed' : 'failed',
        type,
        network
      };
    });
  }

  private normalizeTokenTransfers(
    txs: ExplorerTransaction[],
    address: string,
    network: string
  ): NormalizedTransaction[] {
    const lowerAddress = address.toLowerCase();

    return txs.map(tx => {
      const isSend = tx.from.toLowerCase() === lowerAddress;

      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: tx.value,
        timestamp: parseInt(tx.timeStamp) * 1000,
        blockNumber: parseInt(tx.blockNumber),
        gasUsed: tx.gasUsed || '0',
        gasPrice: tx.gasPrice || '0',
        status: 'confirmed' as const,
        type: isSend ? 'send' : 'receive',
        network,
        tokenSymbol: tx.tokenSymbol,
        tokenAddress: tx.contractAddress,
        tokenDecimals: tx.tokenDecimal ? parseInt(tx.tokenDecimal) : undefined
      };
    });
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get list of supported networks
   */
  getSupportedNetworks(): string[] {
    return Array.from(this.networkConfigs.keys());
  }
}

// Singleton instance for the extension
export const explorerAPI = new ExplorerAPI();
