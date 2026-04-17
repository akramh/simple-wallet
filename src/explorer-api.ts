/**
 * @file explorer-api.ts
 * @description Block explorer API integration for fetching on-chain transaction history.
 * 
 * Provides a unified interface to Etherscan-compatible APIs across multiple networks
 * using the Etherscan V2 unified endpoint. Supports both native ETH transactions and
 * ERC-20 token transfers with built-in caching, rate limiting, and retry logic.
 * 
 * @responsibilities
 * - Fetch native and token transaction history from block explorers
 * - Normalize transaction data from various explorer API formats
 * - Cache results to reduce API calls (30s default TTL)
 * - Handle rate limiting with exponential backoff
 * - Support multiple networks with per-network or global API keys
 * 
 * @dependencies
 * - Uses native fetch API for HTTP requests
 * - Designed for Etherscan V2 API (works with Etherscan, Polygonscan, etc.)
 * 
 * @example
 * ```typescript
 * import { explorerAPI } from './explorer-api.js';
 * 
 * explorerAPI.setApiKey('YOUR_ETHERSCAN_API_KEY');
 * explorerAPI.registerNetwork('mainnet', 'https://api.etherscan.io', 1);
 * 
 * const txs = await explorerAPI.getAllTransactions(address, 'mainnet');
 * ```
 */

/**
 * Raw transaction data returned from Etherscan-compatible explorer APIs.
 * Represents the exact structure returned by the API before normalization.
 */
export interface ExplorerTransaction {
  /** Transaction hash (0x-prefixed) */
  hash: string;
  /** Sender address */
  from: string;
  /** Recipient address (may be empty for contract creation) */
  to: string;
  /** Transaction value in wei */
  value: string;
  /** Unix timestamp as string */
  timeStamp: string;
  /** Block number as string */
  blockNumber: string;
  /** Gas used by the transaction */
  gasUsed: string;
  /** Gas price in wei */
  gasPrice: string;
  /** '0' for success, '1' for error */
  isError: string;
  /** Receipt status: '1' for success, '0' for failure */
  txreceipt_status: string;
  /** Decoded function name (if available) */
  functionName?: string;
  /** First 4 bytes of input data (function selector) */
  methodId?: string;
  /** Contract address for token transfers */
  contractAddress?: string;
  /** Token symbol for token transfers */
  tokenSymbol?: string;
  /** Token decimals as string for token transfers */
  tokenDecimal?: string;
}

/**
 * Normalized transaction data with consistent types and structure.
 * This is the standardized format used throughout the application.
 */
export interface NormalizedTransaction {
  /** Transaction hash (0x-prefixed) */
  hash: string;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** Transaction value in wei */
  value: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Block number (numeric) */
  blockNumber: number;
  /** Gas used by the transaction */
  gasUsed: string;
  /** Gas price in wei */
  gasPrice: string;
  /** Transaction confirmation status */
  status: 'confirmed' | 'failed';
  /** Transaction type based on direction and contract interaction */
  type: 'send' | 'receive' | 'contract_interaction';
  /** Network identifier (e.g., 'mainnet', 'sepolia') */
  network: string;
  /** Token symbol for token transfers */
  tokenSymbol?: string;
  /** Token contract address for token transfers */
  tokenAddress?: string;
  /** Token decimals for token transfers */
  tokenDecimals?: number;
}

/**
 * Configuration for a network's block explorer API.
 * @internal
 */
interface NetworkExplorerConfig {
  /** Base URL for the explorer API (Etherscan V2 fallback path) */
  apiUrl: string;
  /** Chain ID for Etherscan V2 unified endpoint */
  chainId: number;
  /** Optional per-network API key (overrides global key) */
  apiKey?: string;
  /**
   * Alchemy RPC URL (with embedded key) for this network, if available.
   * When set and the network is in {@link ALCHEMY_TRANSFERS_NETWORKS},
   * `getAllTransactions` dispatches to `alchemy_getAssetTransfers` instead
   * of hitting Etherscan.
   */
  alchemyRpcUrl?: string;
}

/**
 * Block explorer API client for fetching on-chain transaction history.
 * 
 * Supports Etherscan V2 unified API which provides access to multiple EVM chains
 * through a single endpoint. Includes built-in caching, rate limit handling,
 * and transaction normalization.
 * 
 * @example
 * ```typescript
 * const explorer = new ExplorerAPI();
 * explorer.setApiKey('YOUR_API_KEY');
 * explorer.registerNetwork('mainnet', 'https://api.etherscan.io', 1);
 * 
 * const history = await explorer.getAllTransactions(
 *   '0x...',
 *   'mainnet',
 *   1,  // page
 *   50  // pageSize
 * );
 * ```
 */
import {
  ALCHEMY_TRANSFERS_NETWORKS,
  AlchemyTransfersClient,
  extractAlchemyUrl,
} from './ethereum/alchemy-transfers.js';

