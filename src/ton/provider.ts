/**
 * @fileoverview TON provider - unified interface for TON network operations.
 *
 * @responsibilities
 * - Derive TON addresses from mnemonics
 * - Query balances and transaction history via Toncenter
 * - Build and send TON transfers
 * - Estimate TON transfer fees
 *
 * @security
 * - Uses hardened derivation to protect mnemonic-derived keys
 * - Performs network I/O via Toncenter endpoints
 * - Keeps secret keys in memory only during signing
 *
 * @module ton/provider
 */

import { WalletContractV4 } from '@ton/ton';
import { Buffer } from 'buffer';
import type { TonAddressInfo, TonBalance, TonFeeEstimate, NormalizedTonTransaction } from './types.js';
import { deriveTonAddress, deriveTonKeypair, isValidTonAddress } from './address.js';
import { TonExplorer, getTonExplorer } from './explorer.js';
import { buildTonTransferMessage } from './transaction.js';
import { nanoToTon } from './types.js';

/**
 * Resolve a TON transaction hash from a Toncenter/ton client payload.
 *
 * @param tx - Transaction payload from Toncenter or TonClient.
 * @returns Transaction hash as hex string, or empty string if unavailable.
 */
export function resolveTonTransactionHash(tx: any): string {
  const rawHash = tx?.transaction_id?.hash ?? tx?.transactionId?.hash ?? tx?.hash;
  if (typeof rawHash === 'string') {
    try {
      return Buffer.from(rawHash, 'base64').toString('hex');
    } catch {
      return rawHash;
    }
  }

  if (typeof rawHash === 'function') {
    const hashResult = rawHash();
    if (hashResult instanceof Uint8Array) {
      return Buffer.from(hashResult).toString('hex');
    }
    if (typeof hashResult === 'string') {
      return hashResult;
    }
  }

  if (rawHash instanceof Uint8Array) {
    return Buffer.from(rawHash).toString('hex');
  }

  return '';
}

/**
 * Safely read the wallet seqno, defaulting to 0 if the contract isn't deployed yet.
 *
 * @param contract - Opened wallet contract instance.
 * @returns Sequence number (0 if unavailable).
 */
export async function getTonWalletSeqno(contract: { getSeqno: () => Promise<number> }): Promise<number> {
  try {
    return await contract.getSeqno();
  } catch (error) {
    console.warn('[TonProvider] Failed to read seqno, defaulting to 0:', error);
    return 0;
  }
}

/**
 * Portfolio result for TON (matches EVM/Bitcoin pattern).
 */
export interface TonPortfolioResult {
  token: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    type: 'native';
  };
  balance: string;
  balanceNano: string;
  error?: string;
}

/**
 * TON provider configuration.
 */
export interface TonProviderConfig {
  /** Network type. */
  network: 'mainnet' | 'testnet';
  /** Network key as used in config. */
  networkKey: string;
  /** Toncenter-compatible HTTP endpoint. */
  endpoint: string;
  /** Optional API key for Toncenter. */
  apiKey?: string;
  /** Native token symbol (e.g., TON, tTON). */
  nativeSymbol: string;
  /** Native token name (e.g., Toncoin). */
  nativeName: string;
  /** Workchain id (default: 0). */
  workchain?: number;
}

/**
 * TON provider - unified interface for TON operations.
 */
export class TonProvider {
  private config: TonProviderConfig;
  private explorer: TonExplorer;
  private currentAddress: TonAddressInfo | null = null;
  private accountIndex: number = 0;

  /**
   * Create a new TON provider.
   *
   * @param config - Provider configuration
   */
  constructor(config: TonProviderConfig) {
    this.config = config;
    this.explorer = getTonExplorer(config.networkKey, config.endpoint, config.apiKey);
  }

  /**
   * Get the network key (e.g., 'ton-mainnet').
   */
  getNetworkKey(): string {
    return this.config.networkKey;
  }

