# Token Detail Screen Implementation Plan

**Status:** Planning
**Created:** December 18, 2025
**Target:** Mobile Wallet (React Native / Expo)

---

## Overview

Implement a full-screen token detail view that matches the Phantom wallet UX. This screen is accessed by tapping a token row from the portfolio or main wallet view and provides comprehensive token information, price charts, and quick actions.

---

## Entry Point

### Trigger
User taps a token row in:
- `app/(tabs)/wallet.tsx` - Token list in main wallet view
- `app/(tabs)/portfolio.tsx` - Holdings list in portfolio view

### Navigation
- **Type:** Full-screen push navigation (NOT modal)
- **Route:** `app/token-detail.tsx` (new file)
- **Navigation call:** `router.push({ pathname: '/token-detail', params: { ...tokenParams } })`

### Required Token Input Parameters

```typescript
interface TokenDetailParams {
  // Core identity
  symbol: string;              // e.g., "ETH", "USDC"
  name: string;                // e.g., "Ethereum", "USD Coin"

  // Network context
  network: string;             // Network key, e.g., "ethereum-mainnet"

  // User holdings
  balance: string;             // Raw balance string, e.g., "1.5"

  // Token identification
  contractAddress?: string;    // ERC-20 contract address (undefined for native)
  isNative: boolean;           // true for ETH/BTC/SOL/XRP native tokens

  // Optional (can be fetched if not provided)
  iconUrl?: string;            // Token icon URL
  decimals?: number;           // Token decimals (default 18 for EVM)
}
```

---

## Screen Structure

### Layout Overview

```
+--------------------------------------------------+
|  [<] Back     [Token Icon] Token Name  [Badge?]  |  <- Top Nav Bar
+--------------------------------------------------+
|                                                  |
|  $1,234.56                                       |  <- Primary Price (large)
|  +$12.34 (+1.23%)                                |  <- Change indicator
|                                                  |
|  +------------------------------------------+    |
|  |                                          |    |
|  |         [Price Chart - Line]             |    |  <- Interactive chart
|  |                                          |    |
|  +------------------------------------------+    |
|                                                  |
|  [1H] [1D] [1W] [1M] [YTD] [ALL]                 |  <- Time range selector
|                                                  |
+--------------------------------------------------+
|                                                  |
|  [  Send  ]  [  Receive  ]  [  More  ]          |  <- Primary action buttons
|                                                  |
+--------------------------------------------------+
|                                                  |
|  Token Information                               |  <- Section header
|  +------------------------------------------+    |
|  | Name          Ethereum                   |    |
|  | Symbol        ETH                        |    |
|  | Network       Ethereum Mainnet           |    |
|  | Market Cap    $150.2B                    |    |
|  | Total Supply  120.5M                     |    |
|  | Circulating   120.5M                     |    |
|  +------------------------------------------+    |
|                                                  |
|  About                                           |  <- Expandable section
|  +------------------------------------------+    |
|  | Ethereum is a decentralized...           |    |
|  | [Show More]                              |    |
|  +------------------------------------------+    |
|                                                  |
|  Activity                                        |  <- Recent transactions
|  +------------------------------------------+    |
|  | Received  +0.5 ETH   0x1a2b...           |    |
|  | Sent      -0.1 ETH   0x3c4d...           |    |
|  | [View All]                               |    |
|  +------------------------------------------+    |
|                                                  |
+--------------------------------------------------+
|                                                  |
|  [       Buy        ]  [       Sell       ]      |  <- Fixed bottom buttons
|                                                  |
+--------------------------------------------------+
|  [Wallet] [Activity] [Portfolio] [Profile]       |  <- Tab bar (existing)
+--------------------------------------------------+
```

---

## Detailed Component Breakdown

### 1. Top Navigation Bar

**Component:** Inline in screen (or extract to `TokenDetailHeader`)

**Elements:**
- **Back button** (left): `<` chevron icon, navigates back via `router.back()`
- **Token icon** (center-left): 24x24px, use `iconUrl` or letter fallback
- **Token name** (center): Text display of token name
- **Verified badge** (center-right, optional): Checkmark if token is in curated list (MVP: skip)

