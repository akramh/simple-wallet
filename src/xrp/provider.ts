/**
 * @fileoverview XRP provider - unified interface for XRP Ledger operations.
 *
 * This module provides a unified interface for XRP operations that mirrors
 * the pattern used by Bitcoin and Solana providers. It coordinates between
 * address derivation and the XRP Ledger API.
 *
 * @module xrp/provider
 */

import { deriveXRPAddress, getXRPPrivateKey, getXRPWallet, isValidXRPAddress } from './address.js';
import { XRPExplorer, getXRPExplorer } from './explorer.js';
import type {
  XRPAddressInfo,
  XRPBalance,
  NormalizedXRPTransaction,
  XRPFeeEstimate,
} from './types.js';
import { dropsToXrp, formatXrpAmount, parseXrpToDropsExact, isValidDestinationTag, BASE_FEE_DROPS } from './types.js';
import {
  buildAndSignPayment,
  validateSufficientBalance,
  calculateMaxSendable,
  validateRecipientActivation,
  type XRPTransactionResult,
} from './transaction.js';

/**
 * Portfolio result for XRP (matches EVM/Bitcoin pattern).
 */
export interface XRPPortfolioResult {
  token: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    type: 'native';
  };
  balance: string;
  balanceDrops: number;
  availableBalance: string;
  availableDrops: number;
  reservedBalance: string;
  reservedDrops: number;
  isActivated: boolean;
  error?: string;
}

/**
 * XRP provider configuration.
 */
export interface XRPProviderConfig {
  /** Network type */
  network: 'mainnet' | 'testnet' | 'devnet';
  /** Network key as used in config (e.g., 'xrp-mainnet') */
  networkKey: string;
  /** Optional custom RPC URLs */
  rpcUrls?: string[];
}

/**
 * XRP provider - unified interface for XRP Ledger operations.
 *
 * This class provides the same method patterns as the Bitcoin/Solana providers
 * to ensure consistent usage in WalletAppService. It handles:
 * - Address derivation from mnemonics
 * - Balance queries via XRP Ledger API
 * - Transaction history
 * - Fee estimates
 *
 * @example
 * ```typescript
 * const provider = new XRPProvider({
 *   network: 'mainnet',
 *   networkKey: 'xrp-mainnet'
 * });
 *
 * const address = provider.deriveAddress(mnemonic, 0);
 * const balance = await provider.getBalance(address.address);
 * ```
 */
export class XRPProvider {
  /** Network configuration */
  private config: XRPProviderConfig;
  /** Explorer API client */
  private explorer: XRPExplorer;
  /** Current address info (cached after derivation) */
  private currentAddress: XRPAddressInfo | null = null;
  /** Current account index */
  private accountIndex: number = 0;

  /**
   * Create a new XRP provider.
   *
   * @param config - Provider configuration
   */
  constructor(config: XRPProviderConfig) {
    this.config = config;
    this.explorer = getXRPExplorer(config.networkKey, config.rpcUrls);
  }

  /**
   * Get the current network.
   */
  getNetwork(): 'mainnet' | 'testnet' | 'devnet' {
    return this.config.network;
  }

  /**
   * Get the network key (e.g., 'xrp-mainnet').
   */
  getNetworkKey(): string {
    return this.config.networkKey;
  }

  /**
   * Derive an XRP address from a mnemonic.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @param accountIndex - BIP-44 account index
   * @returns XRP address information
   */
  deriveAddress(
    mnemonic: string,
    accountIndex: number = 0
  ): XRPAddressInfo {
    this.accountIndex = accountIndex;
    this.currentAddress = deriveXRPAddress(mnemonic, accountIndex);
    return this.currentAddress;
  }

