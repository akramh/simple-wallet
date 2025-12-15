/**
 * @fileoverview XRP Ledger API client for blockchain data.
 *
 * Provides access to XRP Ledger data including account balances,
 * transaction history, and fee estimates via the XRP Ledger JSON-RPC API.
 *
 * @module xrp/explorer
 */

import { Client } from 'xrpl';
import type {
  XRPBalance,
  NormalizedXRPTransaction,
  XRPFeeEstimate,
} from './types.js';
import {
  dropsToXrp,
  XRP_RESERVE_BASE,
  XRP_RESERVE_INCREMENT,
  BASE_FEE_DROPS,
  DROPS_PER_XRP,
} from './types.js';

/**
 * XRP Ledger RPC URLs for different networks.
 */
const XRP_RPC_URLS: Record<string, string[]> = {
  mainnet: [
    'wss://xrplcluster.com',
    'wss://s1.ripple.com',
    'wss://s2.ripple.com',
  ],
  testnet: [
    'wss://s.altnet.rippletest.net:51233',
  ],
  devnet: [
    'wss://s.devnet.rippletest.net:51233',
  ],
};

/**
 * Block explorer URLs for different networks.
 */
const EXPLORER_URLS: Record<string, string> = {
  mainnet: 'https://livenet.xrpl.org',
  testnet: 'https://testnet.xrpl.org',
  devnet: 'https://devnet.xrpl.org',
};

/**
 * Request timeout in milliseconds.
 */
const REQUEST_TIMEOUT = 15000;

/**
 * Cache TTL in milliseconds (30 seconds).
 */
const CACHE_TTL = 30000;

/**
 * Simple in-memory cache for API responses.
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: Map<string, CacheEntry<unknown>> = new Map();

/**
 * Get cached data if still valid.
 */
function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Store data in cache.
 */
function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

type XRPReserves = {
  reserveBaseDrops: number;
  reserveIncrementDrops: number;
};

function parseReserveToDrops(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    // Heuristic: values < 1000 are almost certainly expressed as XRP.
    return value < 1000 ? Math.round(value * DROPS_PER_XRP) : Math.round(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    if (trimmed.includes('.')) {
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed)) return null;
      return Math.round(parsed * DROPS_PER_XRP);
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return null;
    return parsed < 1000 ? parsed * DROPS_PER_XRP : parsed;
  }

  return null;
}

/**
 * XRP Ledger explorer API client.
 *
 * Provides methods to fetch XRP Ledger data including:
 * - Account balances and reserve requirements
 * - Transaction history
 * - Fee rate estimates
 * - Server info
 *
 * Uses the official xrpl.js library for WebSocket communication.
 *
 * @example
 * ```typescript
 * const explorer = new XRPExplorer('mainnet');
 *
 * // Get balance
 * const balance = await explorer.getBalance('rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9');
 * console.log(`Balance: ${balance.total} drops`);
 * ```
 */
export class XRPExplorer {
  /** Network type */
  private network: 'mainnet' | 'testnet' | 'devnet';
  /** Network key for config */
  private networkKey: string;
  /** RPC URLs */
  private rpcUrls: string[];
  /** Active client connection */
  private client: Client | null = null;
  /** Connection promise (to avoid multiple connections) */
  private connecting: Promise<void> | null = null;

  /**
   * Create a new XRPExplorer instance.
   *
   * @param networkKey - Network identifier (e.g., 'xrp-mainnet')
   * @param customRpcUrls - Optional custom RPC URLs
   */
  constructor(
    networkKey: string,
    customRpcUrls?: string[]
  ) {
    this.networkKey = networkKey;
    this.network = networkKey.includes('testnet') ? 'testnet' :
                   networkKey.includes('devnet') ? 'devnet' : 'mainnet';
    this.rpcUrls = customRpcUrls || XRP_RPC_URLS[this.network] || XRP_RPC_URLS.mainnet;
  }

  /**
   * Get or create a connected client.
   */
  private async getClient(): Promise<Client> {
    if (this.client?.isConnected()) {
      return this.client;
    }

    // If already connecting, wait for it
    if (this.connecting) {
      await this.connecting;
      if (this.client?.isConnected()) {
        return this.client;
      }
    }

    // Try each RPC URL until one works
    let lastError: Error | undefined;

    this.connecting = (async () => {
      for (const url of this.rpcUrls) {
        try {
          const client = new Client(url, {
            timeout: REQUEST_TIMEOUT,
          });
          await client.connect();
          this.client = client;
          return;
        } catch (err) {
          lastError = err as Error;
        }
      }
      throw new Error(`Failed to connect to XRP Ledger: ${lastError?.message || 'unknown error'}`);
    })();

    await this.connecting;
    this.connecting = null;

    if (!this.client) {
      throw new Error('Failed to establish XRP Ledger connection');
    }

    return this.client;
  }

