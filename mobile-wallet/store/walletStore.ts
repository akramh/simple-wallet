/**
 * @fileoverview Global wallet state store using Zustand.
 *
 * This store manages:
 * - Wallet unlock/lock state
 * - Current network and address
 * - Token balances with caching
 * - Loading and error states
 *
 * The store integrates with WalletBridge for all wallet operations
 * and provides a reactive interface for UI components.
 *
 * @responsibilities
 * - Provide a single source of truth for wallet session state (unlocked/network/address)
 * - Coordinate refresh flows (balances, prices, transactions) and their loading/error state
 * - Reset derived state on wallet/network/account switches to avoid cross-context leakage
 *
 * @security
 * - This store intentionally does NOT persist the master password.
 * - Sensitive secrets are accessed via WalletBridge and require password confirmation.
 */

import { create } from 'zustand';
import {
  walletBridge,
  WalletState,
  TokenBalance,
  Token,
  Transaction,
  GasEstimate,
  NetworkConfig,
} from '../services';

// ============================================================================
// Store Types
// ============================================================================

interface WalletInfo {
  name: string;
  address: string;
  createdAt?: string;
}

interface AccountInfo {
  index: number;
  address: string;
  createdAt?: string;
}

interface WalletStore {
  // Core state
  isLoading: boolean;
  isInitialized: boolean;
  isUnlocked: boolean;
  hasWallet: boolean;
  network: string;
  address: string | null;
  currentWalletName: string | null;

  // Wallet list
  walletList: WalletInfo[];

  // Accounts (HD derivation paths)
  accounts: AccountInfo[];
  currentAccountIndex: number;

  // Token balances
  balances: TokenBalance[];
  isRefreshingBalances: boolean;
  balancesLastUpdated: number | null;

  // Prices
  prices: Record<string, number | null>;
  totalValue: number;
  formattedTotal: string;
  isLoadingPrices: boolean;

  // Transactions
  transactions: Transaction[];
  isLoadingTransactions: boolean;
  transactionFilter: 'all' | 'sent' | 'received';
  transactionsLastUpdated: number | null;

  // Networks
  networks: Record<string, NetworkConfig>;

  // Error handling
  error: string | null;

  // Actions
  /**
   * Initialize WalletBridge + load persisted state (network, wallets).
   * Safe to call multiple times.
   */
  initialize: () => Promise<void>;
  /** Create a new wallet and unlock it for the current session. */
  createWallet: (password: string, name?: string) => Promise<{ mnemonic: string; address: string }>;
  /** Import a wallet from mnemonic and unlock it for the current session. */
  importWallet: (mnemonic: string, password: string, name?: string) => Promise<{ address: string }>;
  /** Unlock an existing wallet; refreshes accounts and balances on success. */
  unlock: (password: string, name?: string) => Promise<void>;
  /** Lock the current wallet and clear all in-memory derived state. */
  lock: () => Promise<void>;
  /** Refresh portfolio balances for the active network/account. */
  refreshBalances: () => Promise<void>;
  /** Refresh fiat prices and derived portfolio totals. */
  refreshPrices: () => Promise<void>;
  /**
   * Switch the active network.
   *
   * Resets cached balances/transactions and triggers refresh for the new context.
   */
  switchNetwork: (networkKey: string) => Promise<void>;
  /** Get an estimated network fee for a proposed transaction. */
  getGasEstimate: (token: Token, to: string, amount: string) => Promise<GasEstimate>;
  /** Send a transaction and schedule follow-up refreshes. */
  sendTransaction: (token: Token, to: string, amount: string, destinationTag?: number) => Promise<{ hash: string }>;
  /** Load the list of persisted wallets from secure storage. */
  loadWalletList: () => Promise<void>;
  /** Switch to a different wallet (locks current wallet first). */
  switchWallet: (name: string, password: string) => Promise<void>;
  
  // Account actions
  /** Load persisted accounts for the current wallet. */
  loadAccounts: () => Promise<void>;
  /** Create a new derived account and persist it to storage. */
  createAccount: () => Promise<{ address: string; index: number }>;
  /** Switch to a different derived account and refresh data for it. */
  switchAccount: (index: number) => Promise<void>;
  
  // Transaction actions
  /** Fetch transaction history for the active network/account. */
  loadTransactions: () => Promise<void>;
  /** Update the in-memory UI filter for transaction list views. */
  setTransactionFilter: (filter: 'all' | 'sent' | 'received') => void;
  /** Get the current transaction list after applying the active filter. */
  getFilteredTransactions: () => Transaction[];
  
