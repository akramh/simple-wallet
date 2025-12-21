# Mobile Wallet TON Support - Implementation Plan

## Overview

This plan extends the existing TON Network support (already implemented in Core SDK, CLI, and Chrome Extension) to the mobile wallet app. The core TON functionality is complete in `src/ton/` and `src/app-service.ts` - this plan focuses on wiring it into the mobile UI layer.

## Current State Analysis

### What's Already Done (Core SDK + Extension)
- **Core TON module**: `src/ton/` (address derivation, explorer, transaction, provider, types)
- **App Service TON methods**: `src/app-service.ts` exposes:
  - `isCurrentNetworkTon()` / `isNetworkTon()`
  - `getTonAddress()` - returns `TonAddressInfo`
  - `getTonTransactionHistory()` - returns `NormalizedTonTransaction[]`
  - `sendTonTransaction(toAddress, amount, password, comment?)` - with optional comment
  - `getTonTransactionUrl(hash)` / `getTonAddressUrl()`
  - `getGasEstimate()` already handles TON networks (9 decimal fee)
  - `getPortfolioForNetwork()` already handles TON networks
- **TON Icon**: `mobile-wallet/assets/crypto/ton_symbol.png` (already added)
- **Config**: `config.json` includes `ton-mainnet` and `ton-testnet` with Toncenter endpoints
- **Price Service**: TON price support in `src/price-service.ts` (CoinGecko/Coinpaprika)
- **Extension UI**: Full TON support including optional comment field, 9-decimal fee display

### What's Missing (Mobile Wallet)

1. **WalletBridge** - No TON-specific send method or transaction history handler
2. **NetworkConfig type** - No `tonNetwork` field in mobile's NetworkConfig interface
3. **Send Screen** - No TON comment field (like XRP has destination tag)
4. **Transaction History** - No `getTonTransactions()` handler in WalletBridge
5. **Token Icon Mapping** - TON icon exists but needs wiring into token display
6. **Price Service** - No `getTonPrice()` export in mobile price-service wrapper
7. **Address Display** - Should show bounceable format (EQ... / UQ...) and TON-specific validation
8. **Tests** - No mobile-specific TON tests

---

## Implementation Tasks

### Phase 1: WalletBridge TON Support

#### Task 1.1: Update NetworkConfig Type
**File**: `mobile-wallet/services/WalletBridge.ts`

Add `tonNetwork` to the NetworkConfig interface:
```typescript
export interface NetworkConfig {
  // ... existing fields
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
  tonNetwork?: 'mainnet' | 'testnet';
}
```

#### Task 1.2: Add TON Transaction Send Support
**File**: `mobile-wallet/services/WalletBridge.ts`

In `sendTransaction()`, add TON handling (after XRP block):
```typescript
if (networkConfig.type === 'ton') {
  const result = await this.service.sendTonTransaction(
    toAddress,
    amount,
    this.sessionPassword!,
    comment  // New optional parameter
  );
  return { hash: result.hash, status: 'pending' };
}
```

Update method signature to accept `comment?` parameter:
```typescript
async sendTransaction(
  token: Token,
  toAddress: string,
  amount: string,
  destinationTag?: number,
  comment?: string  // Add this
): Promise<SendTransactionResult>
```

#### Task 1.3: Add TON Transaction History Handler
**File**: `mobile-wallet/services/WalletBridge.ts`

Add `getTonTransactions()` method (similar to existing getBitcoin/getSolana/getXRP handlers):
```typescript
private async getTonTransactions(
  address: string,
  network: string,
  limit: number
): Promise<Transaction[]> {
  const networkConfig = this.config!.networks[network];
  const nativeSymbol = networkConfig.nativeSymbol || 'TON';

  const txs = await this.service.getTonTransactionHistory(limit);

  return txs.map((tx: any) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to || null,
    value: tx.valueTon,
    network,
    status: tx.status as 'pending' | 'confirmed' | 'failed',
    type: tx.type === 'other' ? 'contract_interaction' : tx.type,
    timestamp: tx.timestamp,
    tokenSymbol: nativeSymbol,
    fee: tx.feeTon,
  }));
}
```