  /**
   * Disconnect the client.
   */
  async disconnect(): Promise<void> {
    if (this.client?.isConnected()) {
      await this.client.disconnect();
    }
    this.client = null;
  }

  /**
   * Get the current network.
   */
  getNetwork(): string {
    return this.network;
  }

  /**
   * Get the network key.
   */
  getNetworkKey(): string {
    return this.networkKey;
  }

  /**
   * Get the balance for an XRP account.
   *
   * @param address - XRP classic address (r...)
   * @returns Balance information with reserve calculations
   */
  async getBalance(address: string): Promise<XRPBalance> {
    const cacheKey = `balance:${this.networkKey}:${address}`;
    const cached = getCached<XRPBalance>(cacheKey);
    if (cached) return cached;

    try {
      const client = await this.getClient();

      const reserves = await this.getReserves();
      const response = await client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated',
      });

      const accountData = response.result.account_data;
      const total = parseInt(accountData.Balance, 10);
      const ownerCount = accountData.OwnerCount || 0;
      const reserved = reserves.reserveBaseDrops + (ownerCount * reserves.reserveIncrementDrops);
      const available = Math.max(0, total - reserved);

      const balance: XRPBalance = {
        total,
        reserved,
        available,
        isActivated: true,
        ownerCount,
      };

