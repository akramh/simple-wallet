/**
 * @fileoverview Zustand selector hooks for optimized re-renders.
 *
 * These hooks subscribe to specific slices of state rather than the entire store,
 * preventing unnecessary re-renders when unrelated state changes.
 *
 * @usage
 * // Instead of:
 * const { balances, prices, network } = useWalletStore();
 *
 * // Use:
 * const balances = useBalancesSelector();
 * const prices = usePricesSelector();
 * const network = useNetworkSelector();
 *
 * @performance
 * Each selector only triggers re-renders when its specific slice changes.
 * For objects/arrays, use useShallow to prevent reference equality issues.
 */

import { useShallow } from 'zustand/react/shallow';
import { useWalletStore } from './walletStore';

// ============================================================================
// Core State Selectors
// ============================================================================

/** Select wallet initialization and loading state */
export const useWalletStatusSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      isInitialized: state.isInitialized,
      isUnlocked: state.isUnlocked,
      hasWallet: state.hasWallet,
      error: state.error,
    }))
  );

/** Select current wallet identity */
export const useWalletIdentitySelector = () =>
  useWalletStore(
    useShallow((state) => ({
      address: state.address,
      currentWalletName: state.currentWalletName,
      currentAccountIndex: state.currentAccountIndex,
    }))
  );

// ============================================================================
// Network Selectors
// ============================================================================

/** Select current network key */
export const useNetworkSelector = () => useWalletStore((state) => state.network);

/** Select networks configuration map */
export const useNetworksSelector = () => useWalletStore((state) => state.networks);

/** Select current network config (derived) */
export const useCurrentNetworkConfigSelector = () =>
  useWalletStore((state) => state.networks[state.network]);

/** Select enabled networks for portfolio */
export const useEnabledNetworksSelector = () =>
  useWalletStore((state) => state.enabledNetworks);

/** Select network-related state and actions */
export const useNetworkStateSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      network: state.network,
      networks: state.networks,
      enabledNetworks: state.enabledNetworks,
      switchNetwork: state.switchNetwork,
      setEnabledNetworks: state.setEnabledNetworks,
    }))
  );

// ============================================================================
// Balance Selectors
// ============================================================================

/** Select token balances array */
export const useBalancesSelector = () => useWalletStore((state) => state.balances);

/**
 * Narrow selector: subscribe to one token's balance entry by symbol. Re-renders
 * only when that specific TokenBalance changes reference, not on every
 * balance-refresh tick. Useful from screens like Send that care about the
 * actively-selected token's balance, not the whole list.
 *
 * Returns `undefined` if the symbol isn't in the current network's set.
 */
export const useBalance = (symbol: string | undefined) =>
  useWalletStore((state) =>
    symbol ? state.balances.find((b) => b.token.symbol === symbol) : undefined,
  );

/** Select balance refresh state */
export const useBalanceRefreshSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      isRefreshingBalances: state.isRefreshingBalances,
      balancesLastUpdated: state.balancesLastUpdated,
      refreshBalances: state.refreshBalances,
    }))
  );

/** Select balances with refresh state and action */
export const useBalancesWithRefreshSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      balances: state.balances,
      isRefreshingBalances: state.isRefreshingBalances,
      balancesLastUpdated: state.balancesLastUpdated,
      refreshBalances: state.refreshBalances,
    }))
  );

// ============================================================================
// Price Selectors
// ============================================================================

/** Select prices map */
export const usePricesSelector = () => useWalletStore((state) => state.prices);

/**
 * Narrow selector: subscribe to one symbol's USD price. Returns a scalar so
 * Zustand's default `===` equality check skips re-renders unless that token's
 * price actually changed — a price refresh that touches other tokens won't
 * re-render the consumer.
 */
export const usePrice = (symbol: string | undefined) =>
  useWalletStore((state) => (symbol ? state.prices[symbol] ?? null : null));

/** Select portfolio totals */
export const usePortfolioTotalsSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      totalValue: state.totalValue,
      formattedTotal: state.formattedTotal,
      isLoadingPrices: state.isLoadingPrices,
    }))
  );

/** Select all-network portfolio state */
export const useAllNetworkPortfolioSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      allNetworkHoldings: state.allNetworkHoldings,
      allNetworkTotals: state.allNetworkTotals,
      allNetworksLastUpdated: state.allNetworksLastUpdated,
      isRefreshingAllNetworks: state.isRefreshingAllNetworks,
      refreshAllNetworks: state.refreshAllNetworks,
    }))
  );

// ============================================================================
// Transaction Selectors
// ============================================================================

/** Select transactions array */
export const useTransactionsSelector = () =>
  useWalletStore((state) => state.transactions);

/** Select transaction loading state */
export const useTransactionLoadingSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      isLoadingTransactions: state.isLoadingTransactions,
      transactionsLastUpdated: state.transactionsLastUpdated,
    }))
  );

/** Select transaction filter state */
export const useTransactionFilterSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      transactionFilter: state.transactionFilter,
      setTransactionFilter: state.setTransactionFilter,
      getFilteredTransactions: state.getFilteredTransactions,
    }))
  );

/** Select full transaction state for activity screen */
export const useTransactionStateSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      transactionFilter: state.transactionFilter,
      transactionsLastUpdated: state.transactionsLastUpdated,
      loadTransactions: state.loadTransactions,
      setTransactionFilter: state.setTransactionFilter,
      getFilteredTransactions: state.getFilteredTransactions,
    }))
  );

// ============================================================================
// Wallet List & Account Selectors
// ============================================================================

