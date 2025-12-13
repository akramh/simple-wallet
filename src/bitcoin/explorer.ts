/**
 * @fileoverview Mempool.space API client for Bitcoin blockchain data.
 *
 * Provides access to Bitcoin blockchain data including address balances,
 * UTXOs, transaction history, and fee estimates via the Mempool.space API.
 * This is the Bitcoin equivalent of explorer-api.ts for EVM chains.
 *
 * @module bitcoin/explorer
 */

import type {
  UTXO,
  BitcoinBalance,
  BitcoinTransaction,
  BitcoinFeeEstimate,
  NormalizedBitcoinTransaction,
} from './types.js';
import { satoshisToBtc } from './types.js';

/**
 * Mempool.space API base URLs for different networks.
 */
const MEMPOOL_API_URLS: Record<string, string> = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
  signet: 'https://mempool.space/signet/api',
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

/**
 * Fetch with timeout helper.
 */
async function fetchWithTimeout(
  url: string,
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Bitcoin explorer API client using Mempool.space.
 *
 * Provides methods to fetch Bitcoin blockchain data including:
 * - Address balances (confirmed + unconfirmed)
 * - UTXO sets for transaction building
 * - Transaction history
 * - Fee rate estimates
 *
 * All data is fetched from the public Mempool.space API which
 * requires no API key and has generous rate limits.
 *
 * @example
 * ```typescript
 * const explorer = new BitcoinExplorer('mainnet');
 *
 * // Get balance
 * const balance = await explorer.getBalance('bc1q...');
 * console.log(`Balance: ${balance.total} satoshis`);
 *
 * // Get UTXOs for spending
 * const utxos = await explorer.getUTXOs('bc1q...');
 * ```
 */
export class BitcoinExplorer {
  /** Network type */
  private network: 'mainnet' | 'testnet' | 'signet';
  /** Base API URL */
  private apiUrl: string;

  /**
   * Create a new BitcoinExplorer instance.
   *
   * @param network - Bitcoin network to use
   * @param customApiUrl - Optional custom API URL (for self-hosted Mempool)
   */
  constructor(
    network: 'mainnet' | 'testnet' | 'signet' = 'mainnet',
    customApiUrl?: string
  ) {
    this.network = network;
    this.apiUrl = customApiUrl || MEMPOOL_API_URLS[network];
  }

  /**
   * Get the current network.
   */
  getNetwork(): string {
    return this.network;
  }

  /**
   * Get the balance for a Bitcoin address.
   *
   * @param address - Bitcoin address (bc1q... or tb1q...)
   * @returns Balance information with confirmed and unconfirmed amounts
   *
   * @example
   * ```typescript
   * const balance = await explorer.getBalance('bc1q...');
   * console.log(`Confirmed: ${balance.confirmed} sats`);
   * console.log(`Unconfirmed: ${balance.unconfirmed} sats`);
   * ```
   */
  async getBalance(address: string): Promise<BitcoinBalance> {
    const cacheKey = `balance:${this.network}:${address}`;
    const cached = getCached<BitcoinBalance>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
      };

      const confirmed =
        data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      const unconfirmed =
        data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;

      const balance: BitcoinBalance = {
        confirmed,
        unconfirmed,
        total: confirmed + unconfirmed,
      };

      setCache(cacheKey, balance);
      return balance;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch balance:', error);
      return { confirmed: 0, unconfirmed: 0, total: 0 };
    }
  }

  /**
   * Get the formatted balance in BTC.
   *
   * @param address - Bitcoin address
   * @returns Balance in BTC as string
   */
  async getBalanceBTC(address: string): Promise<string> {
    const balance = await this.getBalance(address);
    return satoshisToBtc(balance.total);
  }

  /**
   * Get unspent transaction outputs (UTXOs) for an address.
   * UTXOs are required for building Bitcoin transactions.
   *
   * @param address - Bitcoin address
   * @returns Array of UTXOs available for spending
   *
   * @example
   * ```typescript
   * const utxos = await explorer.getUTXOs('bc1q...');
   * const spendable = utxos.filter(u => u.status.confirmed);
   * ```
   */
  async getUTXOs(address: string): Promise<UTXO[]> {
    const cacheKey = `utxos:${this.network}:${address}`;
    const cached = getCached<UTXO[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}/utxo`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const utxos = await response.json() as UTXO[];
      setCache(cacheKey, utxos);
      return utxos;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch UTXOs:', error);
      return [];
    }
  }

  /**
   * Get transaction history for an address.
   *
   * @param address - Bitcoin address
   * @returns Array of transactions involving the address
   */
  async getTransactionHistory(address: string): Promise<BitcoinTransaction[]> {
    const cacheKey = `txs:${this.network}:${address}`;
    const cached = getCached<BitcoinTransaction[]>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/address/${address}/txs`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const txs = await response.json() as BitcoinTransaction[];
      setCache(cacheKey, txs);
      return txs;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch transactions:', error);
      return [];
    }
  }

  /**
   * Get normalized transaction history matching the app's transaction format.
   * This normalizes Bitcoin transactions to match the structure used by EVM chains.
   *
   * @param address - Bitcoin address
   * @param limit - Maximum number of transactions to return
   * @returns Normalized transactions for display
   */
  async getNormalizedTransactions(
    address: string,
    limit: number = 25
  ): Promise<NormalizedBitcoinTransaction[]> {
    const txs = await this.getTransactionHistory(address);
    const lowerAddress = address.toLowerCase();

    return txs.slice(0, limit).map((tx) => {
      // Determine if this is a send or receive
      const isFromMe = tx.vin.some(
        (input) =>
          input.prevout?.scriptpubkey_address?.toLowerCase() === lowerAddress
      );

      // Calculate the net value change for this address
      let valueSent = 0;
      let valueReceived = 0;

      for (const input of tx.vin) {
        if (input.prevout?.scriptpubkey_address?.toLowerCase() === lowerAddress) {
          valueSent += input.prevout.value;
        }
      }

      for (const output of tx.vout) {
        if (output.scriptpubkey_address?.toLowerCase() === lowerAddress) {
          valueReceived += output.value;
        }
      }

      const netValue = valueReceived - valueSent;
      const type = netValue >= 0 ? 'receive' : 'send';
      const displayValue = Math.abs(netValue);

      // Get the counterparty address
      let counterparty = '';
      if (type === 'send') {
        // Find the first output that's not ours (the recipient)
        const recipient = tx.vout.find(
          (o) => o.scriptpubkey_address?.toLowerCase() !== lowerAddress
        );
        counterparty = recipient?.scriptpubkey_address || '';
      } else {
        // Find the first input address (the sender)
        const sender = tx.vin[0]?.prevout?.scriptpubkey_address;
        counterparty = sender || '';
      }

      // Get current block height for confirmations (approximate)
      const blockHeight = tx.status.block_height || 0;

      return {
        hash: tx.txid,
        from: type === 'send' ? address : counterparty,
        to: type === 'send' ? counterparty : address,
        value: displayValue.toString(),
        timestamp: tx.status.block_time
          ? tx.status.block_time * 1000
          : Date.now(),
        blockNumber: blockHeight,
        fee: tx.fee.toString(),
        status: tx.status.confirmed ? 'confirmed' : 'pending',
        type,
        network: this.network === 'mainnet' ? 'bitcoin-mainnet' : 'bitcoin-testnet',
      };
    });
  }

  /**
   * Get a specific transaction by ID.
   *
   * @param txid - Transaction ID (hash)
   * @returns Transaction data or null if not found
   */
  async getTransaction(txid: string): Promise<BitcoinTransaction | null> {
    try {
      const url = `${this.apiUrl}/tx/${txid}`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`API error: ${response.status}`);
      }

      return await response.json() as BitcoinTransaction;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch transaction:', error);
      return null;
    }
  }

  /**
   * Get recommended fee rates for different confirmation targets.
   *
   * @returns Fee estimates in sat/vB for different priorities
   *
   * @example
   * ```typescript
   * const fees = await explorer.getFeeEstimates();
   * console.log(`Fast fee: ${fees.fastestFee} sat/vB`);
   * ```
   */
  async getFeeEstimates(): Promise<BitcoinFeeEstimate> {
    const cacheKey = `fees:${this.network}`;
    const cached = getCached<BitcoinFeeEstimate>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${this.apiUrl}/v1/fees/recommended`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const fees = await response.json() as BitcoinFeeEstimate;
      setCache(cacheKey, fees);
      return fees;
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch fee estimates:', error);
      // Return default fee estimates
      return {
        fastestFee: 10,
        halfHourFee: 5,
        hourFee: 3,
        economyFee: 1,
        minimumFee: 1,
      };
    }
  }

  /**
   * Get the current block height.
   *
   * @returns Current block height
   */
  async getBlockHeight(): Promise<number> {
    try {
      const url = `${this.apiUrl}/blocks/tip/height`;
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      return parseInt(await response.text(), 10);
    } catch (error) {
      console.warn('[BitcoinExplorer] Failed to fetch block height:', error);
      return 0;
    }
  }

  /**
   * Broadcast a signed transaction to the network.
   * This will be used in Phase 3 for sending transactions.
   *
   * @param txHex - Signed transaction in hex format
   * @returns Transaction ID if successful
   * @throws Error if broadcast fails
   */
  async broadcastTransaction(txHex: string): Promise<string> {
    try {
      const url = `${this.apiUrl}/tx`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Broadcast failed: ${error}`);
      }

      const txid = await response.text();
      return txid;
    } catch (error) {
      console.error('[BitcoinExplorer] Failed to broadcast transaction:', error);
      throw error;
    }
  }

  /**
   * Generate a block explorer URL for a transaction.
   *
   * @param txid - Transaction ID
   * @returns URL to view the transaction on Mempool.space
   */
  getTransactionUrl(txid: string): string {
    const baseUrl = this.network === 'mainnet'
      ? 'https://mempool.space'
      : `https://mempool.space/${this.network}`;
    return `${baseUrl}/tx/${txid}`;
  }

  /**
   * Generate a block explorer URL for an address.
   *
   * @param address - Bitcoin address
   * @returns URL to view the address on Mempool.space
   */
  getAddressUrl(address: string): string {
    const baseUrl = this.network === 'mainnet'
      ? 'https://mempool.space'
      : `https://mempool.space/${this.network}`;
    return `${baseUrl}/address/${address}`;
  }

  /**
   * Clear the cache. Useful for forcing fresh data.
   */
  clearCache(): void {
    for (const key of cache.keys()) {
      if (key.includes(this.network)) {
        cache.delete(key);
      }
    }
  }
}

/**
 * Singleton instances for mainnet and testnet.
 */
export const bitcoinExplorerMainnet = new BitcoinExplorer('mainnet');
export const bitcoinExplorerTestnet = new BitcoinExplorer('testnet');

/**
 * Get the appropriate explorer for a network.
 *
 * @param network - Network identifier ('bitcoin-mainnet' or 'bitcoin-testnet')
 * @returns Bitcoin explorer instance
 */
export function getBitcoinExplorer(
  network: string
): BitcoinExplorer {
  if (network === 'bitcoin-mainnet') {
    return bitcoinExplorerMainnet;
  }
  return bitcoinExplorerTestnet;
}