Update `getTransactions()` to route TON:
```typescript
if (networkConfig.type === 'ton') {
  return await this.getTonTransactions(address, network, limit);
}
```

#### Task 1.4: Add TON Price Support
**File**: `mobile-wallet/services/price-service.ts`

Add `getTonPrice()` export wrapping the core SDK price service:
```typescript
export async function getTonPrice(networkKey: string): Promise<number | null> {
  const { getTonPrice: coreTonPrice } = await import('@wallet/price-service');
  return coreTonPrice(networkKey);
}
```

Update `getTokenPrices()` to handle TON network type:
```typescript
if (netConfig?.type === 'ton') {
  priceMap.set('native', await getTonPrice(network));
}
```

---

### Phase 2: UI Updates

#### Task 2.1: Send Screen - TON Comment Field
**File**: `mobile-wallet/app/send.tsx`

Add TON detection and comment field (similar to XRP destination tag):
```typescript
// Add state
const [comment, setComment] = useState('');

// Add detection
const isTonNetwork = networkConfig?.type === 'ton';

// Add JSX (after XRP destination tag section)
{isTonNetwork && (
  <View className="mb-4">
    <View className="flex-row justify-between items-center mb-2">
      <Text className="text-white">Comment</Text>
      <Text className="text-gray-500 text-sm">(Optional)</Text>
    </View>
    <TextInput
      value={comment}
      onChangeText={setComment}
      placeholder="Enter comment (optional)"
      placeholderTextColor="#6b7280"
      className="bg-gray-900 rounded-xl px-4 py-4 text-white"
    />
    <Text className="text-gray-500 text-xs mt-1">
      Optional message attached to the transaction
    </Text>
  </View>
)}
```

Update `handleSend()` to pass comment:
```typescript
const result = await sendTransaction(
  selectedToken,
  recipient,
  amount,
  tag,  // XRP destination tag
  isTonNetwork ? comment : undefined  // TON comment
);
```

Update placeholder text for TON addresses:
```typescript
placeholder={
  isXRPNetwork ? 'rAddress...' :
  isTonNetwork ? 'EQ... or UQ...' :
  '0x... or ENS name'
}
```

#### Task 2.2: Send Screen - Confirmation Display
**File**: `mobile-wallet/app/send.tsx`

Add comment display in confirmation step:
```typescript
{isTonNetwork && comment && (
  <DetailRow label="Comment" value={comment} />
)}
```

#### Task 2.3: Token Icon Mapping
**File**: `mobile-wallet/components/TokenIcon.tsx` (or wherever icons are mapped)

Add TON icon mapping:
```typescript
const iconMap: Record<string, any> = {
  // ... existing mappings
  'TON': require('../assets/crypto/ton_symbol.png'),
  'tTON': require('../assets/crypto/ton_symbol.png'),
};
```

#### Task 2.4: Address Validation Updates
**File**: `mobile-wallet/app/send.tsx`

Add TON address validation (EQ/UQ prefix for bounceable addresses):
```typescript
// In handleContinue or validation logic
if (isTonNetwork) {
  // TON addresses are base64url encoded, typically start with EQ/UQ for mainnet workchain 0
  if (!recipient.match(/^[EU]Q[A-Za-z0-9_-]{46}$/)) {
    Alert.alert('Error', 'Invalid TON address format');
    return;
  }
}
```

---

### Phase 3: Store Updates

#### Task 3.1: Wallet Store - sendTransaction Signature
**File**: `mobile-wallet/store/walletStore.ts`

Update the `sendTransaction` action to accept optional comment:
```typescript
sendTransaction: (
  token: Token,
  to: string,
  amount: string,
  destinationTag?: number,
  comment?: string
) => Promise<{ hash: string }>;
```

Update implementation to pass comment to WalletBridge.

#### Task 3.2: Selector Updates (if needed)
**File**: `mobile-wallet/store/selectors.ts`

