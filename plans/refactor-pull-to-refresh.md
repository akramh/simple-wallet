# Fix Plan: Seamless Pull-to-Refresh & UI Consistency

## Goals
1.  **Wallet Screen:** Enable "seamless" pull-to-refresh by ensuring the entire screen (header + list) is scrollable. Currently, only the token list scrolls, making the refresh gesture inaccessible from the header.
2.  **Portfolio Screen:** Remove the redundant "Refresh All" button, relying solely on the native pull-to-refresh gesture for a cleaner UI.

## Implementation Details

### 1. Refactor `mobile-wallet/app/(tabs)/wallet.tsx`
The current layout separates the static Header/Actions from the scrolling Token List.
**Change:** Refactor to use a single `FlatList` for the entire screen.

*   **Structure:**
    *   `SafeAreaView` (Root)
        *   `FlatList`
            *   `data`: `balances`
            *   `renderItem`: `<TokenRow />`
            *   `ListHeaderComponent`: A new component containing:
                *   Network/Account selectors
                *   Total Balance view
                *   Quick Action buttons
                *   "Tokens" section title
            *   `ListEmptyComponent`: The current "No tokens yet" view.
            *   `refreshControl`: The existing `<RefreshControl />`.
*   **Outcome:** The entire screen will scroll together, allowing the user to pull down from the very top to refresh.

### 2. Refactor `mobile-wallet/app/(tabs)/portfolio.tsx`
**Change:** Remove the explicit refresh button.

*   **Action:** Locate the `TouchableOpacity` labeled "Refresh all" (or "Refreshing...") inside the Total Value Card.
*   **Modification:** Delete this button. The `ScrollView` already has a `RefreshControl` connected to `refreshAllNetworks`, which provides the spinner and feedback.
*   **Refinement:** Ensure the "Updated [time]" text remains visible as it provides useful context.

## Verification
*   **Wallet Screen:**
    *   Scroll down: Header should move up.
    *   Pull down from top: Refresh spinner should appear.
    *   Empty state: Should still be visible when no tokens exist.
*   **Portfolio Screen:**
    *   "Refresh All" button is gone.
    *   Pull-to-refresh still triggers `refreshAllNetworks`.
