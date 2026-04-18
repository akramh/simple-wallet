# CLI

The CLI is the Node.js interface for the shared wallet core. Its entrypoint is
`src/index.ts`.

## Commands

Run from the repository root:

```bash
npm run dev
npm start
```

`npm run dev` runs the TypeScript source through `tsx`. `npm start` builds the
project and runs `dist/index.js`.

## Architecture

The CLI uses:

- `FileStorage` for local JSON-backed persistence
- Node crypto through the default `CryptoAdapter`
- `WalletAppService` for wallet lifecycle, networks, token management,
  portfolio, history, fee estimation, and sends
- `src/ui-helpers.ts` for terminal formatting

The CLI should stay a thin UI over `WalletAppService`; new wallet behavior
belongs in shared core unless it is purely terminal presentation.

## Data Files

Local development may create:

- `wallets.json`: encrypted wallet data
- `tokens-user.json`: custom token registry
- backup/temp files created by safe writes

Do not commit real wallet data.

## Testing

Root tests include CLI menu smoke coverage with prompts stubbed and network
providers mocked. Run:

```bash
npm test
```
