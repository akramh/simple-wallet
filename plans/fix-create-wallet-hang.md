# Fix Plan: Create Wallet UI Hang

## Issue
When creating a wallet, the app hangs/freezes because the wallet generation (specifically key derivation via PBKDF2) is a CPU-intensive synchronous operation. On mobile devices (especially in Expo Go without native C++ crypto optimization), this blocks the Javascript thread, preventing the UI from updating to show the "Loading" state.

## Root Cause
1.  `WalletBridge.createWallet` calls `this.wallet.createNewWallet(password)`.
2.  The Core SDK's `Wallet` class uses synchronous `crypto.pbkdf2Sync`.
3.  In `MobileCryptoAdapter.ts`, while `pbkdf2Async` exists (and yields), the standard `pbkdf2Sync` does not yield.
4.  React state updates are batched. If the synchronous operation starts immediately after the state update request, the render cycle is blocked before the browser can paint the new state.

## Solution
We need to force a "yield to the event loop" after setting the loading state but before triggering the blocking operation. This allows React to render the "ActivityIndicator" and disabled button state.

### 1. Update `mobile-wallet/store/walletStore.ts`
Modify `createWallet` (and `importWallet`) actions:
-   Set `isLoading: true`.
-   Add `await new Promise(resolve => setTimeout(resolve, 100));` to force a repaint.
-   Call `walletBridge.createWallet`.

### 2. Update `mobile-wallet/app/(auth)/create.tsx`
-   Improve the loading UX to match the user's request ("similar to unlock").
-   Ensure the button is clearly disabled.
-   Change the loading text to "Encrypting wallet...".

## Verification
-   Run the app (if possible) or verify via code review that the async gap exists.
-   Ensure no type errors are introduced.
