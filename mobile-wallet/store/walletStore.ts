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

interface WalletStore {
  // Core state
  isLoading: boolean;
  isInitialized: boolean;
  isUnlocked: boolean;
  hasWallet: boolean;
  network: string;
  address: string | null;
  currentWalletName: string | null;

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

  // Networks
  networks: Record<string, NetworkConfig>;

  // Error handling
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  createWallet: (password: string, name?: string) => Promise<{ mnemonic: string; address: string }>;
  importWallet: (mnemonic: string, password: string, name?: string) => Promise<{ address: string }>;
  unlock: (password: string, name?: string) => Promise<void>;
  lock: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshPrices: () => Promise<void>;
  switchNetwork: (networkKey: string) => Promise<void>;
  getGasEstimate: (token: Token, to: string, amount: string) => Promise<GasEstimate>;
  sendTransaction: (token: Token, to: string, amount: string, destinationTag?: number) => Promise<{ hash: string }>;
  clearError: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useWalletStore = create<WalletStore>((set, get) => ({
  // Initial state
  isLoading: true,
  isInitialized: false,
  isUnlocked: false,
  hasWallet: false,
  network: 'sepolia',
  address: null,
  currentWalletName: null,

  balances: [],
  isRefreshingBalances: false,
  balancesLastUpdated: null,

  prices: {},
  totalValue: 0,
  formattedTotal: '$0.00',
  isLoadingPrices: false,

  transactions: [],
  isLoadingTransactions: false,

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

      set({
        isInitialized: true,
        isLoading: false,
        isUnlocked: state.isUnlocked,
        hasWallet: state.hasWallet,
        network: state.network,
        address: state.address,
        currentWalletName: state.currentWalletName,
        networks,
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

      // Refresh data
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

      const balances = await walletBridge.refreshBalances();

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

      await walletBridge.switchNetwork(networkKey);

      set({
        network: networkKey,
        isLoading: false,
        balances: [],
        balancesLastUpdated: null,
      });

      get().refreshBalances();
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

      return { hash: result.hash };
    } catch (error) {
      console.error('[WalletStore] Send transaction failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Transaction failed',
      });
      throw error;
    }
  },

  // ============================================================================
  // Utils
  // ============================================================================

  clearError: () => set({ error: null }),
}));
