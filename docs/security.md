# Security

This project handles wallet secrets. Treat storage, crypto, signing, and dApp
approval changes as high-risk even when the code change looks small.

## Non-Negotiable Invariants

- Mnemonic and private-key material must never be logged.
- Mnemonics and private keys must not be stored in plaintext.
- UI state must not hold secrets longer than needed.
- Locking must clear sensitive in-memory state.
- Extension popup and sidepanel must not hold decrypted wallet state; the MV3
  service worker is the only extension context that holds decrypted state.
- Tests must not make live RPC or explorer calls.

## Encryption Parameters

The wallet encryption parameters are load-bearing:

- AES-256-GCM
- PBKDF2 with 100,000 iterations
- 32-byte salt
- 16-byte IV

Do not change these without a migration plan for existing wallets.

## Platform Storage

Root CLI storage uses `FileStorage` and encrypted wallet data in
`wallets.json`.

Extension storage uses `ChromeStorageAdapter` over `chrome.storage.local`.
Only encrypted wallet data should be persisted.

Mobile storage uses `MobileStorageAdapter`:

- Sensitive wallet data belongs in `expo-secure-store`.
- Non-sensitive session or UI state can use AsyncStorage.
- `wallets.json` contains encrypted mnemonic material and must be treated as
  sensitive.

## Address Rules

- Solana addresses are base58 and case-sensitive.
- Bitcoin supports multiple address formats, including legacy, SegWit, and
  native SegWit.
- EVM addresses use EIP-55 mixed-case checksums.
- XRP addresses can require destination tags for exchange deposits.
- TON addresses may appear in friendly or raw formats.

## Environment Keys

Alchemy uses one API key across supported chain hostnames. The hostname selects
the chain; per-network Alchemy keys are not used by this project.

For non-alphanumeric network keys, environment variable names are normalized to
uppercase with separators converted to underscores. For example,
`solana-mainnet` maps to `EXPLORER_API_KEY_SOLANA_MAINNET` and
`VITE_EXPLORER_API_KEY_SOLANA_MAINNET`.

Alchemy keys embedded in extension or mobile bundles are recoverable by users
who inspect shipped JavaScript. Restrict platform keys in provider dashboards
with extension IDs, bundle IDs, allowed origins, and other available controls.

## Known Historical Secret

Commit `8dfe258` introduced the Helius key
`fdb9849d-88cf-4fe6-91f5-057a82d724b7` in `config.json`. The key has been
revoked. Current config uses `${ALCHEMY_API_KEY}` substitution.
