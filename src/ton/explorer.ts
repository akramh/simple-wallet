/**
 * @fileoverview TON explorer client using Toncenter-compatible endpoints.
 *
 * @responsibilities
 * - Fetch balances and transaction history for TON addresses
 * - Provide lightweight network access abstraction for TON providers
 *
 * @security
 * - Performs network I/O against configured TON RPC endpoints
 * - Avoids leaking sensitive keys by accepting addresses only
 *
 * @module ton/explorer
 */

import { TonClient } from '@ton/ton';
import { Address } from '@ton/core';
import { Buffer } from 'buffer';
import { nanoToTon } from './types.js';
import type { TonBalance, NormalizedTonTransaction } from './types.js';
import { formatTonAddress, parseTonAddress } from './address.js';

// ============================================================================
// Explorer Client
// ============================================================================

export class TonExplorer {
  private client: TonClient;
  private networkKey: string;
  private testOnly: boolean;

  /**
   * Create a TON explorer client.
   *
   * @param networkKey - Network identifier (e.g., 'ton-mainnet')
   * @param endpoint - Toncenter-compatible HTTP endpoint
   * @param apiKey - Optional API key for Toncenter
   */
  constructor(networkKey: string, endpoint: string, apiKey?: string) {
    this.networkKey = networkKey;
    this.testOnly = networkKey !== 'ton-mainnet';
    this.client = new TonClient({ endpoint, apiKey });
  }

  /**
   * Get the underlying TonClient instance.
   */
  getClient(): TonClient {
    return this.client;
  }

  /**
   * Get balance for a TON address.
   *
   * @param address - Friendly or raw TON address
   * @returns Balance in nanoTON and TON
   */
  async getBalance(address: string): Promise<TonBalance> {
    const parsed = parseTonAddress(address);
    const balance = await this.client.getBalance(parsed);
    return {
      balanceNano: balance.toString(),
      balanceTon: nanoToTon(balance),
    };
  }

  /**
   * Get transaction history for a TON address.
   *
   * @param address - Friendly or raw TON address
   * @param limit - Maximum number of transactions
   * @returns Normalized transaction list
   */
  async getTransactionHistory(address: string, limit: number = 25): Promise<NormalizedTonTransaction[]> {
    const parsed = parseTonAddress(address);
    const txs = await this.client.getTransactions(parsed, { limit });

    return txs.map((tx: any) =>
      normalizeTonTransaction(tx, address, this.networkKey, this.testOnly)
    );
  }

  /**
   * Get block explorer URL for a transaction hash.
   *
   * @param hash - Transaction hash
   * @returns Explorer URL
   */
  getTransactionUrl(hash: string): string {
    if (!hash) return '';
    if (this.testOnly) {
      return `https://testnet.tonscan.org/tx/${hash}`;
    }
    return `https://tonscan.org/tx/${hash}`;
  }

  /**
   * Get block explorer URL for an address.
   *
   * @param address - TON address
   * @returns Explorer URL
   */
  getAddressUrl(address: string): string {
    if (!address) return '';
    const friendly = normalizeAddressForUrl(address, this.testOnly);
    if (this.testOnly) {
      return `https://testnet.tonscan.org/address/${friendly}`;
    }
    return `https://tonscan.org/address/${friendly}`;
  }
}

// ============================================================================
// Transaction Normalization
// ============================================================================

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function extractTxHash(tx: any): string {
  const txIdHash = tx?.transaction_id?.hash ?? tx?.transactionId?.hash;
  if (typeof txIdHash === 'string' && txIdHash.length > 0) return txIdHash;

  const rawHash = typeof tx?.hash === 'function' ? tx.hash() : tx?.hash;
  if (typeof rawHash === 'string' && rawHash.length > 0) return rawHash;

  if (rawHash instanceof Uint8Array) {
    return Buffer.from(rawHash).toString('hex');
  }

  if (rawHash && typeof rawHash.toString === 'function') {
    return rawHash.toString();
  }

  return '';
}

function formatWalletAddress(parsed: Address, testOnly: boolean): string {
  return formatTonAddress(parsed, { testOnly });
}

function isFailedDescription(description: any): boolean {
  if (!description || typeof description !== 'object') return false;

  if ('aborted' in description && description.aborted === true) {
    return true;
  }

  if ('computePhase' in description) {
    const computePhase = description.computePhase;
    if (computePhase?.type === 'vm' && computePhase.success === false) {
      return true;
    }
  }

  if ('actionPhase' in description && description.actionPhase) {
    if (description.actionPhase.success === false) {
      return true;
    }
  }

  if ('bouncePhase' in description && description.bouncePhase) {
    if (description.bouncePhase.type !== 'ok') {
      return true;
    }
  }

  return false;
}

function getTransactionStatus(tx: any): 'confirmed' | 'failed' {
  return isFailedDescription(tx?.description) ? 'failed' : 'confirmed';
}

type TonMessageInfo = {
  source?: Address;
  destination?: Address;
  value?: bigint;
  comment?: string;
};

function extractMessageInfo(message: any): TonMessageInfo {
  if (!message) return {};

  if (message.info && typeof message.info === 'object') {
    const info = message.info;
    if (info.type === 'internal') {
      return {
        source: info.src,
        destination: info.dest,
        value: typeof info.value?.coins === 'bigint' ? info.value.coins : toBigInt(info.value?.coins),
      };
    }
    if (info.type === 'external-in') {
      return {
        destination: info.dest,
      };
    }
    if (info.type === 'external-out') {
      return {
        source: info.src,
      };
    }
  }

  return {
    source: parseMaybeAddress(message.source ?? message.src) || undefined,
    destination: parseMaybeAddress(message.destination ?? message.dest) || undefined,
    value: toBigInt(message.value),
    comment: typeof message.comment === 'string' ? message.comment : undefined,
  };
}

