# Development Workflow

## Repository Shape

The wallet has one shared TypeScript core in `src/` and three consumers:

- CLI: `src/index.ts`
- Chrome extension: `extension/`
- Mobile app: `mobile-wallet/`

The SDK entrypoints are:

- `src/sdk.ts` for Node and CLI usage
- `src/sdk-browser.ts` for extension and browser-like usage

## ESM Imports

The root project is ESM. Internal TypeScript imports use `.js` extensions even
when importing `.ts` source files:

```ts
import { Wallet } from './wallet.js';
```

Keep this pattern or runtime imports from `dist/` will break.

## Generated Output

Generated directories should not be edited by hand:

- `dist/`: root TypeScript build output
- `dist-extension/`: Chrome extension bundle

The extension build is driven by `vite.config.extension.ts`. It generates the
manifest CSP through `scripts/generate-manifest-csp.ts` before bundling.

## Documentation Expectations

When touching `src/`, `extension/`, or `mobile-wallet/{services,store,hooks,config}`:

- Keep a top-of-file docblock.
- Add `@responsibilities` and `@security` when the file touches session state,
  storage, crypto, network/RPC, or explorer APIs.
- Add TSDoc for new or changed exported classes, functions, interfaces, and
  types.
- Document invariants and units, such as timestamp seconds vs milliseconds,
  amount units, network keys, and address formats.

## Build Loops

For shared core changes:

```bash
npm run type-check
npm test
```

For extension changes:

```bash
npm run type-check
npm run build:extension
```

For mobile changes:

```bash
cd mobile-wallet
npm run typecheck
npm test
```

Shared-core changes can affect all platforms. Validate platform surfaces when a
change touches adapters, storage, crypto, network config, signing, or
transaction flow.
