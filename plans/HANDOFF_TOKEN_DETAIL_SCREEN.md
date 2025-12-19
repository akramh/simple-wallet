# Token Detail Screen - Handoff Notes

**Date:** December 18, 2025
**Status:** MVP Complete, Enhancements Pending

---

## Overview

Implemented a full-screen token detail view for the mobile wallet that displays comprehensive token information when a user taps a token from the wallet or portfolio screen. The design matches Phantom wallet UX patterns.

---

## What Was Implemented

### Core Screen
- **File:** `mobile-wallet/app/token-detail.tsx`
- Full-screen push navigation (not modal)
- Entry points from both `wallet.tsx` and `portfolio.tsx`

### Features Completed

1. **Navigation Integration**
   - `wallet.tsx` - Token rows are now tappable, navigate to token detail
   - `portfolio.tsx` - Holding rows are now tappable, navigate to token detail
   - Both pass required params: symbol, name, network, balance, contractAddress, isNative, decimals

2. **Price Display**
   - Shows current token price from store
   - Shows price change (value + percentage) from CoinGecko historical data
   - Color-coded: green for positive, red for negative
   - Updates to show touched price when interacting with chart

3. **Price Chart** (`components/PriceChart.tsx`)
   - SVG-based line chart using `react-native-svg`
   - Gradient fill under the line
   - Touch interaction - drag to see price at specific points
   - Dynamic colors based on trend direction
   - Loading and empty states
   - Uses existing dependencies (no new packages needed)

4. **Time Range Selector**
   - Options: 1H, 1D, 1W, 1M, YTD, ALL
   - Default: 1D
   - Switching ranges fetches new data from CoinGecko

5. **Action Buttons**
   - Send → navigates to `/send` with preselected token
   - Receive → navigates to `/receive`
   - More → shows toast "coming soon" (placeholder)

6. **Holdings Card**
   - Shows user's balance in tokens
   - Shows USD value of holdings

7. **Token Information Card**
   - Name, Symbol, Network, Type (Native/Token)
   - Contract address (for ERC-20s) with copy functionality

8. **Market Data Card**
   - Market Cap (from CoinGecko)
   - Circulating Supply
   - Total Supply
   - Website link (if available)

9. **Activity Section**
   - Shows recent transactions filtered by token
   - Uses existing `TransactionItem` component
   - "View All" navigates to activity tab

10. **Fixed Buy/Sell Footer**
    - Two buttons at bottom (above tab bar)
    - Currently show "coming soon" toasts

### New Files Created

| File | Purpose |
|------|---------|
| `app/token-detail.tsx` | Main token detail screen |
| `components/PriceChart.tsx` | SVG line chart with touch interaction |
| `services/price-history.ts` | CoinGecko price history API integration |
| `hooks/usePriceHistory.ts` | Hook for managing price history state |

### Modified Files

| File | Changes |
|------|---------|
| `app/(tabs)/wallet.tsx` | Added `onPress` to TokenRow, navigation to token-detail |
| `app/(tabs)/portfolio.tsx` | Added `onPress` to HoldingRow, navigation to token-detail |
| `components/index.ts` | Export PriceChart |
| `services/index.ts` | Export price history functions and types |
| `hooks/index.ts` | Export usePriceHistory |

---

## Price History Service

**File:** `services/price-history.ts`

### API Endpoints Used
- `GET /coins/{id}/market_chart` - Price history for charts
- `GET /coins/{id}` - Token metadata (market cap, supply, description)

### Symbol to CoinGecko ID Mapping
The service includes a mapping for common tokens:
```typescript
const SYMBOL_TO_COINGECKO_ID = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  SOL: 'solana',
  XRP: 'ripple',
  USDC: 'usd-coin',
  // ... more in the file
};
```

### Caching
- Price history: 5 minute TTL
- Token metadata: 1 hour TTL

---

## Remaining Work (Not Completed)