/** Select wallet list */
export const useWalletListSelector = () =>
  useWalletStore((state) => state.walletList);

/** Select accounts for current wallet */
export const useAccountsSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      accounts: state.accounts,
      currentAccountIndex: state.currentAccountIndex,
    }))
  );

/** Select wallet management actions */
export const useWalletManagementSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      walletList: state.walletList,
      currentWalletName: state.currentWalletName,
      loadWalletList: state.loadWalletList,
      switchWallet: state.switchWallet,
    }))
  );

/** Select account management state and actions */
export const useAccountManagementSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      accounts: state.accounts,
      currentAccountIndex: state.currentAccountIndex,
      loadAccounts: state.loadAccounts,
      createAccount: state.createAccount,
      switchAccount: state.switchAccount,
    }))
  );

// ============================================================================
// Action Selectors (stable references)
// ============================================================================

/** Select core wallet actions */
export const useWalletActionsSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      initialize: state.initialize,
      createWallet: state.createWallet,
      importWallet: state.importWallet,
      unlock: state.unlock,
      lock: state.lock,
      clearError: state.clearError,
    }))
  );

/** Select transaction actions */
export const useTransactionActionsSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      getGasEstimate: state.getGasEstimate,
      sendTransaction: state.sendTransaction,
      loadTransactions: state.loadTransactions,
    }))
  );

/** Select refresh actions */
export const useRefreshActionsSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      refreshBalances: state.refreshBalances,
      refreshPrices: state.refreshPrices,
      refreshBalancesAndPrices: state.refreshBalancesAndPrices,
      refreshAllNetworks: state.refreshAllNetworks,
      loadTransactions: state.loadTransactions,
    }))
  );

// ============================================================================
// Composite Selectors for Specific Screens
// ============================================================================

/**
 * Wallet screen selector - only subscribes to state needed for main wallet view
 */
export const useWalletScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      // Identity
      address: state.address,
      currentWalletName: state.currentWalletName,
      currentAccountIndex: state.currentAccountIndex,
      // Network
      network: state.network,
      networks: state.networks,
      // Balances
      balances: state.balances,
      isRefreshingBalances: state.isRefreshingBalances,
      balancesLastUpdated: state.balancesLastUpdated,
      // Prices
      prices: state.prices,
      formattedTotal: state.formattedTotal,
      isLoadingPrices: state.isLoadingPrices,
      // Accounts
      accounts: state.accounts,
      // Actions
      refreshBalances: state.refreshBalances,
      refreshBalancesAndPrices: state.refreshBalancesAndPrices,
    }))
  );

/**
 * Activity screen selector - only subscribes to transaction-related state
 */
export const useActivityScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      isUnlocked: state.isUnlocked,
      network: state.network,
      transactions: state.transactions,
      isLoadingTransactions: state.isLoadingTransactions,
      transactionFilter: state.transactionFilter,
      loadTransactions: state.loadTransactions,
      setTransactionFilter: state.setTransactionFilter,
      getFilteredTransactions: state.getFilteredTransactions,
    }))
  );

/**
 * Portfolio screen selector - subscribes to portfolio-specific state
 */
export const usePortfolioScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      balances: state.balances,
      formattedTotal: state.formattedTotal,
      totalValue: state.totalValue,
      prices: state.prices,
      allNetworkHoldings: state.allNetworkHoldings,
      allNetworkTotals: state.allNetworkTotals,
      allNetworksLastUpdated: state.allNetworksLastUpdated,
      isRefreshingAllNetworks: state.isRefreshingAllNetworks,
      refreshAllNetworks: state.refreshAllNetworks,
      hydrateAllNetworksFromCache: state.hydrateAllNetworksFromCache,
      networks: state.networks,
    }))
  );

/**
 * Profile screen selector - subscribes to profile/settings state
 */
export const useProfileScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      address: state.address,
      currentWalletName: state.currentWalletName,
      network: state.network,
      networks: state.networks,
      autoLockMinutes: state.autoLockMinutes,
      setAutoLockMinutes: state.setAutoLockMinutes,
      lock: state.lock,
    }))
  );

/**
 * Send screen selector - subscribes to send transaction state.
 *
 * Intentionally does *not* include the `prices` map: the send screen only
 * needs the active token's price, which it pulls via the narrow `usePrice`
 * selector. Subscribing to the whole prices Record here would re-render the
 * screen on every background price tick, even for unrelated tokens.
 */
export const useSendScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      balances: state.balances,
      network: state.network,
      networks: state.networks,
      getGasEstimate: state.getGasEstimate,
      sendTransaction: state.sendTransaction,
    }))
  );

/**
 * Unlock screen selector - subscribes to auth state
 */
export const useUnlockScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      isLoading: state.isLoading,
      hasWallet: state.hasWallet,
      walletList: state.walletList,
      lastWalletName: state.lastWalletName,
      error: state.error,
      unlock: state.unlock,
      clearError: state.clearError,
      loadWalletList: state.loadWalletList,
    }))
  );

/**
 * Network select screen selector
 */
export const useNetworkSelectScreenSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      network: state.network,
      networks: state.networks,
      enabledNetworks: state.enabledNetworks,
      showTestnets: state.showTestnets,
      isLoading: state.isLoading,
      importType: state.importType,
      privateKeyType: state.privateKeyType,
      switchNetwork: state.switchNetwork,
      setEnabledNetworks: state.setEnabledNetworks,
      toggleShowTestnets: state.toggleShowTestnets,
    }))
  );