      setCache(cacheKey, balance);
      return balance;
    } catch (error: any) {
      // Handle "actNotFound" error (account not activated)
      if (error?.data?.error === 'actNotFound' || error?.message?.includes('actNotFound')) {
        const reserves = await this.getReserves();
        const balance: XRPBalance = {
          total: 0,
          reserved: reserves.reserveBaseDrops,
          available: 0,
          isActivated: false,
          ownerCount: 0,
        };
        return balance;
      }
      console.warn('[XRPExplorer] Failed to fetch balance:', error);
      return {
        total: 0,
        reserved: XRP_RESERVE_BASE,
        available: 0,
        isActivated: false,
        ownerCount: 0,
      };
    }
  }

  /**
   * Get the formatted balance in XRP.
   *
   * @param address - XRP address
   * @returns Balance in XRP as string
   */
  async getBalanceXRP(address: string): Promise<string> {
    const balance = await this.getBalance(address);
    return dropsToXrp(balance.total);
  }

  /**
   * Get transaction history for an account.
   *
   * @param address - XRP address
   * @param limit - Maximum number of transactions
   * @returns Normalized transactions for display
   */
  async getTransactionHistory(
    address: string,
    limit: number = 25
  ): Promise<NormalizedXRPTransaction[]> {
    const cacheKey = `txs:${this.networkKey}:${address}:${limit}`;
    const cached = getCached<NormalizedXRPTransaction[]>(cacheKey);
    if (cached) return cached;

    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'account_tx',
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit,
        forward: false, // Most recent first
      });

      const transactions = response.result.transactions || [];
      const normalized: NormalizedXRPTransaction[] = [];

      const parseDrops = (value: unknown): number | null => {
        if (typeof value === 'string') {
          if (!/^\d+$/.test(value)) return null;
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        }
        if (typeof value === 'number') {
          if (!Number.isFinite(value)) return null;
          // Drops must be an integer; if not, reject.
          if (!Number.isInteger(value)) return null;
          return value;
        }
        return null;
      };

      const getDeliveredDrops = (tx: any, meta: any): number | null => {
        // Prefer delivered_amount from metadata (partial payments, rippled API v2)
        const fromMeta = meta && typeof meta === 'object' ? (meta as any).delivered_amount : undefined;
        const metaDrops = parseDrops(fromMeta);
        if (metaDrops !== null) return metaDrops;

        // Standard Payment field (classic)
        const amountDrops = parseDrops(tx?.Amount);
        if (amountDrops !== null) return amountDrops;

        // Some servers/API versions may provide DeliverMax for XRP-native payments.
        const deliverMaxDrops = parseDrops(tx?.DeliverMax);
        if (deliverMaxDrops !== null) return deliverMaxDrops;

        return null;
      };

      for (const txResult of transactions) {
        // xrpl.js v4 defaults to rippled API v2, which uses tx_json + optional hash.
        // Some servers/clients may return v1 (tx), so handle both.
        const tx = ((txResult as any).tx_json ?? (txResult as any).tx) as any;
        const meta = (txResult as any).meta as any;

        // Skip non-Payment transactions for now
        if (!tx || tx.TransactionType !== 'Payment') {
          continue;
        }

        // Skip issued currency payments (Amount object) and handle XRP-native amounts robustly.
        if (typeof tx.Amount === 'object' && tx.Amount !== null) {
          continue;
        }

        const hash = (txResult as any).hash || tx.hash || '';
        const from = tx.Account || '';
        const to = tx.Destination || '';
        const deliveredDrops = getDeliveredDrops(tx, meta);
        if (deliveredDrops === null) {
          continue;
        }

        const feeDropsNum = parseDrops(tx.Fee) ?? 0;
        const destinationTag = tx.DestinationTag;
        const sourceTag = tx.SourceTag;
        const ledgerIndex = (txResult as any).ledger_index || tx.ledger_index || 0;

        // Determine transaction status
        const validated = Boolean((txResult as any).validated);
        const txResult2 = typeof meta === 'object' && meta !== null && 'TransactionResult' in meta
          ? (meta as any).TransactionResult
          : 'unknown';
        const status: 'confirmed' | 'pending' | 'failed' =
          !validated ? 'pending' :
          txResult2 === 'tesSUCCESS' ? 'confirmed' :
          txResult2.startsWith('tec') || txResult2.startsWith('tef') || txResult2.startsWith('tel') ? 'failed' :
          'pending';

        // Determine if send or receive relative to the address
        const type: 'send' | 'receive' | 'other' =
          from.toLowerCase() === address.toLowerCase() ? 'send' :
          to.toLowerCase() === address.toLowerCase() ? 'receive' : 'other';

        // Calculate timestamp from close_time_iso or close_time
        // XRP Ledger epoch starts at 2000-01-01T00:00:00Z (946684800 seconds after Unix epoch)
        const XRP_EPOCH_OFFSET = 946684800;
        let timestamp = Date.now();
        if (typeof tx.date === 'number') {
          timestamp = (tx.date + XRP_EPOCH_OFFSET) * 1000;
        }

        normalized.push({
          hash,
          from,
          to,
          value: deliveredDrops.toString(),
          valueXrp: dropsToXrp(deliveredDrops),
          timestamp,
          ledgerIndex: ledgerIndex || 0,
          fee: feeDropsNum.toString(),
          feeXrp: dropsToXrp(feeDropsNum),
          status,
          type,
          destinationTag,
          sourceTag,
          network: this.networkKey,
        });
      }

      setCache(cacheKey, normalized);
      return normalized;
    } catch (error) {
      console.warn('[XRPExplorer] Failed to fetch transactions:', error);
      return [];
    }
  }

  /**
   * Get fee estimates for transactions.
   *
   * @returns Fee estimates in drops
   */
  async getFeeEstimates(): Promise<XRPFeeEstimate> {
    const cacheKey = `fees:${this.networkKey}`;
    const cached = getCached<XRPFeeEstimate>(cacheKey);
    if (cached) return cached;

    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'fee',
      });

      const drops = response.result.drops;
      const fees: XRPFeeEstimate = {
        baseFee: parseInt(drops.base_fee, 10),
        medianFee: parseInt(drops.median_fee, 10),
        minimumFee: parseInt(drops.minimum_fee, 10),
        openLedgerFee: parseInt(drops.open_ledger_fee, 10),
      };

      setCache(cacheKey, fees);
      return fees;
    } catch (error) {
      console.warn('[XRPExplorer] Failed to fetch fee estimates:', error);
      // Return default fees
      return {
        baseFee: BASE_FEE_DROPS,
        medianFee: BASE_FEE_DROPS,
        minimumFee: 10,
        openLedgerFee: BASE_FEE_DROPS,
      };
    }
  }

  /**
   * Get current network reserve requirements.
   *
   * The XRPL base reserve and owner reserve increment are network parameters
   * that can change via amendments. This method queries the network and falls
   * back to the default constants if unavailable.
   */
  async getReserves(): Promise<XRPReserves> {
    const cacheKey = `reserves:${this.networkKey}`;
    const cached = getCached<XRPReserves>(cacheKey);
    if (cached) return cached;

    try {
      const client = await this.getClient();

      const tryExtract = (result: any): XRPReserves | null => {
        const candidates = [
          result?.state?.validated_ledger,
          result?.validated_ledger,
          result?.info?.validated_ledger,
        ];
        for (const ledger of candidates) {
          const base = parseReserveToDrops(ledger?.reserve_base);
          const inc = parseReserveToDrops(ledger?.reserve_inc);
          if (base !== null && inc !== null) {
            return { reserveBaseDrops: base, reserveIncrementDrops: inc };
          }
        }
        return null;
      };

      // Prefer server_state, fallback to server_info.
      try {
        const response = await client.request({ command: 'server_state' });
        const reserves = tryExtract(response.result);
        if (reserves) {
          setCache(cacheKey, reserves);
          return reserves;
        }
      } catch {
        // ignore; fall through to server_info
      }

      const response2 = await client.request({ command: 'server_info' });
      const reserves2 = tryExtract(response2.result);
      const finalReserves = reserves2 ?? {
        reserveBaseDrops: XRP_RESERVE_BASE,
        reserveIncrementDrops: XRP_RESERVE_INCREMENT,
      };
      setCache(cacheKey, finalReserves);
      return finalReserves;
    } catch (error) {
      const fallback = {
        reserveBaseDrops: XRP_RESERVE_BASE,
        reserveIncrementDrops: XRP_RESERVE_INCREMENT,
      };
      setCache(cacheKey, fallback);
      return fallback;
    }
  }

  /**
   * Get the current ledger index (similar to block height).
   *
   * @returns Current validated ledger index
   */
  async getLedgerIndex(): Promise<number> {
    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'ledger',
        ledger_index: 'validated',
      });

      return response.result.ledger_index;
    } catch (error) {
      console.warn('[XRPExplorer] Failed to fetch ledger index:', error);
      return 0;
    }
  }

  /**
   * Get account sequence number for transaction building.
   *
   * @param address - XRP address
   * @returns Current sequence number
   */
  async getAccountSequence(address: string): Promise<number> {
    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'current',
      });

      return response.result.account_data.Sequence;
    } catch (error: any) {
      // Account not found means sequence starts at some default
      if (error?.data?.error === 'actNotFound') {
        return 1;
      }
      throw error;
    }
  }

  /**
   * Submit a signed transaction to the network.
   *
   * @param txBlob - Signed transaction in hex format
   * @returns Transaction hash if successful
   */
  async submitTransaction(txBlob: string): Promise<string> {
    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'submit',
        tx_blob: txBlob,
      });

      const result = response.result;

      // Check for immediate errors
      if (result.engine_result && !result.engine_result.startsWith('tes')) {
        throw new Error(`Transaction failed: ${result.engine_result} - ${result.engine_result_message}`);
      }

      return result.tx_json?.hash || '';
    } catch (error) {
      console.error('[XRPExplorer] Failed to submit transaction:', error);
      throw error;
    }
  }

  /**
   * Get a specific transaction by hash.
   *
   * @param hash - Transaction hash
   * @returns Transaction details or null if not found
   */
  async getTransaction(hash: string): Promise<any | null> {
    try {
      const client = await this.getClient();

      const response = await client.request({
        command: 'tx',
        transaction: hash,
      });

      return response.result;
    } catch (error: any) {
      if (error?.data?.error === 'txnNotFound') {
        return null;
      }
      console.warn('[XRPExplorer] Failed to fetch transaction:', error);
      return null;
    }
  }

  /**
   * Generate a block explorer URL for a transaction.
   *
   * @param hash - Transaction hash
   * @returns URL to view the transaction on XRPL explorer
   */
  getTransactionUrl(hash: string): string {
    const baseUrl = EXPLORER_URLS[this.network] || EXPLORER_URLS.mainnet;
    return `${baseUrl}/transactions/${hash}`;
  }

  /**
   * Generate a block explorer URL for an address.
   *
   * @param address - XRP address
   * @returns URL to view the address on XRPL explorer
   */
  getAddressUrl(address: string): string {
    const baseUrl = EXPLORER_URLS[this.network] || EXPLORER_URLS.mainnet;
    return `${baseUrl}/accounts/${address}`;
  }

  /**
   * Clear the cache. Useful for forcing fresh data.
   */
  clearCache(): void {
    for (const key of cache.keys()) {
      if (key.includes(this.networkKey)) {
        cache.delete(key);
      }
    }
  }
}

/**
 * Explorer cache to avoid recreating explorers.
 */
const explorerCache: Map<string, XRPExplorer> = new Map();

/**
 * Get or create an XRP explorer for a network.
 *
 * @param networkKey - Network key (e.g., 'xrp-mainnet')
 * @param rpcUrls - Optional custom RPC URLs
 * @returns XRP explorer instance
 */
export function getXRPExplorer(
  networkKey: string,
  rpcUrls?: string[]
): XRPExplorer {
  let explorer = explorerCache.get(networkKey);
  if (!explorer) {
    explorer = new XRPExplorer(networkKey, rpcUrls);
    explorerCache.set(networkKey, explorer);
  }
  return explorer;
}

/**
 * Clear the explorer cache.
 */
export function clearXRPExplorerCache(): void {
  // Disconnect all explorers before clearing
  for (const explorer of explorerCache.values()) {
    explorer.disconnect().catch(() => {});
  }
  explorerCache.clear();
}

/**
 * Check if a network key is an XRP network.
 *
 * @param networkKey - Network key to check
 * @returns true if this is an XRP network
 */
export function isXRPNetwork(networkKey: string): boolean {
  return networkKey.startsWith('xrp-');
}