export class ExplorerAPI {
  /** In-memory cache for transaction data with TTL */
  private cache: Map<string, { data: NormalizedTransaction[]; timestamp: number }> = new Map();

  /** Cache time-to-live in milliseconds (30 seconds) */
  private cacheDuration = 30000;

  /** Registered network configurations indexed by network name */
  private networkConfigs: Map<string, NetworkExplorerConfig> = new Map();

  /** Cached Alchemy client per network, created lazily on first use. */
  private alchemyClients: Map<string, AlchemyTransfersClient> = new Map();

  /** Global API key applied to all networks unless overridden */
  private globalApiKey?: string;

  /** Etherscan V2 unified endpoint base URL */
  private static V2_BASE_URL = 'https://api.etherscan.io/v2/api';

  /**
   * Sets a global API key that applies to all registered networks.
   * Per-network API keys take precedence over the global key.
   * 
   * @param apiKey - Etherscan API key (get from https://etherscan.io/apis)
   * 
   * @example
   * ```typescript
   * explorer.setApiKey('YOUR_ETHERSCAN_API_KEY');
   * ```
   */
  setApiKey(apiKey: string): void {
    this.globalApiKey = apiKey;
  }

  /**
   * Registers a single network's explorer API configuration.
   * 
   * @param network - Network identifier (e.g., 'mainnet', 'polygon')
   * @param explorerApiUrl - Base URL for the explorer API
   * @param chainId - EVM chain ID for Etherscan V2 endpoint
   * @param apiKey - Optional per-network API key (overrides global)
   * 
   * @example
   * ```typescript
   * explorer.registerNetwork('polygon', 'https://api.polygonscan.com', 137);
   * ```
   */
  registerNetwork(network: string, explorerApiUrl: string, chainId: number, apiKey?: string): void {
    this.networkConfigs.set(network, { apiUrl: explorerApiUrl, chainId, apiKey });
  }

  /**
   * Registers multiple networks from a configuration object.
   * Typically called with the networks from the app config.
   * 
   * @param networks - Map of network names to their configurations
   * @param globalApiKey - Optional global API key to set for all networks
   * 
   * @example
   * ```typescript
   * explorer.registerNetworks({
   *   mainnet: { explorerApiUrl: 'https://api.etherscan.io', chainId: 1 },
   *   polygon: { explorerApiUrl: 'https://api.polygonscan.com', chainId: 137 }
   * }, 'GLOBAL_API_KEY');
   * ```
   */
  registerNetworks(
    networks: Record<
      string,
      {
        explorerApiUrl?: string;
        chainId?: number;
        explorerApiKey?: string;
        type?: string;
        rpcUrl?: string | string[];
      }
    >,
    globalApiKey?: string,
  ): void {
    if (globalApiKey) {
      this.globalApiKey = globalApiKey;
    }
    for (const [network, config] of Object.entries(networks)) {
      // Skip non-EVM networks — Bitcoin/Solana/XRP/TON use dedicated explorers.
      if (config.type === 'bitcoin' || config.type === 'solana' || config.type === 'xrp' || config.type === 'ton') {
        continue;
      }
      const alchemyRpcUrl = extractAlchemyUrl(config.rpcUrl);
      const hasEtherscan = !!config.explorerApiUrl && config.chainId !== undefined;
      const hasAlchemy = !!alchemyRpcUrl && ALCHEMY_TRANSFERS_NETWORKS.has(network);
      // Register the network if ANY history source is available. Previously we
      // required explorerApiUrl + chainId; now networks with only an Alchemy
      // URL (e.g. base, arbitrum, optimism, polygon) are supported too.
      if (!hasEtherscan && !hasAlchemy) continue;
      this.networkConfigs.set(network, {
        apiUrl: config.explorerApiUrl ?? '',
        chainId: config.chainId ?? 0,
        apiKey: config.explorerApiKey,
        alchemyRpcUrl,
      });
    }
  }
  
  /**
   * Gets the effective API key for a network.
   * Returns the per-network key if set, otherwise falls back to global key.
   * 
   * @param network - Network identifier
   * @returns API key string or undefined if no key is configured
   * @internal
   */
  private getApiKey(network: string): string | undefined {
    const config = this.networkConfigs.get(network);
    return config?.apiKey || this.globalApiKey;
  }

  /**
   * Gets the list of all registered network names.
   * Useful for debugging and UI network selectors.
   * 
   * @returns Array of registered network identifiers
   */
  getRegisteredNetworks(): string[] {
    return Array.from(this.networkConfigs.keys());
  }

  /**
   * Checks if a network has been registered with explorer API support.
   * 
   * @param network - Network identifier to check
   * @returns true if the network is registered, false otherwise
   */
  isSupported(network: string): boolean {
    return this.networkConfigs.has(network);
  }

