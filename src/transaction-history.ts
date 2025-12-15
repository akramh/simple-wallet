/**
 * @file transaction-history.ts
 * @description Local transaction history storage and management.
 * 
 * Provides persistent storage for transaction records associated with a wallet.
 * Stores transactions locally (via StorageAdapter) to provide offline access
 * and faster retrieval than querying block explorers.
 * 
 * @responsibilities
 * - CRUD operations for transaction records
 * - Query transactions by network, address, or status
 * - Track pending transactions for status updates
 * - Generate block explorer URLs for transaction viewing
 * 
 * @dependencies
 * - StorageAdapter for persistent storage
 * 
 * @example
 * ```typescript
 * import { TransactionHistoryManager, TransactionStatus } from './transaction-history.js';
 * 
 * const historyManager = new TransactionHistoryManager(storage, 'my-wallet');
 * 
 * historyManager.addTransaction({
 *   hash: '0x...',
 *   from: '0x...',
 *   to: '0x...',
 *   value: '1000000000000000000',
 *   network: 'mainnet',
 *   status: TransactionStatus.PENDING,
 *   type: TransactionType.SEND,
 *   timestamp: Date.now()
 * });
 * ```
 */

import { StorageAdapter } from './storage.js';

/**
 * Possible states of a blockchain transaction.
 * Used to track transaction lifecycle from submission to confirmation.
 */
export enum TransactionStatus {
  /** Transaction has been submitted but not yet mined */
  PENDING = 'pending',
  /** Transaction has been mined and confirmed on-chain */
  CONFIRMED = 'confirmed',
  /** Transaction failed (reverted, out of gas, etc.) */
  FAILED = 'failed'
}

/**
 * Classification of transaction types based on direction and intent.
 * Used for UI display and filtering.
 */
export enum TransactionType {
  /** Outgoing transfer initiated by the wallet owner */
  SEND = 'send',
  /** Incoming transfer to the wallet */
  RECEIVE = 'receive',
  /** Interaction with a smart contract (swap, approve, etc.) */
  CONTRACT_INTERACTION = 'contract_interaction'
}

/**
 * Complete transaction record stored in local history.
 * Contains all information needed to display and track a transaction.
 */
export interface Transaction {
  /** Transaction hash (0x-prefixed, 66 characters) */
  hash: string;
  /** Sender address */
  from: string;
  /** Recipient address (may be contract address) */
  to: string;
  /** Value transferred in wei (for native tokens) or smallest unit (for ERC-20) */
  value: string;
  /** Network identifier where transaction was submitted */
  network: string;
  /** Current status of the transaction */
  status: TransactionStatus;
  /** Type classification of the transaction */
  type: TransactionType;
  /** Unix timestamp in milliseconds when transaction was created/detected */
  timestamp: number;
  /** Block number where transaction was mined (set after confirmation) */
  blockNumber?: number;
  /** Gas used by the transaction (set after confirmation) */
  gasUsed?: string;
  /** Gas price in wei */
  gasPrice?: string;
  /** Token symbol for token transfers (e.g., 'USDC') */
  tokenSymbol?: string;
  /** Token contract address for token transfers */
  tokenAddress?: string;
  /** XRP destination tag (if present) */
  destinationTag?: number;
  /** Error message if transaction failed */
  error?: string;
}

/**
 * Manages local transaction history for a specific wallet.
 * 
 * Each wallet has its own transaction history stored under a unique key.
 * Transactions are persisted via the StorageAdapter and can be queried
 * by network, address, or status.
 * 
 * @example
 * ```typescript
 * const storage = new FileStorage();
 * const history = new TransactionHistoryManager(storage, 'main-wallet');
 * 
 * // Get all pending transactions
 * const pending = history.getPendingTransactions();
 * 
 * // Update status when confirmed
 * history.updateTransactionStatus(hash, TransactionStatus.CONFIRMED, blockNumber);
 * ```
 */
export class TransactionHistoryManager {
  /** Storage adapter for persistence */
  private storage: StorageAdapter;
  
