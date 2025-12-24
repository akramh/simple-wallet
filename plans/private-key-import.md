# Private Key Import Plan

## Objective
Enable users to import a wallet using a raw private key instead of a BIP-39 mnemonic phrase.

## Problem Statement
The current architecture is strictly coupled to HD Wallets (Hierarchical Deterministic) derived from a 12-24 word mnemonic. 
- `Wallet` class expects a mnemonic.
- Storage (`wallets.json`) requires `encryptedMnemonic`.
- Multi-chain derivation assumes one seed generates keys for all chains (EVM, BTC, SOL, etc.).

A raw private key represents a **single account** on a specific cryptographic curve. It cannot generate a tree of accounts, nor can a key from one curve typically be used on another.

## Proposed Architecture

### 1. Storage Schema Update (`src/wallet.ts`, `src/types/wallet.ts`)
Update the `EncryptedWallet` interface to support either a mnemonic or a private key.

**Proposed Schema:**
```typescript
interface EncryptedWallet {
  encryptedMnemonic?: string;
  encryptedPrivateKey?: string; 
  importType: 'mnemonic' | 'privateKey';
  privateKeyType?: 'evm' | 'solana' | 'bitcoin' | 'xrp' | 'ton';
  salt: string;
  iv: string;
  authTag: string;
  createdAt: string;
}
```

### 2. Core SDK Changes (`src/wallet.ts`)
- **Initialization:** Add `importFromPrivateKey(key: string, type: ChainType, password: string)`.
- **Derivation Guards:** Methods like `getBitcoinAddress` must verify `importType` and `privateKeyType`.

## Implementation & Testing Phases

### Phase 1: Core SDK & Service Layer
- **Implementation:** Refactor types and implement private key logic in `src/wallet.ts` and `src/app-service.ts`.
- **Testing (Required):**
  - **Unit Tests:** `tests/wallet-private-key.test.ts` (New file)
    - Test successful import of EVM, Bitcoin, and Solana keys.
    - Test that an EVM private key *cannot* derive a Bitcoin address (and vice versa).
    - Test save/load and password change functionality for private-key wallets.
  - **Regression:** Ensure existing mnemonic-based wallets still load and function correctly.

### Phase 2: CLI Implementation
- **Implementation:** Update menus and add interactive prompts in `src/index.ts`.
- **Testing (Required):**
  - **Manual/Smoke Test:** Verify the "Import Wallet (Private Key)" path in the terminal.
  - **Input Validation:** Test that invalid hex strings or WIF keys are rejected.

### Phase 3: Chrome Extension Implementation
- **Implementation:** Update the React setup flow in the extension popup.
- **Testing (Required):**
  - **UI Unit Tests:** Use Vitest/Jest for React component state (mnemonic vs key mode).
  - **End-to-End:** Verify that importing an EVM key allows successful interaction with the dashboard and `eth_accounts`.

### Phase 4: Mobile Bridge & Service Adapters
- **Implementation:** Update `mobile-wallet/services/WalletBridge.ts`.
- **Testing (Required):**
  - **Unit Tests:** `mobile-wallet/__tests__/WalletBridge-privatekey.test.ts`
    - Verify the bridge correctly passes keys to the Core SDK.
    - Test auto-lock and session password behavior with private-key wallets.

### Phase 5: Mobile App UI
- **Implementation:** Modify `mobile-wallet/app/(setup)/import.tsx`.
- **Testing (Required):**
  - **Snapshot/Component Tests:** Verify the mode toggle and input fields.
  - **Integration:** Verify "Single Account" wallets show correctly in the Wallet tab.

### Phase 6: Restrictions & Safety
- **Logic:** Disable HD-only features (Add Account, View Mnemonic) for private-key wallets.
- **Testing:** Ensure these options are hidden or gracefully disabled in all three UIs.