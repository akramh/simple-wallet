/**
 * @fileoverview Bitcoin provider - unified interface for Bitcoin operations.
 *
 * This module provides a unified interface for Bitcoin operations that mirrors
 * the pattern used by the EVM wallet. It coordinates between address derivation
 * and the Mempool.space explorer API.
 *
 * The BitcoinProvider is used by WalletAppService to handle Bitcoin networks
 * in the same way it handles EVM networks, ensuring a consistent API surface.
 *
 * @module bitcoin/provider
 */

import { deriveBitcoinAddress, getBitcoinPrivateKey, isValidBitcoinAddress } from './address.js';
import { BitcoinExplorer, getBitcoinExplorer } from './explorer.js';
import type {
  BitcoinAddressInfo,
  BitcoinBalance,
  UTXO,
  NormalizedBitcoinTransaction,
  BitcoinFeeEstimate,
} from './types.js';
import { satoshisToBtc, formatBtcAmount } from './types.js';
import {
  buildAndSignP2wpkhTransaction,
  parseBtcToSatoshisExact,
  selectUtxosLargestFirst,
  type PrevoutInfo,
} from './transaction.js';

/**
 * Portfolio result for Bitcoin (matches EVM pattern).
 */
export interface BitcoinPortfolioResult {
  token: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    type: 'native';
  };
  balance: string;
  balanceSatoshis: number;
  error?: string;
}

/**
 * Bitcoin provider configuration.
 */
export interface BitcoinProviderConfig {
  /** Network type */
  network: 'mainnet' | 'testnet';
  /** Network key as used in config (e.g., 'bitcoin-mainnet') */
  networkKey: string;
}

/**
 * Bitcoin provider - unified interface for Bitcoin blockchain operations.
 *
 * This class provides the same method patterns as the EVM wallet to ensure
 * consistent usage in WalletAppService. It handles:
 * - Address derivation from mnemonics
 * - Balance queries via Mempool.space
 * - Transaction history
 * - (Future) Transaction building and sending
 *
 * @example
 * ```typescript
 * const provider = new BitcoinProvider({
 *   network: 'mainnet',
 *   networkKey: 'bitcoin-mainnet'
 * });
 *
 * const address = provider.deriveAddress(mnemonic, 0);
 * const balance = await provider.getBalance(address.address);
 * ```
 */
export class BitcoinProvider {
  /** Network configuration */
  private config: BitcoinProviderConfig;
  /** Explorer API client */
  private explorer: BitcoinExplorer;
  /** Current address info (cached after derivation) */
  private currentAddress: BitcoinAddressInfo | null = null;
  /** Current account index */
  private accountIndex: number = 0;

  /**
   * Create a new Bitcoin provider.
   *
   * @param config - Provider configuration
   */
  constructor(config: BitcoinProviderConfig) {
    this.config = config;
    this.explorer = getBitcoinExplorer(config.networkKey);
  }

  /**
   * Get the current network.
   */
  getNetwork(): 'mainnet' | 'testnet' {
    return this.config.network;
  }

  /**
   * Get the network key (e.g., 'bitcoin-mainnet').
   */
  getNetworkKey(): string {
    return this.config.networkKey;
  }

  /**
   * Derive a Bitcoin address from a mnemonic.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @param accountIndex - BIP-44 account index
   * @param addressIndex - Address index (default: 0)
   * @returns Bitcoin address information
   */
  deriveAddress(
    mnemonic: string,
    accountIndex: number = 0,
    addressIndex: number = 0
  ): BitcoinAddressInfo {
    this.accountIndex = accountIndex;
    this.currentAddress = deriveBitcoinAddress(
      mnemonic,
      this.config.network,
      accountIndex,
      addressIndex
    );
    return this.currentAddress;
  }

