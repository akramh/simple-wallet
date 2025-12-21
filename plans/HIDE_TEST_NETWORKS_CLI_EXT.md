# Plan: Extend 'Hide Test Networks' to CLI and Extension

## Objective
Provide a consistent user experience by allowing CLI and Extension users to toggle the visibility of test networks, utilizing the `isTestnet` flag added to `config.json`.

## CLI Implementation

### 1. State Management
*   The CLI likely doesn't have a persistent "UI state" for toggles like the mobile app.
*   **Approach**: Add a command or configuration option to set the preference globally.
    *   `wallet config set show-testnets true/false`
    *   Store this preference in `config.json` (root level) alongside `defaultNetwork`.

### 2. Network Selection (Interactive)
*   When running `wallet network select` (or interactive prompts):
    *   Read `showTestnets` from config.
    *   Filter the list of networks presented to the user.
    *   Add an option at the bottom of the list: `[Toggle Test Networks]` to switch visibility on the fly.

## Extension Implementation

### 1. State Management
*   The extension uses `chrome.storage` via `ChromeStorageAdapter`.
*   Store `showTestnets` in local storage (similar to `WalletBridge` in mobile).

### 2. Network Selector UI
*   Locate the network dropdown/selector component (likely in `extension/popup/components/NetworkSelector.tsx` or similar).
*   Filter the list based on `isTestnet` and the stored preference.
*   Add a toggle switch or checkbox in the network selection view.

### 3. Background Service
*   Ensure the background service respects this preference if it auto-selects networks (unlikely, but good to check).

## Shared Core Updates
*   Ensure `WalletAppService` or a helper utility provides easy access to filtered networks.
*   Maybe add `getVisibleNetworks(showTestnets: boolean)` to `WalletAppService`?

## Proposed Roadmap
1.  **CLI**: Update `src/index.ts` (CLI entry point) to handle the filtering logic in prompts.
2.  **Extension**: Update the Network Selector component in `extension/popup`.
