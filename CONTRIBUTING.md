# Contributing to Simple Wallet

Thanks for your interest in contributing! Simple Wallet is a multi-chain wallet
and an Alchemy API reference implementation, so contributions that improve the
code, the docs, or the clarity of the Alchemy integrations are all welcome.

## Getting set up

1. **Prerequisites:** Node.js 18+ and npm. Chrome for extension work; Xcode or
   Android Studio for native mobile work.
2. **Install and configure:**
   ```bash
   npm install
   cp .env.example .env
   # Set ALCHEMY_API_KEY (free key at https://dashboard.alchemy.com/)
   ```
3. See [docs/getting-started.md](./docs/getting-started.md) for per-platform run
   instructions and [docs/alchemy.md](./docs/alchemy.md) to understand how the
   Alchemy integrations fit together.

> **Note:** This project's maintainers sync secrets through Doppler, but you do
> **not** need Doppler to contribute. The `cp .env.example .env` flow with a free
> Alchemy key is all you need.

## Architecture in one line

Everything chain-related lives in the shared TypeScript core (`src/`). The three
UIs (CLI, `extension/`, `mobile-wallet/`) are thin: they pick adapter
implementations and render. Prefer adding features to the core and calling
through `WalletAppService` ([src/app-service.ts](./src/app-service.ts)) rather
than reaching into `Wallet` directly. See
[docs/architecture.md](./docs/architecture.md).

## Build & test loops

Match the loop to the area you touched:

| You changed… | Run |
| --- | --- |
| `src/` (shared core) | `npm run type-check && npm test` |
| `extension/` | `npm run type-check && npm run build:extension`, then reload at `chrome://extensions/` |
| `mobile-wallet/` | from that dir: `npm run typecheck && npm test` |

Shared-core changes have multi-platform blast radius — type-check and test the
affected UI surfaces too.

## Testing expectations

- **Bug fixes require a regression test** that fails before the fix and passes
  after.
- **New features require** at least one happy-path test, one failure/edge-case
  test, and an invariant test where relevant (e.g. lock clears state).
- **No live network in tests.** Providers and explorers are mocked; this is both
  a determinism rule and a security boundary. `tests/security/network-egress.test.ts`
  enforces it.
- Pick the runner by what's under test: pure logic → root `node:test`
  (`npm test`); React Native / Expo / UI → mobile Jest.

See [docs/testing.md](./docs/testing.md) for details.

## Security expectations for wallet changes

If your change touches secrets, storage, crypto, or signing, verify these before
opening a PR (and ask if anything is unclear):

- **Never** log, persist in plaintext, or over-retain mnemonics or private keys.
- **Do not casually change** encryption parameters (AES-256-GCM, PBKDF2 100k
  iterations, 32-byte salt, 16-byte IV) — a migration story is required if you
  do.
- On mobile, secrets go in `expo-secure-store` (Keychain/Keystore), never
  `AsyncStorage`.
- **Locking must clear sensitive in-memory state.**
- **Never commit real API keys.** `config.json` uses `${ALCHEMY_API_KEY}`
  placeholders; put real values only in your gitignored `.env`.

The full guardrails are in [docs/security.md](./docs/security.md).

## Documentation expectations

When a change alters commands, storage, crypto, network behavior, signing, or an
Alchemy integration, update the matching doc in the same PR. Touched files in
`src/`, `extension/`, and `mobile-wallet/{services,store,hooks,config}` should
carry the top-of-file docblock and TSDoc conventions described in the project
guidelines.

## Pull requests

- Keep PRs scoped to one change; avoid unrelated refactors.
- Ensure the relevant type-check and test loop passes.
- Describe user-visible impact and which platforms are affected.
- Reference any related issue.

## Known follow-ups

There is no CI configured yet (and `.github/` is currently gitignored). Adding
GitHub Actions to run the type-check and test loops on PRs is a welcome
contribution — it requires removing the `.github/` entry from `.gitignore` first.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.
