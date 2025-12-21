# Architecture Plan: Standardizing Token Interfaces

## Objective
Establish a single, authoritative `Token` interface shared across the `mobile-wallet`, `extension`, and `cli` to eliminate type mismatches, reduce runtime errors, and simplify state management.

## Current State
*   **Core (`src/types/index.ts`)**: Defines a base `Token` type.
*   **Mobile (`services/WalletBridge.ts`)**: Defines a locally compatible `Token` interface that adds UI-specific fields like `icon` but diverges slightly.
*   **Extension**: Often defines its own shape in `types.ts` or component props.
*   **Problem**: Adding a new property (like `isVisible` or `logoURI`) requires updates in multiple files. Mismatches lead to missing icons or logic errors (e.g., `decimals` being string vs number).

## Proposed Architecture

### 1. The Single Source of Truth
We will define the canonical `Token` interface in the shared core: `src/types/token.ts`.

```typescript
export interface Token {
  // Core Identity
  symbol: string;
  name: string;
  type: 'native' | 'erc20' | 'spl' | 'jetton' | 'brc20'; // Specific types > generic 'erc20'
  address: string; // 'native' for native tokens, contract address otherwise
  decimals: number;

  // Metadata (Optional)
  logoURI?: string; // Standardized from 'icon'
  coingeckoId?: string;

  // State (UI-specific, often runtime-appended)
  balance?: string; // raw unit string
  price?: number; // USD price
  value?: number; // USD value (balance * price)
}
```

### 2. Mobile Adaptation (WalletBridge)
The mobile app will consume this type directly. We will deprecate the local `interface Token` in `WalletBridge.ts`.

*   **`TokenBalance`**: This wrapper type in `WalletBridge` will extend or compose the core `Token` type to add mobile-specific UI state (like `isVisible`, `isLoading`).

```typescript
// mobile-wallet/services/WalletBridge.ts
import type { Token } from '@wallet/types/token';

export interface TokenBalance {
  token: Token;
  // UI-specific state that doesn't belong in the core data model
  isVisible: boolean; 
  isLoading: boolean;
  lastUpdated: number | null;
}
```

### 3. Migration Strategy
1.  **Define Core Type**: Create `src/types/token.ts`.
2.  **Update Core Services**: Ensure `AppService` and `TokenRegistry` use this new type.
3.  **Update Mobile**:
    *   Import new type in `WalletBridge.ts`.
    *   Refactor `getTokens`, `refreshBalances` to map to this structure.
    *   Rename `icon` -> `logoURI` in UI components (`TokenRow`, `TokenCard`) to match standard lists (like Uniswap/Jupiter token lists).
4.  **Verify Extension**: Ensure extension components adapt to the name changes (if any).

## Benefits
*   **Type Safety**: TypeScript will catch missing properties across the monorepo.
*   **Consistency**: "native" vs "erc20" vs "spl" logic becomes centralized.
*   **Extensibility**: Adding a field like `chainId` or `verified` happens in one place.
