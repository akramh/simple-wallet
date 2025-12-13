/**
 * @fileoverview Bitcoin-specific type definitions.
 *
 * Defines types for Bitcoin network operations including UTXOs,
 * balances, addresses, and transactions.
 *
 * @module bitcoin/types
 */

/**
 * Unspent Transaction Output (UTXO) from the Bitcoin blockchain.
 * UTXOs are the fundamental unit of Bitcoin that can be spent.
 */
export interface UTXO {
  /** Transaction ID containing this output */
  txid: string;
  /** Output index within the transaction */
  vout: number;
  /** Value in satoshis */
  value: number;
  /** Confirmation status */
  status: {
    /** Whether the transaction is confirmed */
    confirmed: boolean;
    /** Block height if confirmed */
    block_height?: number;
    /** Block hash if confirmed */
    block_hash?: string;
    /** Block time if confirmed */
    block_time?: number;
  };
}

/**
 * Bitcoin address balance information.
 * Separates confirmed and unconfirmed (mempool) balances.
 */
export interface BitcoinBalance {
  /** Confirmed balance in satoshis */
  confirmed: number;
  /** Unconfirmed balance in satoshis (pending in mempool) */
  unconfirmed: number;
  /** Total balance (confirmed + unconfirmed) in satoshis */
  total: number;
}

/**
 * Bitcoin address derivation result.
 * Contains the derived address and associated key information.
 */
export interface BitcoinAddressInfo {
  /** Bitcoin address (bc1q... for mainnet, tb1q... for testnet) */
  address: string;
  /** Compressed public key hex */
  publicKey: string;
  /** BIP-84 derivation path used */
  derivationPath: string;
  /** Network type */
  network: 'mainnet' | 'testnet';
}

/**
 * Bitcoin transaction from Mempool.space API.
 * Represents a transaction involving the queried address.
 */
export interface BitcoinTransaction {
  /** Transaction ID */
  txid: string;
  /** Transaction version */
  version: number;
  /** Lock time */
  locktime: number;
  /** Transaction inputs */
  vin: BitcoinTransactionInput[];
  /** Transaction outputs */
  vout: BitcoinTransactionOutput[];
  /** Transaction size in bytes */
  size: number;
  /** Transaction weight */
  weight: number;
  /** Transaction fee in satoshis */
  fee: number;
  /** Confirmation status */
  status: {
    /** Whether confirmed */
    confirmed: boolean;
    /** Block height if confirmed */
    block_height?: number;
    /** Block hash if confirmed */
    block_hash?: string;
    /** Block time if confirmed */
    block_time?: number;
  };
}

/**
 * Bitcoin transaction input.
 */
export interface BitcoinTransactionInput {
  /** Previous transaction ID */
  txid: string;
  /** Previous output index */
  vout: number;
  /** Previous output address (if available) */
  prevout?: {
    /** Script public key */
    scriptpubkey: string;
    /** Script public key address */
    scriptpubkey_address?: string;
    /** Script public key type */
    scriptpubkey_type: string;
    /** Value in satoshis */
    value: number;
  };
  /** Script signature */
  scriptsig: string;
  /** Witness data */
  witness?: string[];
  /** Is coinbase transaction */
  is_coinbase: boolean;
  /** Sequence number */
  sequence: number;
}

/**
 * Bitcoin transaction output.
 */
export interface BitcoinTransactionOutput {
  /** Script public key */
  scriptpubkey: string;
  /** Script public key address */
  scriptpubkey_address?: string;
  /** Script public key type */
  scriptpubkey_type: string;
  /** Value in satoshis */
  value: number;
}

/**
 * Normalized Bitcoin transaction for display.
 * Matches the structure used by the existing transaction history system.
 */
export interface NormalizedBitcoinTransaction {
  /** Transaction ID */
  hash: string;
  /** Sender address (first input address) */
  from: string;
  /** Recipient address (relevant output address) */
  to: string;
  /** Value in satoshis as string */
  value: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Block height */
  blockNumber: number;
  /** Transaction fee in satoshis */
  fee: string;
  /** Transaction status */
  status: 'confirmed' | 'pending';
  /** Transaction type relative to the queried address */
  type: 'send' | 'receive';
  /** Network identifier */
  network: string;
  /** Number of confirmations */
  confirmations?: number;
}

/**
 * Fee estimation result from Mempool.space.
 * Contains recommended fee rates for different confirmation targets.
 */
export interface BitcoinFeeEstimate {
  /** Fee rate for fastest confirmation (next block) in sat/vB */
  fastestFee: number;
  /** Fee rate for ~30 min confirmation in sat/vB */
  halfHourFee: number;
  /** Fee rate for ~1 hour confirmation in sat/vB */
  hourFee: number;
  /** Fee rate for economy (low priority) in sat/vB */
  economyFee: number;
  /** Minimum relay fee in sat/vB */
  minimumFee: number;
}

/**
 * Bitcoin network configuration.
 * Extends the base network config with Bitcoin-specific fields.
 */
export interface BitcoinNetworkConfig {
  /** Network type discriminator */
  type: 'bitcoin';
  /** Bitcoin network (mainnet, testnet, signet) */
  bitcoinNetwork: 'mainnet' | 'testnet' | 'signet';
  /** Native token symbol */
  nativeSymbol: string;
  /** Native token name */
  nativeName: string;
  /** Block explorer URL */
  blockExplorer?: string;
  /** Mempool.space API URL */
  explorerApiUrl?: string;
  /** Human-readable network name */
  name?: string;
}

/**
 * Satoshi/BTC conversion constants.
 */
export const SATOSHIS_PER_BTC = 100_000_000;

/**
 * Convert satoshis to BTC.
 * @param satoshis - Amount in satoshis
 * @returns Amount in BTC as string with 8 decimal places
 */
export function satoshisToBtc(satoshis: number): string {
  return (satoshis / SATOSHIS_PER_BTC).toFixed(8);
}

/**
 * Convert BTC to satoshis.
 * @param btc - Amount in BTC
 * @returns Amount in satoshis as integer
 */
export function btcToSatoshis(btc: string | number): number {
  const btcNum = typeof btc === 'string' ? parseFloat(btc) : btc;
  return Math.round(btcNum * SATOSHIS_PER_BTC);
}

/**
 * Format satoshis for display with BTC symbol.
 * @param satoshis - Amount in satoshis
 * @param symbol - Currency symbol (default: 'BTC')
 * @returns Formatted string like "0.00123456 BTC"
 */
export function formatBtcAmount(satoshis: number, symbol: string = 'BTC'): string {
  const btc = satoshis / SATOSHIS_PER_BTC;
  // Remove trailing zeros but keep at least 2 decimal places
  const formatted = btc.toFixed(8).replace(/\.?0+$/, '');
  const parts = formatted.split('.');
  if (parts.length === 1) {
    return `${parts[0]}.00 ${symbol}`;
  }
  if (parts[1].length < 2) {
    return `${parts[0]}.${parts[1].padEnd(2, '0')} ${symbol}`;
  }
  return `${formatted} ${symbol}`;
}
