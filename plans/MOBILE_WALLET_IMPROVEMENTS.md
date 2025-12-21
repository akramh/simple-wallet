# Mobile Wallet Improvements Plan

## Objective
Implement critical UX and stability improvements identified during the TON network integration review, focusing on portfolio accuracy, token management, and performance.

## 1. Fix Portfolio Pricing for Off-Network Assets
**Priority:** High
**Context:** The "All Networks" portfolio view calculates values using the active network's price store. This results in $0 or incorrect values for assets held on other networks (e.g., BTC held while on Ethereum).
**Plan:**
1.  **Refactor `getAllNetworkHoldings` (WalletBridge.ts):**
    *   Import all price providers (`getBitcoinPrice`, `getSolanaPrice`, etc.) directly into `WalletBridge`.
    *   During the aggregation loop, fetch the price for each network's native asset and tokens.
    *   Enrich the returned `holdings` array objects with `price` and `calculatedValue` properties.
2.  **Update `portfolio.tsx`:**
    *   Remove client-side value calculation logic that relies on the incomplete `prices` store.
    *   Consume the pre-calculated `value` and `price` from the enriched holdings data.

## 2. Add "Manage Tokens" Functionality
**Priority:** High
**Context:** Users cannot currently toggle token visibility or add custom tokens.
**Plan:**
1.  **Backend (WalletBridge/AppService):**
    *   Expose methods to `addCustomToken` and `setTokenVisibility`.
    *   Persist visibility preferences in `MobileStorageAdapter` (or `config.json`).
2.  **State Management (walletStore):**
    *   Add actions: `toggleTokenVisibility`, `addCustomToken`.
3.  **UI Implementation:**
    *   Create `app/manage-tokens.tsx`.
    *   List all available tokens with Switch toggles.
    *   Add a "Plus" button to open a modal for adding custom contracts (EVM).
    *   Add "Manage Tokens" entry point in `app/(tabs)/wallet.tsx`.

## 3. Enhance TON Fee UX in Send Flow
**Priority:** Medium
**Context:** TON fee estimation involves a network call. If it returns 0 or fails, the UI shouldn't imply the transaction is free.
**Plan:**
1.  **Update `services/WalletBridge.ts`:**
    *   Ensure `getGasEstimate` for TON returns a distinct error code or status if estimation fails, rather than just '0'.
2.  **Update `app/send.tsx`:**
    *   Add a specific loading skeleton for the fee row while the TON estimate is in flight.
    *   If fee is 0 and network is TON, show "Calculating..." or "Unknown" instead of "0 TON".
    *   Add a retry button for fee estimation if it fails.

## 4. Optimize "All Networks" Refresh Strategy
**Priority:** Medium
**Context:** Fetching all networks simultaneously can cause performance issues.
**Plan:**
1.  **Update `WalletBridge.ts`:**
    *   Implement a `p-limit` style concurrency control in `getAllNetworkHoldings`. Limit to ~2 concurrent network fetches.
    *   Strictly enforce the `ALL_NETWORKS_CACHE_TTL_MS`. Ensure subsequent calls within the window return the cached promise or result immediately.

## 5. Standardize Token Interfaces
**Priority:** Low (Refactor)
**Context:** Loose typing between `app-service` and `mobile-wallet` can lead to runtime errors.
**Plan:**
1.  **Define Shared Types:**
    *   Create `src/types/token.ts` (shared) or `mobile-wallet/types/token.ts`.
    *   Define strictly: `interface Token { symbol: string; decimals: number; address: string; logoURI?: string; ... }`.
2.  **Refactor:**
    *   Update `WalletBridge` and `walletStore` to use this shared interface.

## 6. Add "Hide Small Balances" Option
**Priority:** Low (UX)
**Context:** Dust cluttering the portfolio view.
**Plan:**
1.  **Store Update:**
    *   Add `hideSmallBalances` boolean to `walletStore` (persisted in AsyncStorage).
2.  **UI Update:**
    *   In `portfolio.tsx` and `wallet.tsx` (for token list), filter the list of displayed tokens based on this flag (e.g., value < $0.01).
    *   Add a toggle switch in `app/(tabs)/profile.tsx` or a new Settings screen.
