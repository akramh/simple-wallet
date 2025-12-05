import { StorageAdapter } from './storage.js';

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

export enum TransactionType {
  SEND = 'send',
  RECEIVE = 'receive',
  CONTRACT_INTERACTION = 'contract_interaction'
}

export interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  network: string;
  status: TransactionStatus;
  type: TransactionType;
  timestamp: number;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  error?: string;
}

export class TransactionHistoryManager {
  private storage: StorageAdapter;
  private storageKey: string;

  constructor(storage: StorageAdapter, walletName: string) {
    this.storage = storage;
    this.storageKey = `transactions_${walletName}`;
  }

  /**
   * Get all transactions for the wallet, sorted by timestamp (newest first)
   */
  getAllTransactions(): Transaction[] {
    const transactions = this.storage.readJSON<Transaction[]>(this.storageKey, []);
    return transactions.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get transactions for a specific network
   */
  getTransactionsByNetwork(network: string): Transaction[] {
    return this.getAllTransactions().filter(tx => tx.network === network);
  }

  /**
   * Get transactions for a specific address
   */
  getTransactionsByAddress(address: string): Transaction[] {
    const lowerAddress = address.toLowerCase();
    return this.getAllTransactions().filter(
      tx => tx.from.toLowerCase() === lowerAddress || tx.to.toLowerCase() === lowerAddress
    );
  }

  /**
   * Get pending transactions
   */
  getPendingTransactions(): Transaction[] {
    return this.getAllTransactions().filter(tx => tx.status === TransactionStatus.PENDING);
  }

  /**
   * Add a new transaction to history
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
   * Update transaction status
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
   * Get a single transaction by hash
   */
  getTransaction(hash: string): Transaction | undefined {
    return this.getAllTransactions().find(tx => tx.hash === hash);
  }

  /**
   * Clear all transaction history
   */
  clearHistory(): void {
    this.storage.writeJSON(this.storageKey, []);
  }

  /**
   * Get block explorer URL for a transaction
   */
  static getExplorerUrl(network: string, txHash: string): string {
    const explorers: Record<string, string> = {
      mainnet: 'https://etherscan.io/tx/',
      sepolia: 'https://sepolia.etherscan.io/tx/',
      polygon: 'https://polygonscan.com/tx/',
      bsc: 'https://bscscan.com/tx/',
      arbitrum: 'https://arbiscan.io/tx/',
      optimism: 'https://optimistic.etherscan.io/tx/',
      base: 'https://basescan.org/tx/',
      avalanche: 'https://snowtrace.io/tx/',
      linea: 'https://lineascan.build/tx/'
    };

    const baseUrl = explorers[network] || explorers.mainnet;
    return `${baseUrl}${txHash}`;
  }
}