  /**
   * Fetches native ETH/token transaction history for an address.
   * Results are cached for 30 seconds to reduce API calls.
   * 
   * @param address - Ethereum address to fetch history for
   * @param network - Network identifier (must be registered)
   * @param page - Page number for pagination (1-indexed)
   * @param pageSize - Number of transactions per page (max 10000)
   * @returns Array of normalized transactions, newest first. Returns empty array on error.
   * 
   * @example
   * ```typescript
   * const txs = await explorer.getTransactionHistory(
   *   '0x742d35Cc6634C0532925a3b844Bc9e7595f...',
   *   'mainnet',
   *   1,
   *   50
   * );
   * ```
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
   * Fetches ERC-20 token transfer history for an address.
   * Results are cached separately from native transactions.
   * 
   * @param address - Ethereum address to fetch token transfers for
   * @param network - Network identifier (must be registered)
   * @param page - Page number for pagination (1-indexed)
   * @param pageSize - Number of transfers per page (max 10000)
   * @returns Array of normalized token transfers, newest first
   * 
   * @remarks
   * Token transfers include additional fields: tokenSymbol, tokenAddress, tokenDecimals
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
   * Fetches combined transaction history including both native ETH and ERC-20 tokens.
   * Merges and deduplicates results from both endpoints.
   * 
   * @param address - Ethereum address to fetch history for
   * @param network - Network identifier (must be registered)
   * @param page - Page number for pagination (1-indexed)
   * @param pageSize - Number of transactions per page (applied to each type)
   * @returns Merged array of transactions sorted by timestamp (newest first)
   * 
   * @remarks
   * Includes a 300ms delay between API calls to avoid rate limiting on free tier.
   * Duplicates (same transaction hash) are automatically removed.
   */
  async getAllTransactions(
    address: string,
    network: string,
    page: number = 1,
    pageSize: number = 25
  ): Promise<NormalizedTransaction[]> {
    // Prefer Alchemy Transfers API for supported networks (eth/sepolia/base/
    // polygon/arbitrum/optimism). Covers native + ERC-20 (+ internal on
    // eth/polygon) in two parallel calls — no per-category request + delay.
    const config = this.networkConfigs.get(network);
    if (config?.alchemyRpcUrl && ALCHEMY_TRANSFERS_NETWORKS.has(network)) {
      let client = this.alchemyClients.get(network);
      if (!client) {
        client = new AlchemyTransfersClient(config.alchemyRpcUrl, network);
        this.alchemyClients.set(network, client);
      }
      return client.getAllTransactions(address, network, page, pageSize);
    }

    // Etherscan V2 path (avalanche/bsc/linea, and any other EVM network
    // without an Alchemy URL): fetch sequentially to respect 5 req/sec free
    // tier limits.
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

  /**
   * Utility function to pause execution for rate limiting.
   * @param ms - Milliseconds to sleep
   * @internal
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetches raw transaction data from the Etherscan V2 API.
   * Handles rate limiting with automatic retry and exponential backoff.
   * 
   * @param config - Network explorer configuration
   * @param address - Address to fetch transactions for
   * @param action - API action: 'txlist', 'txlistinternal', or 'tokentx'
   * @param page - Page number (1-indexed)
   * @param pageSize - Results per page
   * @param retryCount - Current retry attempt (for rate limit backoff)
   * @returns Array of raw explorer transactions, empty array on error
   * @internal
   */
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

  /**
   * Normalizes raw explorer transaction data to a consistent format.
   * Determines transaction type based on address relationship and function calls.
   * 
   * @param txs - Raw explorer transactions to normalize
   * @param address - User's address (for determining send/receive)
   * @param network - Network identifier to include in result
   * @returns Array of normalized transactions
   * @internal
   */
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

  /**
   * Normalizes raw token transfer data to a consistent format.
   * Includes token-specific fields like symbol, address, and decimals.
   * 
   * @param txs - Raw explorer token transfers to normalize
   * @param address - User's address (for determining send/receive)
   * @param network - Network identifier to include in result
   * @returns Array of normalized token transfers
   * @internal
   */
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
   * Clears the entire transaction cache.
   * Useful when switching wallets or networks to force fresh data.
   */
  clearCache(): void {
    this.cache.clear();
    for (const client of this.alchemyClients.values()) {
      client.clearCache();
    }
  }

  /**
   * Gets the list of networks with registered explorer configurations.
   * Alias for {@link getRegisteredNetworks}.
   * 
   * @returns Array of network identifiers
   */
  getSupportedNetworks(): string[] {
    return Array.from(this.networkConfigs.keys());
  }
}

/**
 * Singleton ExplorerAPI instance for use throughout the application.
 * Pre-configured for use in both CLI and browser extension contexts.
 * 
 * @example
 * ```typescript
 * import { explorerAPI } from './explorer-api.js';
 * 
 * explorerAPI.setApiKey(config.etherscanApiKey);
 * explorerAPI.registerNetworks(config.networks);
 * ```
 */
export const explorerAPI = new ExplorerAPI();