  /**
   * Get the current address (must call deriveAddress first).
   *
   * @returns Current XRP address or null if not derived
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
   * Get the balance for an XRP address.
   *
   * @param address - XRP address (optional, uses current if not provided)
   * @returns Balance information with reserve calculations
   */
  async getBalance(address?: string): Promise<XRPBalance> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getBalance(addr);
  }

  /**
   * Get the formatted balance in XRP.
   *
   * @param address - XRP address (optional)
   * @returns Total balance as string in XRP (e.g., "123.456789")
   */
  async getBalanceFormatted(address?: string): Promise<string> {
    const balance = await this.getBalance(address);
    return dropsToXrp(balance.total);
  }

  /**
   * Get the available (spendable) balance in XRP.
   *
   * @param address - XRP address (optional)
   * @returns Available balance as string in XRP
   */
  async getAvailableBalanceFormatted(address?: string): Promise<string> {
    const balance = await this.getBalance(address);
    return dropsToXrp(balance.available);
  }

  /**
   * Get portfolio result matching EVM/Bitcoin format.
   * This allows the app-service to handle XRP like any other network.
   *
   * @param address - XRP address (optional)
   * @returns Portfolio result with token and balance
   */
  async getPortfolio(address?: string): Promise<XRPPortfolioResult[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [{
        token: this.getNativeToken(),
        balance: '0',
        balanceDrops: 0,
        availableBalance: '0',
        availableDrops: 0,
        reservedBalance: '0',
        reservedDrops: 0,
        isActivated: false,
        error: 'No address available',
      }];
    }

    try {
      const balance = await this.getBalance(addr);
      return [{
        token: this.getNativeToken(),
        balance: dropsToXrp(balance.total),
        balanceDrops: balance.total,
        availableBalance: dropsToXrp(balance.available),
        availableDrops: balance.available,
        reservedBalance: dropsToXrp(balance.reserved),
        reservedDrops: balance.reserved,
        isActivated: balance.isActivated,
      }];
    } catch (error) {
      return [{
        token: this.getNativeToken(),
        balance: 'Error',
        balanceDrops: 0,
        availableBalance: '0',
        availableDrops: 0,
        reservedBalance: '0',
        reservedDrops: 0,
        isActivated: false,
        error: (error as Error).message,
      }];
    }
  }

  /**
   * Get the native token definition for XRP.
   * Matches the Token interface used by EVM networks.
   */
  getNativeToken(): {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
    type: 'native';
  } {
    const isTestnet = this.config.network !== 'mainnet';
    return {
      symbol: isTestnet ? 'tXRP' : 'XRP',
      name: isTestnet ? 'XRP (Testnet)' : 'XRP',
      decimals: 6, // XRP has 6 decimal places (drops)
      address: '',
      type: 'native',
    };
  }

  /**
   * Get transaction history for an address.
   *
   * @param address - XRP address (optional)
   * @param limit - Maximum number of transactions
   * @returns Normalized transactions for display
   */
  async getTransactionHistory(
    address?: string,
    limit: number = 25
  ): Promise<NormalizedXRPTransaction[]> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      return [];
    }
    return this.explorer.getTransactionHistory(addr, limit);
  }

  /**
   * Get fee estimates for transactions.
   *
   * @returns Fee estimates in drops
   */
  async getFeeEstimates(): Promise<XRPFeeEstimate> {
    return this.explorer.getFeeEstimates();
  }

  /**
   * Get the account sequence number for transaction building.
   *
   * @param address - XRP address (optional)
   * @returns Current sequence number
   */
  async getAccountSequence(address?: string): Promise<number> {
    const addr = address || this.currentAddress?.address;
    if (!addr) {
      throw new Error('No address provided or derived');
    }
    return this.explorer.getAccountSequence(addr);
  }

  /**
   * Get the private key for the current address.
   * Requires the mnemonic to derive the key.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @returns Private key as hex string
   */
  getPrivateKey(mnemonic: string): string {
    return getXRPPrivateKey(mnemonic, this.accountIndex);
  }

  /**
   * Get an xrpl Wallet instance for signing transactions.
   *
   * @param mnemonic - BIP-39 mnemonic phrase
   * @returns xrpl Wallet instance
   */
  getWallet(mnemonic: string) {
    return getXRPWallet(mnemonic, this.accountIndex);
  }

  /**
   * Validate an XRP address.
   *
   * @param address - Address to validate
   * @returns true if valid
   */
  isValidAddress(address: string): boolean {
    return isValidXRPAddress(address);
  }

  /**
   * Get a block explorer URL for a transaction.
   *
   * @param hash - Transaction hash
   * @returns URL to XRPL explorer
   */
  getTransactionUrl(hash: string): string {
    return this.explorer.getTransactionUrl(hash);
  }

  /**
   * Get a block explorer URL for an address.
   *
   * @param address - XRP address
   * @returns URL to XRPL explorer
   */
  getAddressUrl(address: string): string {
    return this.explorer.getAddressUrl(address);
  }

  /**
   * Submit a signed transaction to the network.
   *
   * @param txBlob - Signed transaction in hex format
   * @returns Transaction hash
   */
  async submitTransaction(txBlob: string): Promise<string> {
    return this.explorer.submitTransaction(txBlob);
  }

  /**
   * Estimate a send transaction and validate parameters.
   *
   * @param fromAddress - Sender address
   * @param toAddress - Recipient address
   * @param amountXrp - Amount in XRP as string
   * @param destinationTag - Optional destination tag
   * @returns Estimate with fees and validation
   */
  async estimateSendTransaction(
    fromAddress: string,
    toAddress: string,
    amountXrp: string,
    destinationTag?: number
  ): Promise<{
    amountDrops: number;
    feeDrops: number;
    totalDrops: number;
    amountXrpStr: string;
    feeXrpStr: string;
    totalXrpStr: string;
    senderBalance: XRPBalance;
    recipientBalance: XRPBalance;
    maxSendable: number;
    maxSendableXrp: string;
  }> {
    // Validate addresses
    if (!isValidXRPAddress(fromAddress)) {
      throw new Error(`Invalid sender address: ${fromAddress}`);
    }
    if (!isValidXRPAddress(toAddress)) {
      throw new Error(`Invalid recipient address: ${toAddress}`);
    }

    // Validate destination tag
    if (destinationTag !== undefined && !isValidDestinationTag(destinationTag)) {
      throw new Error(`Invalid destination tag: ${destinationTag}`);
    }

    // Parse amount
    const amountDrops = parseXrpToDropsExact(amountXrp);
    if (amountDrops <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Get fee estimate
    const fees = await this.getFeeEstimates();
    // XRPL enforces a minimum fee (commonly 12 drops). Some servers may report lower values
    // (e.g. 10) in fee stats; clamp here so tx building doesn't fail downstream.
    const suggestedFee = Number.isFinite(fees.openLedgerFee) && fees.openLedgerFee > 0
      ? fees.openLedgerFee
      : (Number.isFinite(fees.medianFee) && fees.medianFee > 0 ? fees.medianFee : BASE_FEE_DROPS);
    const feeDrops = Math.max(BASE_FEE_DROPS, Math.trunc(suggestedFee));

    const reserves = await this.explorer.getReserves();

    // Get balances
    const [senderBalance, recipientBalance] = await Promise.all([
      this.getBalance(fromAddress),
      this.getBalance(toAddress),
    ]);

    // Calculate max sendable
    const maxSendable = calculateMaxSendable(
      senderBalance.total,
      feeDrops,
      senderBalance.ownerCount,
      reserves.reserveBaseDrops,
      reserves.reserveIncrementDrops
    );

    // Validate sender has sufficient balance
    validateSufficientBalance(
      senderBalance.total,
      amountDrops,
      feeDrops,
      senderBalance.ownerCount,
      reserves.reserveBaseDrops,
      reserves.reserveIncrementDrops
    );

    // Validate recipient activation requirement
    validateRecipientActivation(amountDrops, recipientBalance.isActivated, reserves.reserveBaseDrops);

    const totalDrops = amountDrops + feeDrops;

    return {
      amountDrops,
      feeDrops,
      totalDrops,
      amountXrpStr: dropsToXrp(amountDrops),
      feeXrpStr: dropsToXrp(feeDrops),
      totalXrpStr: dropsToXrp(totalDrops),
      senderBalance,
      recipientBalance,
      maxSendable,
      maxSendableXrp: dropsToXrp(maxSendable),
    };
  }

  /**
   * Send XRP to an address.
   *
   * @param fromAddress - Sender address
   * @param toAddress - Recipient address
   * @param amountXrp - Amount in XRP as string
   * @param mnemonic - Mnemonic for signing
   * @param destinationTag - Optional destination tag
   * @returns Transaction result with hash and fee
   */
  async sendTransaction(
    fromAddress: string,
    toAddress: string,
    amountXrp: string,
    mnemonic: string,
    destinationTag?: number
  ): Promise<XRPTransactionResult> {
    // Validate and estimate
    const estimate = await this.estimateSendTransaction(
      fromAddress,
      toAddress,
      amountXrp,
      destinationTag
    );

    // Get account sequence
    const sequence = await this.getAccountSequence(fromAddress);

    // Get current ledger index for LastLedgerSequence
    const ledgerIndex = await this.explorer.getLedgerIndex();
    // Allow 20 ledgers (~60-80 seconds) for transaction to be validated
    const lastLedgerSequence = ledgerIndex + 20;

    // Get wallet for signing
    const wallet = this.getWallet(mnemonic);

    // Build and sign transaction
    const signedTx = buildAndSignPayment(
      {
        fromAddress,
        toAddress,
        amountDrops: estimate.amountDrops,
        feeDrops: estimate.feeDrops,
        sequence,
        destinationTag,
        lastLedgerSequence,
      },
      wallet
    );

    // Submit transaction
    const hash = await this.submitTransaction(signedTx.txBlob);

    // Clear balance cache since it will change
    this.clearCache();

    return {
      hash: hash || signedTx.hash,
      feeDrops: estimate.feeDrops,
      feeXrp: estimate.feeXrpStr,
      accepted: true,
    };
  }

  /**
   * Clear cached data.
   */
  clearCache(): void {
    this.explorer.clearCache();
  }

  /**
   * Disconnect from the XRP Ledger.
   */
  async disconnect(): Promise<void> {
    await this.explorer.disconnect();
  }
}

/**
 * Provider cache to avoid recreating providers.
 */
const providerCache: Map<string, XRPProvider> = new Map();

/**
 * Get or create an XRP provider for a network.
 *
 * @param networkKey - Network key (e.g., 'xrp-mainnet')
 * @param rpcUrls - Optional custom RPC URLs
 * @returns XRP provider instance
 */
export function getXRPProvider(networkKey: string, rpcUrls?: string[]): XRPProvider {
  let provider = providerCache.get(networkKey);
  if (!provider) {
    const network = networkKey.includes('testnet') ? 'testnet' :
                    networkKey.includes('devnet') ? 'devnet' : 'mainnet';
    provider = new XRPProvider({ network, networkKey, rpcUrls });
    providerCache.set(networkKey, provider);
  }
  return provider;
}

/**
 * Clear the provider cache.
 */
export function clearXRPProviderCache(): void {
  for (const provider of providerCache.values()) {
    provider.disconnect().catch(() => {});
  }
  providerCache.clear();
}