  /**
   * Derive a TON address from a mnemonic.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @param accountIndex - BIP-44 account index
   * @returns TON address information
   */
  deriveAddress(mnemonic: string, accountIndex: number = 0): TonAddressInfo {
    this.accountIndex = accountIndex;
    this.currentAddress = deriveTonAddress(mnemonic, accountIndex, {
      workchain: this.config.workchain ?? 0,
      testOnly: this.config.network !== 'mainnet',
    });
    return this.currentAddress;
  }

  /**
   * Get the current address (must call deriveAddress first).
   */
  getCurrentAddress(): string | null {
    return this.currentAddress?.address || null;
  }

  /**
   * Get the current account index.
   */
  getCurrentAccountIndex(): number {
    return this.accountIndex;
  }

  /**
   * Get balance for a TON address.
   *
   * @param address - TON address (optional)
   * @returns Balance info
   */
  async getBalance(address?: string): Promise<TonBalance> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getBalance(addr);
  }

  /**
   * Get balance formatted in TON.
   *
   * @param address - TON address (optional)
   * @returns Balance in TON string
   */
  async getBalanceFormatted(address?: string): Promise<string> {
    const balance = await this.getBalance(address);
    return balance.balanceTon;
  }

  /**
   * Get portfolio result matching EVM/Bitcoin format.
   *
   * @param address - TON address (optional)
   * @returns Portfolio result with token and balance
   */
  async getPortfolio(address?: string): Promise<TonPortfolioResult[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [{
        token: this.getNativeToken(),
        balance: '0',
        balanceNano: '0',
        error: 'No address available',
      }];
    }

    try {
      const balance = await this.getBalance(addr);
      return [{
        token: this.getNativeToken(),
        balance: balance.balanceTon,
        balanceNano: balance.balanceNano,
      }];
    } catch (error) {
      return [{
        token: this.getNativeToken(),
        balance: 'Error',
        balanceNano: '0',
        error: (error as Error).message,
      }];
    }
  }

  /**
   * Get transaction history for an address.
   *
   * @param address - TON address (optional)
   * @param limit - Maximum number of transactions
   * @returns Normalized transactions
   */
  async getTransactionHistory(address?: string, limit: number = 25): Promise<NormalizedTonTransaction[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) return [];
    return this.explorer.getTransactionHistory(addr, limit);
  }

  /**
   * Estimate the fee for a TON transfer.
   *
   * @param toAddress - Recipient TON address
   * @param amountTon - Amount in TON string
   * @param mnemonic - BIP-39 mnemonic for signing
   * @returns Fee estimate in nanoTON and TON
   */
  async estimateFee(
    toAddress: string,
    amountTon: string,
    mnemonic?: string,
    accountIndex?: number
  ): Promise<TonFeeEstimate> {
    if (!isValidTonAddress(toAddress)) {
      throw new Error('Invalid TON recipient address');
    }

    if (!mnemonic) {
      return { feeNano: '0', feeTon: '0' };
    }

    const keypair = deriveTonKeypair(mnemonic, accountIndex ?? this.accountIndex);
    const publicKey = Buffer.from(keypair.publicKey);
    const secretKey = Buffer.from(keypair.secretKey);
    const wallet = WalletContractV4.create({
      publicKey,
      workchain: this.config.workchain ?? 0,
    });

    const client = this.explorer.getClient();
    const contract = client.open(wallet) as any;
    const seqno = await getTonWalletSeqno(contract);

    const message = buildTonTransferMessage({
      toAddress,
      amountTon,
    });

    if (typeof (client as any).estimateExternalMessageFee === 'function') {
      const transfer = await contract.createTransfer({
        seqno,
        secretKey,
        messages: [message],
      });
      const init = wallet.init ?? null;
      const fee = await (client as any).estimateExternalMessageFee(wallet.address, {
        body: transfer,
        initCode: init?.code ?? null,
        initData: init?.data ?? null,
        ignoreSignature: false,
      });
      const fees = fee?.source_fees ?? {};
      const total = BigInt(fees.in_fwd_fee ?? 0)
        + BigInt(fees.storage_fee ?? 0)
        + BigInt(fees.gas_fee ?? 0)
        + BigInt(fees.fwd_fee ?? 0);
      return {
        feeNano: total.toString(),
        feeTon: nanoToTon(total),
      };
    }

    return { feeNano: '0', feeTon: '0' };
  }

  /**
   * Send a TON transfer.
   *
   * @param fromAddress - Sender TON address (optional)
   * @param toAddress - Recipient TON address
   * @param amountTon - Amount in TON string
   * @param mnemonic - BIP-39 mnemonic for signing
   * @param comment - Optional comment payload
   * @returns Transaction hash (if available)
   */
  async sendTransaction(
    fromAddress: string | undefined,
    toAddress: string,
    amountTon: string,
    mnemonic: string,
    comment?: string,
    accountIndex?: number
  ): Promise<{ hash: string }>
  {
    if (!isValidTonAddress(toAddress)) {
      throw new Error('Invalid TON recipient address');
    }

    const from = fromAddress || this.currentAddress?.address;
    if (!from) {
      throw new Error('No TON address available');
    }

    const keypair = deriveTonKeypair(mnemonic, accountIndex ?? this.accountIndex);
    const publicKey = Buffer.from(keypair.publicKey);
    const secretKey = Buffer.from(keypair.secretKey);
    const wallet = WalletContractV4.create({
      publicKey,
      workchain: this.config.workchain ?? 0,
    });

    const client = this.explorer.getClient();
    const contract = client.open(wallet) as any;
    const seqno = await getTonWalletSeqno(contract);

    const message = buildTonTransferMessage({
      toAddress,
      amountTon,
      comment,
    });

    await contract.sendTransfer({
      seqno,
      secretKey,
      messages: [message],
    });

    const hash = await this.waitForTransactionHash(contract, seqno);
    return { hash };
  }

  private async waitForTransactionHash(contract: any, seqno: number): Promise<string> {
    const client = this.explorer.getClient();
    const start = Date.now();
    const timeoutMs = 12_000;
    const pollMs = 1_000;

    while (Date.now() - start < timeoutMs) {
      try {
        const currentSeqno = await getTonWalletSeqno(contract);
        if (currentSeqno > seqno) {
          const txs = await client.getTransactions(contract.address, { limit: 5 });
          const latest = txs[0];
          const hash = resolveTonTransactionHash(latest);
          if (hash) {
            return hash;
          }
        }
      } catch (error) {
        console.warn('[TonProvider] Failed to fetch transaction hash:', error);
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    return '';
  }

  /**
   * Validate a TON address.
   *
   * @param address - TON address
   * @returns true if valid
   */
  validateAddress(address: string): boolean {
    return isValidTonAddress(address);
  }

  /**
   * Get native token definition for TON.
   */
  getNativeToken(): { symbol: string; name: string; decimals: number; address: string; type: 'native' } {
    return {
      symbol: this.config.nativeSymbol || 'TON',
      name: this.config.nativeName || 'Toncoin',
      decimals: 9,
      address: 'native',
      type: 'native',
    };
  }

  /**
   * Get block explorer URL for a transaction hash.
   *
   * @param hash - Transaction hash
   * @returns Explorer URL
   */
  getTransactionUrl(hash: string): string {
    return this.explorer.getTransactionUrl(hash);
  }

  /**
   * Get block explorer URL for a TON address.
   *
   * @param address - TON address
   * @returns Explorer URL
   */
  getAddressUrl(address: string): string {
    return this.explorer.getAddressUrl(address);
  }
}

// ============================================================================
// Provider Cache
// ============================================================================

const providerCache: Map<string, TonProvider> = new Map();

/**
 * Get or create a TON provider for a network.
 *
 * @param config - Provider configuration
 * @returns TON provider instance
 */
export function getTonProvider(config: TonProviderConfig): TonProvider {
  const cacheKey = `${config.networkKey}:${config.endpoint}`;
  let provider = providerCache.get(cacheKey);
  if (!provider) {
    provider = new TonProvider(config);
    providerCache.set(cacheKey, provider);
  }
  return provider;
}

/**
 * Clear cached TON providers.
 */
export function clearTonProviderCache(): void {
  providerCache.clear();
}
