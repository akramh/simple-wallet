# Plan: Standardize Refresh Indicators

## Problem
The current "Refreshing..." text and spinner were placed inline within the content (static header), making them hard to see or appearing "hidden" unless the user looks at that specific spot. The user expects the indicator to appear "on top" when pulling down.

## Solution
We will strictly follow standard mobile patterns (iOS/Android):
1.  **Pull Interaction:** Rely on the native `RefreshControl` spinner.
    *   **iOS:** Use the `title` prop to show "Refreshing balances..." text *under* the native spinner during the pull.
    *   **Android:** The native spinner is sufficient (standard behavior).
2.  **Persistent Status:** The "Updated at..." timestamp should be a persistent piece of metadata, not a transient state. We will place it subtly under the main balance figures.

## Changes

### 1. `mobile-wallet/app/(tabs)/wallet.tsx`
*   **Remove:** The conditional `ActivityIndicator` and text block I added to `ListHeaderComponent`.
*   **Update `RefreshControl`:** Add `title` prop for iOS.
*   **Move "Updated At":** Place the timestamp text directly under the "Total Balance" value or the "Wallet" label.

### 2. `mobile-wallet/app/(tabs)/portfolio.tsx`
*   **Remove:** The conditional spinner/text block in the Total Value Card.
*   **Update `RefreshControl`:** Add `title` prop.
*   **Restore "Updated At":** Make it a static label in the card (e.g., "Last updated: 10:00 AM").

## Verification
*   Pull down: Native spinner (and text on iOS) appears at the top.
*   Rest state: "Updated at" time is visible.