  /** Unique storage key for this wallet's transactions */
  private storageKey: string;

  /**
   * Creates a new TransactionHistoryManager for a specific wallet.
   * 
   * @param storage - Storage adapter for persistence
   * @param walletName - Unique wallet identifier used in storage key
   */
  constructor(storage: StorageAdapter, walletName: string) {
    this.storage = storage;
    this.storageKey = `transactions_${walletName}`;
  }

  /**
   * Retrieves all transactions for this wallet, sorted by timestamp.
   * 
   * @returns All transactions sorted by timestamp (newest first)
   * 
   * @example
   * ```typescript
   * const allTxs = history.getAllTransactions();
   * console.log(`Total transactions: ${allTxs.length}`);
   * ```
   */
  getAllTransactions(): Transaction[] {
    const transactions = this.storage.readJSON<Transaction[]>(this.storageKey, []);
    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves transactions for a specific network.
   * 
   * @param network - Network identifier to filter by (e.g., 'mainnet', 'polygon')
   * @returns Transactions on the specified network, sorted by timestamp (newest first)
   * 
   * @example
   * ```typescript
   * const mainnetTxs = history.getTransactionsByNetwork('mainnet');
   * ```
   */
  getTransactionsByNetwork(network: string): Transaction[] {
    return this.getAllTransactions().filter(tx => tx.network === network);
  }

  /**
   * Retrieves transactions involving a specific address (as sender or recipient).
   * 
   * @param address - Ethereum address to filter by (case-insensitive)
   * @returns Transactions where address is sender or recipient, sorted by timestamp
   * 
   * @example
   * ```typescript
   * const myTxs = history.getTransactionsByAddress('0x742d35Cc...');
   * ```
   */
  getTransactionsByAddress(address: string): Transaction[] {
    const lowerAddress = address.toLowerCase();
    return this.getAllTransactions().filter(
      tx => tx.from.toLowerCase() === lowerAddress || tx.to.toLowerCase() === lowerAddress
    );
  }

  /**
   * Retrieves all transactions with pending status.
   * Useful for checking transactions that need status updates.
   * 
   * @returns Pending transactions sorted by timestamp (newest first)
   * 
   * @example
   * ```typescript
   * const pending = history.getPendingTransactions();
   * for (const tx of pending) {
   *   // Check blockchain for confirmation
   *   const receipt = await provider.getTransactionReceipt(tx.hash);
   *   if (receipt) {
   *     history.updateTransactionStatus(
   *       tx.hash,
   *       receipt.status ? TransactionStatus.CONFIRMED : TransactionStatus.FAILED,
   *       receipt.blockNumber
   *     );
   *   }
   * }
   * ```
   */
  getPendingTransactions(): Transaction[] {
    return this.getAllTransactions().filter(tx => tx.status === TransactionStatus.PENDING);
  }

  /**
   * Adds a new transaction to history or updates an existing one.
   * If a transaction with the same hash exists, it will be updated.
   * 
   * @param transaction - Complete transaction record to add
   * 
   * @example
   * ```typescript
   * history.addTransaction({
   *   hash: '0xabc...',
   *   from: '0x123...',
   *   to: '0x456...',
   *   value: '1000000000000000000', // 1 ETH in wei
   *   network: 'mainnet',
   *   status: TransactionStatus.PENDING,
   *   type: TransactionType.SEND,
   *   timestamp: Date.now()
   * });
   * ```
   */
  addTransaction(transaction: Transaction): void {
    const transactions = this.getAllTransactions();

    // Check if transaction already exists
    const existingIndex = transactions.findIndex(tx => tx.hash === transaction.hash);
    if (existingIndex >= 0) {
      // Update existing transaction
      transactions[existingIndex] = transaction;
    } else {
      // Add new transaction
      transactions.push(transaction);
    }

    this.storage.writeJSON(this.storageKey, transactions);
  }

  /**
   * Updates the status of an existing transaction.
   * Typically called when a pending transaction is confirmed or fails.
   * 
   * @param hash - Transaction hash to update
   * @param status - New transaction status
   * @param blockNumber - Block number where transaction was mined (optional)
   * @param error - Error message if transaction failed (optional)
   * 
   * @example
   * ```typescript
   * // Transaction confirmed
   * history.updateTransactionStatus(
   *   '0xabc...',
   *   TransactionStatus.CONFIRMED,
   *   12345678
   * );
   * 
   * // Transaction failed
   * history.updateTransactionStatus(
   *   '0xdef...',
   *   TransactionStatus.FAILED,
   *   undefined,
   *   'Out of gas'
   * );
   * ```
   */
  updateTransactionStatus(
    hash: string,
    status: TransactionStatus,
    blockNumber?: number,
    error?: string
  ): void {
    const transactions = this.getAllTransactions();
    const index = transactions.findIndex(tx => tx.hash === hash);

    if (index >= 0) {
      transactions[index].status = status;
      if (blockNumber !== undefined) {
        transactions[index].blockNumber = blockNumber;
      }
      if (error) {
        transactions[index].error = error;
      }
      this.storage.writeJSON(this.storageKey, transactions);
    }
  }

  /**
   * Retrieves a single transaction by its hash.
   * 
   * @param hash - Transaction hash to look up
   * @returns Transaction record if found, undefined otherwise
   * 
   * @example
   * ```typescript
   * const tx = history.getTransaction('0xabc...');
   * if (tx) {
   *   console.log(`Status: ${tx.status}`);
   * }
   * ```
   */
  getTransaction(hash: string): Transaction | undefined {
    return this.getAllTransactions().find(tx => tx.hash === hash);
  }

  /**
   * Clears all transaction history for this wallet.
   * Use with caution - this permanently deletes all local transaction records.
   * 
   * @example
   * ```typescript
   * // Clear history when deleting a wallet
   * history.clearHistory();
   * ```
   */
  clearHistory(): void {
    this.storage.writeJSON(this.storageKey, []);
  }

  /**
   * Generates a block explorer URL for viewing a transaction.
   * Supports major EVM networks with their respective explorers.
   * 
   * @param network - Network identifier
   * @param txHash - Transaction hash
   * @returns Full URL to view the transaction on the block explorer
   * 
   * @example
   * ```typescript
   * const url = TransactionHistoryManager.getExplorerUrl('mainnet', '0xabc...');
   * // Returns: 'https://etherscan.io/tx/0xabc...'
   * 
   * const polyUrl = TransactionHistoryManager.getExplorerUrl('polygon', '0xdef...');
   * // Returns: 'https://polygonscan.com/tx/0xdef...'
   * ```
   */
  static getExplorerUrl(network: string, txHash: string): string {
    /** Mapping of network identifiers to block explorer base URLs */
    const explorers: Record<string, string> = {
      mainnet: 'https://etherscan.io/tx/',
      sepolia: 'https://sepolia.etherscan.io/tx/',
      polygon: 'https://polygonscan.com/tx/',
      bsc: 'https://bscscan.com/tx/',
      arbitrum: 'https://arbiscan.io/tx/',
      optimism: 'https://optimistic.etherscan.io/tx/',
      base: 'https://basescan.org/tx/',
      avalanche: 'https://snowtrace.io/tx/',
      linea: 'https://lineascan.build/tx/',
      'bitcoin-mainnet': 'https://mempool.space/tx/',
      'bitcoin-testnet': 'https://mempool.space/testnet/tx/',
      'solana-mainnet': 'https://solscan.io/tx/',
      'solana-devnet': 'https://solscan.io/tx/',
      'xrp-mainnet': 'https://xrpscan.com/tx/',
      'xrp-testnet': 'https://testnet.xrpscan.com/tx/'
    };

    const baseUrl = explorers[network] || explorers.mainnet;
    if (network === 'solana-devnet') {
      return `${baseUrl}${txHash}?cluster=devnet`;
    }
    return `${baseUrl}${txHash}`;
  }
}
