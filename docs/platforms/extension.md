# Chrome Extension

The Chrome extension is a Manifest V3 wallet UI with popup, sidepanel,
background service worker, content scripts, and an injected EIP-1193 provider.

## Build

Run from the repository root:

```bash
npm run build:extension
```

For active development:

```bash
npm run watch:extension
```

Load `dist-extension/` from `chrome://extensions/` as an unpacked extension.
Reload the extension after each rebuild.

## Environment

Extension build-time variables must use the `VITE_` prefix:

- `VITE_ALCHEMY_API_KEY`
- `VITE_EXPLORER_API_KEY`
- `VITE_EXPLORER_API_KEY_<NETWORK>`
- `VITE_TONCENTER_API_KEY`
- `VITE_TONCENTER_API_KEY_TON_MAINNET`
- `VITE_TONCENTER_API_KEY_TON_TESTNET`
- `VITE_COINGECKO_API_KEY`

See [external APIs and environment variables](../external-apis-and-env.md).

## Runtime Architecture

```text
popup/ and sidepanel/
        |
        v
background/service-worker.ts
        |
        v
WalletAppService + ChromeStorageAdapter + WebCryptoAdapter

dApp page
        |
        v
content/provider.ts -> content/injected.ts -> service worker
```

The service worker is the only extension context that should hold decrypted
wallet state. Popup and sidepanel views request state and actions through
messages.

## dApp Provider

The extension injects a `window.ethereum` provider for EVM dApps. The content
script maps page requests into background message types. When adding or
changing RPC methods, update both:

- `extension/content/injected.ts`
- `extension/background/service-worker.ts`

Approval UI is rendered through `extension/popup/App.tsx` and
`extension/popup/components/ApprovalModal.tsx`, with shared behavior available
to the sidepanel entry.

## Supported User Flows

- Create and import wallets
- Unlock and auto-lock
- Switch networks and accounts
- View balances and portfolio
- Send native assets and supported tokens
- View activity and transaction details
- Add or hide tokens where supported
- Connect dApps and approve account, transaction, and signing requests

## Security Notes

- Keep decrypted state in the service worker only.
- Clear sensitive state on lock.
- Persist only encrypted wallet data.
- Keep extension CSP strict and regenerate it through the root scripts.
- Treat `VITE_*` keys as public bundle material; restrict them in provider
  dashboards.

## Troubleshooting

- Popup errors: right-click the popup and inspect.
- Service worker errors: open `chrome://extensions/` and inspect the service
  worker.
- Build output missing files: run `npm run build:extension` and check
  `dist-extension/`.
- Storage reset: clear `chrome.storage.local` from extension DevTools.
