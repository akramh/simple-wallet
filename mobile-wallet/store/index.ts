/**
 * @fileoverview Zustand store barrel export.
 *
 * Keeps import paths stable across screens/hooks/components and makes it clear
 * that `useWalletStore` is the single global state container for the mobile app.
 */
export { useWalletStore } from './walletStore';