### 1. ExpandableText Component
**Purpose:** For "About" section with token description
**Location:** Should be `components/ExpandableText.tsx`
**Behavior:**
- Show truncated text (3 lines default)
- "Show More" button expands to full text
- "Show Less" collapses back

### 2. MoreActionsSheet Component
**Purpose:** Bottom sheet triggered by "More" button
**Actions to include:**
- Swap (hook into existing swap infra when ready)
- Buy (hook into existing buy infra)
- View on Explorer (open block explorer URL)
- Copy Contract Address

**Recommendation:** Use `@gorhom/bottom-sheet` if available, or build custom modal

### 3. About Section
**Not implemented yet.** Should show:
- Token description from `metadata.description`
- Uses ExpandableText component
- Links section (website, social) - MVP can skip social links

### 4. Buy/Sell Button Integration
Currently showing toasts. Need to:
- Hook into existing buy infrastructure (if exists)
- Hook into existing swap/sell infrastructure (if exists)

### 5. Transaction Detail Modal
When tapping a transaction in the activity list, should open `TransactionDetailsModal` with full transaction info.

---

## Navigation Params

When navigating to `/token-detail`, pass these params:

```typescript
router.push({
  pathname: '/token-detail',
  params: {
    symbol: string;           // e.g., "ETH"
    name: string;             // e.g., "Ethereum"
    network: string;          // Network key, e.g., "ethereum-mainnet"
    balance: string;          // User's balance, e.g., "1.5"
    contractAddress?: string; // ERC-20 contract address (undefined for native)
    isNative: 'true' | 'false';
    decimals?: string;        // Token decimals as string
  },
});
```

---

## Known Issues / Limitations

1. **Unsupported tokens:** Tokens not in the `SYMBOL_TO_COINGECKO_ID` mapping won't show price history or metadata. The service logs a warning and returns null.

2. **Transaction filtering:** The token activity filtering uses symbol matching as fallback. For ERC-20s, it tries to match by contract address first.

3. **Chart animation:** Uses `react-native-reanimated` for animation. If there are issues, the animated props can be removed for a static chart.

4. **Touch on chart:** The touch gesture uses `react-native-gesture-handler`. Make sure `GestureHandlerRootView` doesn't conflict with parent gesture handlers.

---

## Testing Checklist

- [ ] Navigate from wallet.tsx by tapping a token
- [ ] Navigate from portfolio.tsx by tapping a holding
- [ ] Verify price displays correctly
- [ ] Verify chart loads and shows data
- [ ] Test time range switching (1H, 1D, 1W, 1M, YTD, ALL)
- [ ] Test chart touch interaction
- [ ] Test pull-to-refresh
- [ ] Test Send button navigation
- [ ] Test Receive button navigation
- [ ] Verify market data loads (may need supported token like ETH)
- [ ] Verify activity section shows filtered transactions
- [ ] Test back navigation

---

## File Structure Reference

```
mobile-wallet/
├── app/
│   ├── token-detail.tsx          # NEW - Token detail screen
│   └── (tabs)/
│       ├── wallet.tsx            # MODIFIED - Added token tap navigation
│       └── portfolio.tsx         # MODIFIED - Added holding tap navigation
├── components/
│   ├── PriceChart.tsx            # NEW - SVG price chart
│   └── index.ts                  # MODIFIED - Export PriceChart
├── services/
│   ├── price-history.ts          # NEW - CoinGecko API integration
│   └── index.ts                  # MODIFIED - Export price history
└── hooks/
    ├── usePriceHistory.ts        # NEW - Price history hook
    └── index.ts                  # MODIFIED - Export hook
```

---

## Dependencies

No new dependencies added. Uses existing:
- `react-native-svg` - For chart rendering
- `react-native-reanimated` - For chart animation
- `react-native-gesture-handler` - For chart touch interaction

---

## Plan Document

Full implementation plan is available at:
`plans/token-detail-screen.md`

---

## Contact / Questions

If you need clarification on any implementation details, the code is well-documented with JSDoc comments explaining the purpose of each file and function.