function extractOutMessages(tx: any): any[] {
  const raw = tx?.outMessages ?? tx?.out_msgs;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw?.values === 'function') {
    return raw.values();
  }
  if (typeof raw === 'object') {
    return Object.values(raw);
  }
  return [];
}

/**
 * Normalize a raw TON transaction into the wallet display format.
 *
 * @param tx - Raw transaction payload from the TON client
 * @param address - Wallet address used to determine direction
 * @param networkKey - TON network identifier (e.g., 'ton-mainnet')
 * @param testOnly - Whether to format addresses for testnet
 * @returns Normalized transaction for UI display
 */
export function normalizeTonTransaction(
  tx: any,
  address: string,
  networkKey: string,
  testOnly: boolean
): NormalizedTonTransaction {
  const parsed = parseTonAddress(address);
  const nowSeconds = typeof tx.now === 'number' ? tx.now : tx.utime;
  const timestamp = typeof nowSeconds === 'number' ? nowSeconds * 1000 : Date.now();

  const inMsg = tx.inMessage || tx.in_msg || null;
  const outMsgs = extractOutMessages(tx);
  const inInfo = extractMessageInfo(inMsg);
  const outInfos = outMsgs.map(extractMessageInfo);

  const inValue = toBigInt(inInfo.value);
  const outValue = outInfos.reduce((sum, info) => sum + toBigInt(info.value), 0n);

  const inDest = inInfo.destination;
  const inSource = inInfo.source;
  const outSources = outInfos.map(info => info.source).filter(Boolean) as Address[];

  const isIncoming = inDest ? inDest.equals(parsed) : false;
  const isOutgoing = (inSource && inSource.equals(parsed)) || outSources.some(src => src.equals(parsed));

  let type: 'send' | 'receive' | 'other' = 'other';
  if (isIncoming) {
    type = 'receive';
  } else if (isOutgoing) {
    type = 'send';
  }

  const value = type === 'receive'
    ? inValue
    : type === 'send'
      ? (outValue || inValue)
      : (outValue || inValue);

  let fromAddress = inInfo.source ? formatMaybeAddress(inInfo.source, testOnly) : '';
  if (!fromAddress && type === 'send') {
    fromAddress = formatWalletAddress(parsed, testOnly);
  }

  const outFirst = outInfos.find(info => info?.destination);
  let toAddress = type === 'send' && outFirst?.destination
    ? formatMaybeAddress(outFirst.destination, testOnly)
    : inInfo.destination
      ? formatMaybeAddress(inInfo.destination, testOnly)
      : '';
  if (!toAddress && type === 'receive') {
    toAddress = formatWalletAddress(parsed, testOnly);
  }

  return {
    hash: extractTxHash(tx),
    from: fromAddress,
    to: toAddress,
    valueNano: value.toString(),
    valueTon: nanoToTon(value),
    timestamp,
    status: getTransactionStatus(tx),
    type,
    comment: inInfo.comment,
    network: networkKey,
  };
}

function normalizeAddressForUrl(address: string, testOnly: boolean): string {
  try {
    const parsed = Address.parse(address);
    return parsed.toString({ bounceable: true, testOnly, urlSafe: true });
  } catch {
    const parsed = Address.parseFriendly(address).address;
    return parsed.toString({ bounceable: true, testOnly, urlSafe: true });
  }
}

function formatMaybeAddress(address: Address | string, testOnly: boolean): string {
  if (address instanceof Address) {
    return formatTonAddress(address, { testOnly });
  }
  try {
    return formatTonAddress(Address.parse(address), { testOnly });
  } catch {
    return formatTonAddress(Address.parseFriendly(address).address, { testOnly });
  }
}

function parseMaybeAddress(address?: Address | string | null): Address | null {
  if (!address) return null;
  if (address instanceof Address) return address;
  if (typeof address === 'object') {
    const maybeAddress = (address as { address?: string }).address;
    if (typeof maybeAddress === 'string') {
      return parseMaybeAddress(maybeAddress);
    }
  }
  try {
    return Address.parse(address);
  } catch {
    try {
      return Address.parseFriendly(address).address;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Explorer Cache
// ============================================================================

const explorerCache: Map<string, TonExplorer> = new Map();

/**
 * Get or create a TON explorer client for a network.
 *
 * @param networkKey - Network key (e.g., 'ton-mainnet')
 * @param endpoint - Toncenter-compatible HTTP endpoint
 * @param apiKey - Optional API key
 * @returns TON explorer instance
 */
export function getTonExplorer(networkKey: string, endpoint: string, apiKey?: string): TonExplorer {
  const cacheKey = `${networkKey}:${endpoint}`;
  let explorer = explorerCache.get(cacheKey);
  if (!explorer) {
    explorer = new TonExplorer(networkKey, endpoint, apiKey);
    explorerCache.set(cacheKey, explorer);
  }
  return explorer;
}

/**
 * Clear cached TON explorers.
 */
export function clearTonExplorerCache(): void {
  explorerCache.clear();
}

/**
 * Check if a network key is a TON network.
 *
 * @param networkKey - Network identifier (e.g., 'ton-mainnet')
 * @returns true if this is a TON network
 */
export function isTonNetwork(networkKey: string): boolean {
  return networkKey.startsWith('ton-');
}