Ensure `useSendScreenSelector` includes networks for type detection.

---

### Phase 4: Price Service Integration

#### Task 4.1: Portfolio Pricing for TON
**File**: `mobile-wallet/services/WalletBridge.ts`

In `getTokenPrices()`, add TON handling (already partially done - verify completeness):
```typescript
// In the else-if chain after xrp:
if (networkConfig?.type === 'ton') {
  const { getTonPrice } = await import('./price-service');
  priceMap.set('native', await getTonPrice(network));
}
```

#### Task 4.2: All Networks Aggregation
**File**: `mobile-wallet/services/WalletBridge.ts`

In `getAllNetworkHoldings()`, add TON pricing (similar to existing chains):
```typescript
if (netConfig.type === 'ton') {
  const { getTonPrice } = await import('./price-service');
  const price = await getTonPrice(networkKey);
  const total = assets.reduce((acc, a) => acc + (parseFloat(a.balance || '0') * (price || 0)), 0);
  totalsByNetwork[networkKey] = total;
  continue;
}
```

---

### Phase 5: Testing

#### Task 5.1: WalletBridge TON Tests
**File**: `mobile-wallet/__tests__/WalletBridge-ton.test.ts`

Create tests for:
- TON transaction send flow
- TON transaction history normalization
- TON address validation

#### Task 5.2: Send Screen TON Tests
**File**: `mobile-wallet/__tests__/send-ton.test.ts`

Test:
- Comment field visibility when TON network selected
- Comment passed to sendTransaction
- TON address placeholder

#### Task 5.3: Integration Tests
- Happy path: Send TON with comment
- Edge case: Send TON without comment
- Validation: Invalid TON address format

---

## File Changes Summary

| File | Changes |
|------|---------|
| `mobile-wallet/services/WalletBridge.ts` | NetworkConfig type, sendTransaction, getTonTransactions, price handling |
| `mobile-wallet/services/price-service.ts` | Add getTonPrice export |
| `mobile-wallet/app/send.tsx` | Comment field, address placeholder, validation, confirmation display |
| `mobile-wallet/store/walletStore.ts` | sendTransaction signature update |
| `mobile-wallet/components/TokenIcon.tsx` | TON icon mapping |
| `mobile-wallet/__tests__/WalletBridge-ton.test.ts` | New test file |
| `mobile-wallet/__tests__/send-ton.test.ts` | New test file |

---

## Dependencies

- Core TON support is already complete in `src/ton/` and `src/app-service.ts`
- TON icon already exists at `mobile-wallet/assets/crypto/ton_symbol.png`
- TON networks already configured in `config.json`
- No new npm packages required

---

## Environment Requirements

Ensure Toncenter API keys are available:
- `TONCENTER_API_KEY_TON_MAINNET` (or use `rpcApiKey` in config.json)
- `TONCENTER_API_KEY_TON_TESTNET` (or use `rpcApiKey` in config.json)

The config.json already includes `rpcApiKey` for both TON networks, so no additional env setup is needed for mobile.

---

## Quality Checklist (per .cursor/rules.md)

- [ ] Add/update TSDoc for new/modified functions
- [ ] Add tests for TON-specific flows
- [ ] Run `npm test` (mobile-wallet) after changes
- [ ] Run `npm run typecheck` after changes
- [ ] Verify lint passes

---

## Rollout Order

1. **Phase 1** (WalletBridge) - Core integration with SDK
2. **Phase 4** (Price Service) - Ensure prices work before UI
3. **Phase 2** (UI Updates) - User-facing changes
4. **Phase 3** (Store Updates) - State management alignment
5. **Phase 5** (Testing) - Verify all flows work

---

## Notes

- Jetton transfers (TON tokens) are not supported in Phase 1 - they appear as contract interactions with 0 TON value (same as extension)
- TON uses 9 decimal places (like Solana) - this is already handled by the core SDK
- TON comments are optional text payloads (unlike XRP destination tags which are numeric)
