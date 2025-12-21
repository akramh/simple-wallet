# Hide Test Networks Plan

## Objective
Hide test networks (e.g., Sepolia, Goerli, Testnet) from the main network selection dropdown by default to reduce clutter for users who only care about mainnets.

## Current State
*   `WalletBridge.getNetworks()` returns all configured networks from `config.json`.
*   `app/network-select.tsx` displays this list directly.
*   `store/walletStore.ts` loads enabled networks but defaults to "non-test" logic only if empty.

## Proposed Design
1.  **Network Config Update**:
    *   Add `isTestnet: boolean` to `NetworkConfig` in `src/types/config.ts`.
    *   Update `bundled-config.ts` (or wherever static config lives) to flag testnets.
    *   *Alternative*: Infer from `name` or `type` (e.g., contains "Testnet", "Sepolia"), but explicit is better.

2.  **UI Update (`app/network-select.tsx`)**:
    *   Filter the displayed list.
    *   Add a "Show Testnets" toggle switch at the bottom of the list.
    *   State: `showTestnets` (local state or persisted in store?). Local might be enough for the modal, but usually this is a global preference.

3.  **Persistence**:
    *   Store `showTestnets` preference in `config.json` via `WalletBridge`.

## Implementation Steps

### 1. Update Configuration Types
*   Modify `src/types/config.ts`: Add `isTestnet?: boolean` to `BaseNetworkConfig`.

### 2. Tag Networks
*   Update `config/bundled-config.ts` (if exists) or logic in `WalletBridge.ts` to infer `isTestnet`.
*   *Heuristic*: If `name` contains "Testnet", "Sepolia", "Goerli", "Signet", "Devnet".

### 3. Add Preference to WalletBridge
*   Add `showTestnets` to `WalletBridge` state (loaded from `config.json`).
*   Expose `setShowTestnets(enabled: boolean)`.
*   Expose `getShowTestnets()`.

### 4. Update WalletStore
*   Add `showTestnets` to store state.
*   Add `toggleShowTestnets` action.

### 5. Update Network Selection Screen
*   In `app/network-select.tsx`:
    *   Read `showTestnets` from store.
    *   Filter `networks` list: `if (!showTestnets && net.isTestnet) continue;`.
    *   Add a `Switch` or button "Show Test Networks".

## Decision Point
*   Do we want to hide them *only* in the dropdown, or globally (e.g. if I am currently ON a testnet, should I still see it?)?
    *   *Logic*: Always show the *current* network even if it's a testnet and hidden mode is on.
