/**
 * @fileoverview Zustand store barrel export.
 *
 * Keeps import paths stable across screens/hooks/components and makes it clear
 * that `useWalletStore` is the single global state container for the mobile app.
 *
 * @performance
 * Prefer using the optimized selectors from './selectors' instead of destructuring
 * multiple values from useWalletStore directly. Selectors prevent re-renders when
 * unrelated state changes.
 */
export { useWalletStore } from './walletStore';

// Optimized selectors for specific use cases
export {
  // Core state
  useWalletStatusSelector,
  useWalletIdentitySelector,
  // Network
  useNetworkSelector,
  useNetworksSelector,
  useCurrentNetworkConfigSelector,
  useEnabledNetworksSelector,
  useNetworkStateSelector,
  // Balances
  useBalancesSelector,
  useBalanceRefreshSelector,
  useBalancesWithRefreshSelector,
  // Prices
  usePricesSelector,
  usePortfolioTotalsSelector,
  useAllNetworkPortfolioSelector,
  // Transactions
  useTransactionsSelector,
  useTransactionLoadingSelector,
  useTransactionFilterSelector,
  useTransactionStateSelector,
  // Wallet & Account management
  useWalletListSelector,
  useAccountsSelector,
  useWalletManagementSelector,
  useAccountManagementSelector,
  // Actions
  useWalletActionsSelector,
  useTransactionActionsSelector,
  useRefreshActionsSelector,
  // Screen-specific composite selectors
  useWalletScreenSelector,
  useActivityScreenSelector,
  usePortfolioScreenSelector,
  useProfileScreenSelector,
  useSendScreenSelector,
  useUnlockScreenSelector,
  useNetworkSelectScreenSelector,
} from './selectors';