**Styling:**
```typescript
// NativeWind classes
headerContainer: "flex-row items-center px-4 py-3 border-b border-gray-800"
backButton: "p-2 mr-2"
tokenIcon: "w-6 h-6 rounded-full mr-2"
tokenName: "text-white text-lg font-semibold flex-1"
```

---

### 2. Price and Chart Section

#### 2.1 Primary Price Display

**Data Source:**
- Current price from `prices` map in store (symbol → USD)
- Calculate: `currentPrice = prices[symbol]`
- Fiat value: `fiatValue = parseFloat(balance) * currentPrice`

**Elements:**
- **Large fiat price:** e.g., "$1,234.56" (price per token, not holdings)
- **Change row:** "+$12.34 (+1.23%)" or "-$5.67 (-0.45%)"
- **Color coding:**
  - Green (#10B981, `text-green-500`) for positive
  - Red (#EF4444, `text-red-500`) for negative

**Data Requirements:**
- Price change requires historical price data (new API integration needed)
- MVP fallback: Show "—" or hide change row if data unavailable

---

#### 2.2 Price Chart

**Library Recommendation:** `react-native-chart-kit` or `victory-native`

**Chart Type:** Line chart

**Features:**
- Animated line drawing on mount
- Color matches trend direction (green/red)
- Touch interaction to show price at specific point (stretch goal)
- Loading skeleton while fetching data

**Data Source:**
- New service method: `PriceService.getPriceHistory(symbol, timeRange)`
- Returns: `Array<{ timestamp: number; price: number }>`
- Integrate with CoinGecko `/coins/{id}/market_chart` endpoint

**Chart Configuration:**
```typescript
interface ChartConfig {
  timeRange: '1H' | '1D' | '1W' | '1M' | 'YTD' | 'ALL';
  data: Array<{ timestamp: number; price: number }>;
  isPositive: boolean;
  isLoading: boolean;
}
```

**Styling:**
```typescript
chartContainer: "mx-4 h-48 bg-gray-900 rounded-xl overflow-hidden"
chartLineColor: isPositive ? "#10B981" : "#EF4444"
chartGradient: [chartLineColor + "40", chartLineColor + "00"]  // Gradient fill
```

---

#### 2.3 Time Range Selector

**Component:** `TimeRangeSelector` (new reusable component)

**Props:**
```typescript
interface TimeRangeSelectorProps {
  selected: TimeRange;
  onSelect: (range: TimeRange) => void;
  disabled?: boolean;
}

type TimeRange = '1H' | '1D' | '1W' | '1M' | 'YTD' | 'ALL';
```

**Default:** `'1D'`

**Behavior:**
- Tapping a range updates chart data
- Selected range has highlighted background
- Show loading state on chart while fetching new range

**Styling:**
```typescript
container: "flex-row justify-around mx-4 mt-4"
button: "px-3 py-2 rounded-lg"
buttonSelected: "bg-purple-600"
buttonUnselected: "bg-gray-800"
text: "text-sm font-medium"
textSelected: "text-white"
textUnselected: "text-gray-400"
```

---

### 3. Action Buttons Section

**Layout:** Three large rounded buttons in a horizontal row

**Buttons:**

| Button | Icon | Action |
|--------|------|--------|
| Send | `arrow-up` | Navigate to send flow with token pre-selected |
| Receive | `arrow-down` | Navigate to receive screen for this network |
| More | `ellipsis-horizontal` | Open bottom sheet with additional actions |

**Navigation:**
```typescript
// Send
router.push({
  pathname: '/send',
  params: {
    preselectedToken: symbol,
    preselectedNetwork: network
  }
});

// Receive
router.push({
  pathname: '/receive',
  params: { network }
});

// More
setMoreSheetVisible(true);
```

**More Bottom Sheet Options:**
- Swap (disabled badge for MVP, hooks to existing swap infra when ready)
- Buy (hooks to existing buy infra)
- View on Explorer (opens block explorer for token contract)
- Copy Contract Address (for ERC-20s only)

**Styling:**
```typescript
actionContainer: "flex-row justify-center gap-4 mx-4 my-6"
actionButton: "flex-1 bg-purple-600 rounded-2xl py-4 items-center"
actionIcon: "text-white mb-2"
actionLabel: "text-white text-sm font-medium"
```

---

### 4. Buy and Sell Fixed Footer

**Position:** Fixed at bottom, above tab bar

**Buttons:**
- **Buy:** Primary action, purple background
- **Sell:** Secondary action, gray background or outlined

**Behavior:**
- Hooks into existing buy/swap infrastructure
- MVP: Can show "Coming Soon" toast if not implemented
- Should remain visible while scrolling content above

**Implementation:**
```typescript
// Use absolute positioning or a separate View outside ScrollView
<View className="absolute bottom-0 left-0 right-0 pb-safe">
  <View className="flex-row gap-4 px-4 py-4 bg-gray-950 border-t border-gray-800">
    <Button variant="primary" className="flex-1" onPress={handleBuy}>
      Buy
    </Button>
    <Button variant="secondary" className="flex-1" onPress={handleSell}>
      Sell
    </Button>
  </View>
</View>
```

---

### 5. Token Information Section

**Component:** `TokenInfoCard` (new component)

**Data Fields:**

| Field | Source | Example |
|-------|--------|---------|
| Name | Passed as param | "Ethereum" |
| Symbol | Passed as param | "ETH" |
| Network | Derived from network key | "Ethereum Mainnet" |
| Market Cap | CoinGecko API | "$150.2B" |
| Total Supply | CoinGecko API | "120.5M" |
| Circulating Supply | CoinGecko API | "120.5M" |
| Contract Address | Passed as param (ERC-20 only) | "0x1234...5678" |

**API Integration:**
- Extend `PriceService` to fetch token metadata from CoinGecko
- Endpoint: `/coins/{id}` with `market_data` fields
- Cache for 1 hour (static data)

**Styling:**
```typescript
card: "mx-4 bg-gray-900 rounded-xl p-4"
row: "flex-row justify-between py-3 border-b border-gray-800"
rowLast: "flex-row justify-between py-3"  // No border on last
label: "text-gray-400 text-sm"
value: "text-white text-sm font-medium"
```

---

### 6. About Section

**Component:** `ExpandableText` (new reusable component)

**Props:**
```typescript
interface ExpandableTextProps {
  text: string;
  maxLines?: number;  // Default 3
  showMoreText?: string;  // Default "Show More"
  showLessText?: string;  // Default "Show Less"
}
```

**Data Source:**
- Token description from CoinGecko API
- Cache alongside token metadata

**Behavior:**
- Initially truncated to `maxLines`
- "Show More" expands to full text
- "Show Less" collapses back

**MVP Fallback:**
- If no description available, hide section or show "No description available"

---

### 7. Activity Section

**Component:** Reuse existing `TransactionItem` component

**Data Source:**
- Filter existing `transactions` from store by token symbol
- Show most recent 3-5 transactions

**Filter Logic:**
```typescript
const tokenTransactions = transactions.filter(tx => {
  // For native tokens, match any transaction on the network
  if (isNative) {
    return tx.network === network;
  }
  // For ERC-20s, match by contract address
  return tx.tokenAddress?.toLowerCase() === contractAddress?.toLowerCase();
});
```

**Elements:**
- List of `TransactionItem` components (max 5)
- "View All" button navigates to Activity tab with filter applied

**Empty State:**
- "No recent activity" message

---

## New Files Required

### Screens
1. `app/token-detail.tsx` - Main token detail screen

### Components
2. `components/TokenDetailHeader.tsx` - Top navigation bar (optional, can be inline)
3. `components/PriceChart.tsx` - Price chart with line visualization
4. `components/TimeRangeSelector.tsx` - Time range pill selector
5. `components/TokenInfoCard.tsx` - Token metadata display
6. `components/ExpandableText.tsx` - Collapsible text with "Show More"
7. `components/MoreActionsSheet.tsx` - Bottom sheet for additional actions

### Services
8. `services/price-history.ts` - Price history API integration (or extend price-service.ts)

### Store Updates
9. Update `store/walletStore.ts` - Add price history state and actions

### Hooks
10. `hooks/usePriceHistory.ts` - Hook for fetching and caching price history

---

## API Integration Requirements

### CoinGecko Endpoints Needed

#### 1. Price History (for chart)
```
GET /coins/{id}/market_chart
Parameters:
  - vs_currency: usd
  - days: 1 | 7 | 30 | 90 | 365 | max
  - interval: (auto-determined by API)

Response:
{
  prices: [[timestamp, price], ...],
  market_caps: [[timestamp, marketCap], ...],
  total_volumes: [[timestamp, volume], ...]
}
```

#### 2. Token Metadata (for info card)
```
GET /coins/{id}
Parameters:
  - localization: false
  - tickers: false
  - market_data: true
  - community_data: false
  - developer_data: false

Response includes:
  - description.en
  - market_data.market_cap.usd
  - market_data.total_supply
  - market_data.circulating_supply
  - links.homepage[0]
```

### Symbol to CoinGecko ID Mapping
Maintain a mapping in `config/coingecko-ids.ts`:
```typescript
export const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'SOL': 'solana',
  'XRP': 'ripple',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  // ... extend as needed
};
```

---

## State Management Additions

### walletStore.ts Extensions

```typescript
// New state
priceHistory: Record<string, PriceHistoryData>;  // Keyed by `${symbol}-${timeRange}`
priceHistoryLoading: boolean;
tokenMetadata: Record<string, TokenMetadata>;    // Keyed by symbol
tokenMetadataLoading: boolean;

// New actions
loadPriceHistory: (symbol: string, timeRange: TimeRange) => Promise<void>;
loadTokenMetadata: (symbol: string) => Promise<void>;

// Types
interface PriceHistoryData {
  data: Array<{ timestamp: number; price: number }>;
  fetchedAt: number;
  timeRange: TimeRange;
}

interface TokenMetadata {
  description: string;
  marketCap: number;
  totalSupply: number;
  circulatingSupply: number;
  websiteUrl?: string;
  fetchedAt: number;
}
```

### New Selector

```typescript
// selectors.ts
export const useTokenDetailSelector = () =>
  useWalletStore(
    useShallow((state) => ({
      prices: state.prices,
      priceHistory: state.priceHistory,
      priceHistoryLoading: state.priceHistoryLoading,
      tokenMetadata: state.tokenMetadata,
      tokenMetadataLoading: state.tokenMetadataLoading,
      transactions: state.transactions,
      loadPriceHistory: state.loadPriceHistory,
      loadTokenMetadata: state.loadTokenMetadata,
    }))
  );
```

---

## Navigation Updates

### 1. Update wallet.tsx

Modify `TokenRow` to navigate on press:

```typescript
// In wallet.tsx TokenRow component
const handleTokenPress = () => {
  router.push({
    pathname: '/token-detail',
    params: {
      symbol: token.symbol,
      name: token.name,
      network: network,
      balance: balance.formatted,
      contractAddress: token.address !== 'native' ? token.address : undefined,
      isNative: token.address === 'native' ? 'true' : 'false',
      iconUrl: token.iconUrl,
      decimals: token.decimals?.toString(),
    },
  });
};

// Add onPress to TouchableOpacity
<TouchableOpacity onPress={handleTokenPress} activeOpacity={0.7}>
  {/* existing TokenRow content */}
</TouchableOpacity>
```

### 2. Update portfolio.tsx

Similarly update `HoldingRow` to navigate to token detail.

### 3. Update send.tsx

Accept `preselectedToken` and `preselectedNetwork` params to auto-select token.

---

## Styling Guide

### Colors (matching existing dark theme)
- Background: `gray-950` (#030712)
- Card background: `gray-900` (#111827)
- Border: `gray-800` (#1f2937)
- Primary text: `white`
- Secondary text: `gray-400`
- Accent: `purple-500` (#a855f7)
- Success/Positive: `green-500` (#10B981)
- Error/Negative: `red-500` (#EF4444)

### Typography
- Screen title: `text-xl font-bold`
- Section header: `text-lg font-semibold`
- Price large: `text-4xl font-bold`
- Price change: `text-lg font-medium`
- Body text: `text-base`
- Label: `text-sm text-gray-400`

### Spacing
- Screen padding: `px-4`
- Section gap: `my-6`
- Card padding: `p-4`
- Row gap in cards: `py-3`

---

## Animation Considerations

### Chart Animation
- Line draws from left to right on mount
- Use `react-native-reanimated` for smooth animations
- Duration: ~500ms ease-out

### Time Range Switch
- Crossfade between chart states
- Price/change numbers animate on value change

### Bottom Sheet
- Slide up animation for "More" sheet
- Use `@gorhom/bottom-sheet` (already in project) or build custom

---

## Error Handling

### Network Errors
- Show cached data if available
- Display subtle "Offline" indicator
- Retry button for failed requests

### Missing Data
- Token icon: Use letter fallback (existing pattern)
- Price history: Show "Price data unavailable" with empty chart state
- Token metadata: Show available fields, hide unavailable ones
- Description: Hide "About" section if no description

### Loading States
- Skeleton loaders for chart area
- Shimmer effect on info card rows
- Disabled state on action buttons while loading

---

## Testing Requirements

### Unit Tests
1. `TimeRangeSelector.test.tsx` - Selection state, callback firing
2. `ExpandableText.test.tsx` - Truncation, expansion toggle
3. `TokenInfoCard.test.tsx` - Data display, missing field handling
4. `usePriceHistory.test.tsx` - Data fetching, caching, error states

### Integration Tests
1. Token detail screen renders with all sections
2. Navigation from wallet.tsx token tap
3. Navigation to send with pre-selected token
4. Price history fetch and chart render
5. Transaction filtering by token

### E2E Tests (Detox)
1. Full flow: Wallet → Token Detail → Send
2. Full flow: Wallet → Token Detail → Receive

---

## Implementation Phases

### Phase 1: Core Screen Structure (MVP)
- [ ] Create `token-detail.tsx` with basic layout
- [ ] Implement navigation from wallet.tsx and portfolio.tsx
- [ ] Add header with back navigation
- [ ] Display static price from existing prices map
- [ ] Add action buttons (Send, Receive, More placeholder)
- [ ] Add fixed Buy/Sell footer (disabled state)

### Phase 2: Token Information
- [ ] Create `TokenInfoCard` component
- [ ] Display static fields (name, symbol, network, contract)
- [ ] Integrate CoinGecko metadata API
- [ ] Add market cap, supply fields
- [ ] Create `ExpandableText` for description

### Phase 3: Price Chart
- [ ] Add chart library dependency
- [ ] Create `PriceChart` component with mock data
- [ ] Integrate CoinGecko price history API
- [ ] Create `TimeRangeSelector` component
- [ ] Implement range switching with loading states
- [ ] Add chart animations

### Phase 4: Activity Section
- [ ] Filter transactions by token
- [ ] Display recent activity list
- [ ] Add "View All" navigation to activity tab

### Phase 5: More Actions Sheet
- [ ] Create bottom sheet component
- [ ] Add Swap/Buy/Explorer/Copy actions
- [ ] Hook into existing infrastructure

### Phase 6: Polish
- [ ] Loading skeletons and animations
- [ ] Error states and offline handling
- [ ] Accessibility labels
- [ ] Performance optimization

---

## Dependencies to Add

```json
{
  "dependencies": {
    "react-native-chart-kit": "^6.12.0",
    // OR
    "victory-native": "^40.0.0"
  }
}
```

Note: Check if `@gorhom/bottom-sheet` is already installed for the More actions sheet.

---

## Open Questions / Decisions Needed

1. **Chart library choice:** `react-native-chart-kit` vs `victory-native` vs custom SVG
2. **Price history caching TTL:** 5 minutes? 15 minutes?
3. **Buy/Sell button behavior:** What existing infra do they hook into?
4. **Verified badge logic:** Skip for MVP or implement basic check?
5. **Social links in About:** Include or skip for MVP?

---

## Estimated Component Count

| Type | Count |
|------|-------|
| New screens | 1 |
| New components | 6-7 |
| Service extensions | 1-2 |
| Store additions | 2-3 actions, 4-5 state fields |
| Hook additions | 1-2 |
| Test files | 4-6 |

---

*This plan should be reviewed and approved before implementation begins.*