  clearError: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

/**
 * Global Zustand store hook for the mobile wallet.
 *
 * @remarks
 * - This store is UI-facing and should only expose normalized, presentation-ready data.
 * - It delegates all wallet logic to `walletBridge` and intentionally avoids storing secrets.
 */
export const useWalletStore = create<WalletStore>((set, get) => ({
  // Initial state
  isLoading: true,
  isInitialized: false,
  isUnlocked: false,
  hasWallet: false,
  network: 'sepolia',
  address: null,
  currentWalletName: null,

  walletList: [],

  // Accounts
  accounts: [],
  currentAccountIndex: 0,

  balances: [],
  isRefreshingBalances: false,
  balancesLastUpdated: null,

  prices: {},
  totalValue: 0,
  formattedTotal: '$0.00',
  isLoadingPrices: false,

  transactions: [],
  isLoadingTransactions: false,
  transactionFilter: 'all',
  transactionsLastUpdated: null,

  networks: {},

  error: null,

  // ============================================================================
  // Initialization
  // ============================================================================

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true, error: null });

      await walletBridge.initialize();
      const state = await walletBridge.getState();
      const networks = await walletBridge.getNetworks();

      // Load wallet list
      const wallets = await walletBridge.getAllWallets();
      const walletList = Object.entries(wallets).map(([name, data]: [string, any]) => ({
        name,
        address: data.accounts?.[0]?.address || data.address || 'Unknown',
        createdAt: data.createdAt,
      }));

      set({
        isInitialized: true,
        isLoading: false,
        isUnlocked: state.isUnlocked,
        hasWallet: state.hasWallet,
        network: state.network,
        address: state.address,
        currentWalletName: state.currentWalletName,
        networks,
        walletList,
      });
    } catch (error) {
      console.error('[WalletStore] Initialization failed:', error);
      set({
        isLoading: false,
        isInitialized: true,
        error: error instanceof Error ? error.message : 'Failed to initialize wallet',
      });
    }
  },

  // ============================================================================
  // Wallet Creation & Import
  // ============================================================================

  createWallet: async (password: string, name = 'default') => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.createWallet(password, name, true);

      set({
        isLoading: false,
        isUnlocked: true,
        hasWallet: true,
        address: result.address,
        currentWalletName: name,
      });

      // Trigger initial balance fetch
      get().refreshBalances();

      return { mnemonic: result.mnemonic!, address: result.address };
    } catch (error) {
      console.error('[WalletStore] Create wallet failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create wallet',
      });
      throw error;
    }
  },

  importWallet: async (mnemonic: string, password: string, name = 'default') => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.importWallet(mnemonic, password, name);

      set({
        isLoading: false,
        isUnlocked: true,
        hasWallet: true,
        address: result.address,
        currentWalletName: name,
      });

      get().refreshBalances();

      return { address: result.address };
    } catch (error) {
      console.error('[WalletStore] Import wallet failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to import wallet',
      });
      throw error;
    }
  },

  // ============================================================================
  // Unlock & Lock
  // ============================================================================

  unlock: async (password: string, name = 'default') => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.unlockWallet(password, name);

      set({
        isLoading: false,
        isUnlocked: true,
        address: result.address,
        currentWalletName: result.walletName,
      });

      // Load accounts and refresh data
      get().loadAccounts();
      get().refreshBalances();
    } catch (error) {
      console.error('[WalletStore] Unlock failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Invalid password',
      });
      throw error;
    }
  },

  lock: async () => {
    try {
      await walletBridge.lockWallet();

      set({
        isUnlocked: false,
        address: null,
        currentWalletName: null,
        balances: [],
        transactions: [],
        prices: {},
        totalValue: 0,
        formattedTotal: '$0.00',
        accounts: [],
        currentAccountIndex: 0,
      });
    } catch (error) {
      console.error('[WalletStore] Lock failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to lock wallet',
      });
    }
  },

  // ============================================================================
  // Balances
  // ============================================================================

  refreshBalances: async () => {
    if (get().isRefreshingBalances) return;

    try {
      set({ isRefreshingBalances: true });

      console.log('[WalletStore] refreshBalances - calling walletBridge...');
      const balances = await walletBridge.refreshBalances();
      console.log('[WalletStore] refreshBalances - received balances:', JSON.stringify(balances, null, 2));

      set({
        balances,
        isRefreshingBalances: false,
        balancesLastUpdated: Date.now(),
      });

      // Also refresh prices
      get().refreshPrices();
    } catch (error) {
      console.error('[WalletStore] Refresh balances failed:', error);
      set({
        isRefreshingBalances: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balances',
      });
    }
  },

  // ============================================================================
  // Prices
  // ============================================================================

  refreshPrices: async () => {
    if (get().isLoadingPrices) return;

    try {
      set({ isLoadingPrices: true });

      const priceData = await walletBridge.getTokenPrices();

      set({
        prices: priceData.prices,
        totalValue: priceData.totalValue,
        formattedTotal: priceData.formattedTotal,
        isLoadingPrices: false,
      });
    } catch (error) {
      console.error('[WalletStore] Refresh prices failed:', error);
      set({ isLoadingPrices: false });
    }
  },

  // ============================================================================
  // Network
  // ============================================================================

  switchNetwork: async (networkKey: string) => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.switchNetwork(networkKey);

      set({
        network: networkKey,
        address: result.address,
        isLoading: false,
        balances: [],
        balancesLastUpdated: null,
        transactions: [],
        transactionsLastUpdated: null,
      });

      get().refreshBalances();
      get().loadTransactions();
    } catch (error) {
      console.error('[WalletStore] Switch network failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to switch network',
      });
      throw error;
    }
  },

  // ============================================================================
  // Transactions
  // ============================================================================

  getGasEstimate: async (token: Token, to: string, amount: string) => {
    return await walletBridge.getGasEstimate(token, to, amount);
  },

  sendTransaction: async (token: Token, to: string, amount: string, destinationTag?: number) => {
    try {
      const result = await walletBridge.sendTransaction(token, to, amount, destinationTag);

      // Refresh balances after successful transaction
      setTimeout(() => get().refreshBalances(), 2000);
      
      // Refresh transactions after a short delay to include the new one
      setTimeout(() => get().loadTransactions(), 5000);

      return { hash: result.hash };
    } catch (error) {
      console.error('[WalletStore] Send transaction failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Transaction failed',
      });
      throw error;
    }
  },

  loadTransactions: async () => {
    if (!get().isUnlocked) return;

    try {
      set({ isLoadingTransactions: true });

      const transactions = await walletBridge.getTransactions(50);

      set({
        transactions,
        isLoadingTransactions: false,
        transactionsLastUpdated: Date.now(),
      });
    } catch (error) {
      console.error('[WalletStore] Load transactions failed:', error);
      set({
        isLoadingTransactions: false,
        error: error instanceof Error ? error.message : 'Failed to load transactions',
      });
    }
  },

  setTransactionFilter: (filter: 'all' | 'sent' | 'received') => {
    set({ transactionFilter: filter });
  },

  getFilteredTransactions: () => {
    const { transactions, transactionFilter } = get();
    
    if (transactionFilter === 'all') {
      return transactions;
    }
    
    if (transactionFilter === 'sent') {
      return transactions.filter(tx => tx.type === 'send');
    }
    
    if (transactionFilter === 'received') {
      return transactions.filter(tx => tx.type === 'receive');
    }
    
    return transactions;
  },

  // ============================================================================
  // Utils
  // ============================================================================

  clearError: () => set({ error: null }),

  // ============================================================================
  // Wallet Management
  // ============================================================================

  loadWalletList: async () => {
    try {
      const wallets = await walletBridge.getAllWallets();
      const walletList = Object.entries(wallets).map(([name, data]: [string, any]) => ({
        name,
        address: data.accounts?.[0]?.address || data.address || 'Unknown',
        createdAt: data.createdAt,
      }));
      set({ walletList });
    } catch (error) {
      console.error('[WalletStore] Load wallet list failed:', error);
    }
  },

  switchWallet: async (name: string, password: string) => {
    try {
      set({ isLoading: true, error: null });

      // Lock current wallet first
      await walletBridge.lockWallet();

      // Unlock the new wallet
      const result = await walletBridge.unlockWallet(password, name);

      set({
        isLoading: false,
        isUnlocked: true,
        address: result.address,
        currentWalletName: result.walletName,
        balances: [],
        balancesLastUpdated: null,
        transactions: [],
        transactionsLastUpdated: null,
      });

      // Load accounts and refresh data
      get().loadAccounts();
      get().refreshBalances();
      get().loadTransactions();
    } catch (error) {
      console.error('[WalletStore] Switch wallet failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to switch wallet',
      });
      throw error;
    }
  },

  // ============================================================================
  // Account Management (HD Derivation)
  // ============================================================================

  loadAccounts: async () => {
    try {
      const { accounts, currentIndex } = await walletBridge.getAccounts();
      const accountList = Object.entries(accounts).map(([index, data]: [string, any]) => ({
        index: parseInt(index),
        address: data.address,
        createdAt: data.createdAt,
      }));
      
      // Sort by index
      accountList.sort((a, b) => a.index - b.index);
      
      set({
        accounts: accountList,
        currentAccountIndex: currentIndex,
      });
    } catch (error) {
      console.error('[WalletStore] Load accounts failed:', error);
    }
  },

  createAccount: async () => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.createAccount();

      // Reload accounts
      await get().loadAccounts();

      set({ isLoading: false });

      return { address: result.address, index: result.accountIndex };
    } catch (error) {
      console.error('[WalletStore] Create account failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create account',
      });
      throw error;
    }
  },

  switchAccount: async (index: number) => {
    try {
      set({ isLoading: true, error: null });

      const result = await walletBridge.switchAccount(index);

      set({
        isLoading: false,
        address: result.address,
        currentAccountIndex: index,
        balances: [],
        balancesLastUpdated: null,
        transactions: [],
        transactionsLastUpdated: null,
      });

      // Refresh balances and transactions for new account
      get().refreshBalances();
      get().loadTransactions();
    } catch (error) {
      console.error('[WalletStore] Switch account failed:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to switch account',
      });
      throw error;
    }
  },
}));