  /**
   * Get the current address (must call deriveAddress first).
   *
   * @returns Current Bitcoin address or null if not derived
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
   * Get the balance for a Bitcoin address.
   *
   * @param address - Bitcoin address (optional, uses current if not provided)
   * @returns Balance information
   */
  async getBalance(address?: string): Promise<BitcoinBalance> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getBalance(addr);
  }

  /**
   * Get the formatted balance in BTC.
   *
   * @param address - Bitcoin address (optional)
   * @returns Balance as string in BTC (e.g., "0.00123456")
   */
  async getBalanceFormatted(address?: string): Promise<string> {
    const balance = await this.getBalance(address);
    return satoshisToBtc(balance.total);
  }

  /**
   * Get portfolio result matching EVM format.
   * This allows the app-service to handle Bitcoin like any other network.
   *
   * @param address - Bitcoin address (optional)
   * @returns Portfolio result with token and balance
   */
  async getPortfolio(address?: string): Promise<BitcoinPortfolioResult[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [{
        token: this.getNativeToken(),
        balance: '0',
        balanceSatoshis: 0,
        error: 'No address available',
      }];
    }

    try {
      const balance = await this.getBalance(addr);
      return [{
        token: this.getNativeToken(),
        balance: satoshisToBtc(balance.total),
        balanceSatoshis: balance.total,
      }];
    } catch (error) {
      return [{
        token: this.getNativeToken(),
        balance: 'Error',
        balanceSatoshis: 0,
        error: (error as Error).message,
      }];
    }
  }

  /**
   * Get the native token definition for Bitcoin.
   * Matches the Token interface used by EVM networks.
   */
  getNativeToken(): {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    type: 'native';
  } {
    return {
      symbol: this.config.network === 'mainnet' ? 'BTC' : 'tBTC',
      name: this.config.network === 'mainnet' ? 'Bitcoin' : 'Bitcoin Testnet',
      decimals: 8,
      address: '',
      type: 'native',
    };
  }

  /**
   * Get UTXOs for an address.
   *
   * @param address - Bitcoin address (optional)
   * @returns Array of unspent transaction outputs
   */
  async getUTXOs(address?: string): Promise<UTXO[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getUTXOs(addr);
  }

  /**
   * Get transaction history for an address.
   *
   * @param address - Bitcoin address (optional)
   * @param limit - Maximum number of transactions
   * @returns Normalized transactions for display
   */
  async getTransactionHistory(
    address?: string,
    limit: number = 25
  ): Promise<NormalizedBitcoinTransaction[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [];
    }
    return this.explorer.getNormalizedTransactions(addr, limit);
  }

  /**
   * Get fee estimates for transactions.
   *
   * @returns Fee estimates in sat/vB
   */
  async getFeeEstimates(): Promise<BitcoinFeeEstimate> {
    return this.explorer.getFeeEstimates();
  }

  /**
   * Estimate inputs and fee for sending BTC.
   * Uses confirmed UTXOs only.
   *
   * @param fromAddress - Sender address
   * @param toAddress - Recipient address
   * @param amountBtc - Amount in BTC (string with up to 8 decimals)
   * @param feeRateSatVb - Fee rate in sat/vB
   */
  async estimateSendTransaction(
    fromAddress: string,
    toAddress: string,
    amountBtc: string,
    feeRateSatVb: number
  ): Promise<{
    amountSats: number;
    inputs: UTXO[];
    totalInputSats: number;
    changeSats: number;
    fee: { feeRateSatVb: number; vbytes: number; feeSats: number; inputCount: number; outputCount: number; hasChange: boolean };
  }> {
    if (!isValidBitcoinAddress(toAddress, this.config.network)) {
      throw new Error('Invalid Bitcoin recipient address');
    }
    if (!isValidBitcoinAddress(fromAddress, this.config.network)) {
      throw new Error('Invalid Bitcoin sender address');
    }

    const amountSats = parseBtcToSatoshisExact(amountBtc);
    const utxos = await this.getUTXOs(fromAddress);
    const confirmedUtxos = utxos.filter(u => u.status.confirmed);
    const spendableUtxos = confirmedUtxos.length
      ? confirmedUtxos
      : (this.config.network === 'testnet' ? utxos : confirmedUtxos);
    if (spendableUtxos.length === 0) {
      throw new Error('No spendable UTXOs available');
    }
    const selected = selectUtxosLargestFirst(spendableUtxos, amountSats, feeRateSatVb);
    return { amountSats, ...selected };
  }

  /**
   * Build, sign, and broadcast a Bitcoin transaction (Native SegWit / P2WPKH).
   *
   * @param fromAddress - Sender address
   * @param toAddress - Recipient address
   * @param amountBtc - Amount in BTC string
   * @param wif - Private key in WIF format
   * @param feeRateSatVb - Optional fee rate in sat/vB (defaults to halfHourFee)
   */
  async sendTransaction(
    fromAddress: string,
    toAddress: string,
    amountBtc: string,
    wif: string,
    feeRateSatVb?: number
  ): Promise<{ txid: string; feeSats: number; feeBtc: string; vbytes: number }> {
    const fees = await this.getFeeEstimates();
    const rate = feeRateSatVb ?? fees.halfHourFee;

    const estimate = await this.estimateSendTransaction(fromAddress, toAddress, amountBtc, rate);

    const prevouts: PrevoutInfo[] = [];
    for (const utxo of estimate.inputs) {
      const prevTx = await this.explorer.getTransaction(utxo.txid);
      if (!prevTx) {
        throw new Error(`Failed to fetch input transaction ${utxo.txid}`);
      }
      const prevVout = prevTx.vout[utxo.vout];
      if (!prevVout?.scriptpubkey) {
        throw new Error(`Missing prevout script for ${utxo.txid}:${utxo.vout}`);
      }
      prevouts.push({
        txid: utxo.txid,
        vout: utxo.vout,
        value: prevVout.value,
        scriptPubKeyHex: prevVout.scriptpubkey
      });
    }

    const { txHex, txid } = buildAndSignP2wpkhTransaction({
      network: this.config.network,
      wif,
      toAddress,
      amountSats: estimate.amountSats,
      changeAddress: fromAddress,
      changeSats: estimate.changeSats,
      feeRateSatVb: rate,
      feeSats: estimate.fee.feeSats,
      prevouts
    });

    const broadcastTxid = await this.explorer.broadcastTransaction(txHex);
    const finalTxid = broadcastTxid || txid;

    return {
      txid: finalTxid,
      feeSats: estimate.fee.feeSats,
      feeBtc: satoshisToBtc(estimate.fee.feeSats),
      vbytes: estimate.fee.vbytes
    };
  }

  /**
   * Get the private key for the current address.
   * Requires the mnemonic to derive the key.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @returns Private key in WIF format
   */
  getPrivateKey(mnemonic: string): string {
    return getBitcoinPrivateKey(
      mnemonic,
      this.config.network,
      this.accountIndex,
      0
    );
  }

  /**
   * Validate a Bitcoin address.
   *
   * @param address - Address to validate
   * @returns true if valid for current network
   */
  isValidAddress(address: string): boolean {
    return isValidBitcoinAddress(address, this.config.network);
  }

  /**
   * Get a block explorer URL for a transaction.
   *
   * @param txid - Transaction ID
   * @returns URL to Mempool.space
   */
  getTransactionUrl(txid: string): string {
    return this.explorer.getTransactionUrl(txid);
  }

  /**
   * Get a block explorer URL for an address.
   *
   * @param address - Bitcoin address
   * @returns URL to Mempool.space
   */
  getAddressUrl(address: string): string {
    return this.explorer.getAddressUrl(address);
  }

  /**
   * Clear cached data.
   */
  clearCache(): void {
    this.explorer.clearCache();
  }
}

/**
 * Provider cache to avoid recreating providers.
 */
const providerCache: Map<string, BitcoinProvider> = new Map();

/**
 * Get or create a Bitcoin provider for a network.
 *
 * @param networkKey - Network key (e.g., 'bitcoin-mainnet')
 * @returns Bitcoin provider instance
 */
export function getBitcoinProvider(networkKey: string): BitcoinProvider {
  let provider = providerCache.get(networkKey);
  if (!provider) {
    const network = networkKey === 'bitcoin-mainnet' ? 'mainnet' : 'testnet';
    provider = new BitcoinProvider({ network, networkKey });
    providerCache.set(networkKey, provider);
  }
  return provider;
}

/**
 * Check if a network key is a Bitcoin network.
 *
 * @param networkKey - Network key to check
 * @returns true if this is a Bitcoin network
 */
export function isBitcoinNetwork(networkKey: string): boolean {
  return networkKey === 'bitcoin-mainnet' || networkKey === 'bitcoin-testnet';
}
