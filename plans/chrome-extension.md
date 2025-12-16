# Chrome extension plan / status

This file was moved from the repo root (`CHROME_EXTENSION_PLAN.md`) into `plans/` to keep all plan-style markdown in one place.

---

# Chrome Extension Implementation - Complete

## Status: ✅ Phase 1 Complete

The Chrome extension foundation has been successfully implemented on the `chrome-extension` branch.

## What's Been Implemented

### ✅ Phase 1: Extension Structure & Setup (COMPLETE)
- [x] Extension directory structure created
- [x] Manifest V3 configuration
- [x] Vite build configuration with TypeScript
- [x] React UI framework setup
- [x] ChromeStorageAdapter for persistent storage
- [x] Build scripts (`build:extension`, `watch:extension`)

### ✅ Phase 2: Core Wallet Integration (COMPLETE)
- [x] Background service worker with WalletAppService
- [x] Wallet state management (locked/unlocked)
- [x] Auto-lock timer (15 minutes)
- [x] Message passing architecture
- [x] Network and account switching
- [x] Popup UI components:
  - [x] WelcomeScreen (create/import wallet)
  - [x] UnlockScreen (password unlock)
  - [x] MainWallet (portfolio, send, network selector)

### ✅ Phase 3: dApp Integration (BASIC IMPLEMENTATION)
- [x] Content script injection
- [x] Web3 provider (`window.ethereum`)
- [x] EIP-1193 interface implementation
- [x] Message routing: dApp ↔ Content Script ↔ Background ↔ Popup
- [x] Basic JSON-RPC handlers:
  - [x] `eth_accounts`
  - [x] `eth_requestAccounts`
  - [x] `eth_chainId`
  - [ ] `eth_sendTransaction` (needs approval UI)
  - [ ] Signing methods (pending)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         dApp (Webpage)                       │
│                    window.ethereum.request()                 │
└────────────────────────┬────────────────────────────────────┘
                         │ window.postMessage
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Content Script (injected.ts)                    │
│              Message bridge & routing                        │
└────────────────────────┬────────────────────────────────────┘
                         │ chrome.runtime.sendMessage
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         Background Service Worker (service-worker.ts)        │
│         - WalletAppService instance                          │
│         - ChromeStorageAdapter                               │
│         - Auto-lock timer                                    │
│         - Request routing                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Popup UI (React Components)                     │
│              - WelcomeScreen                                 │
│              - UnlockScreen                                  │
│              - MainWallet                                    │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
extension/
├── manifest.json                     # Manifest V3 config
├── popup/
│   ├── popup.html                   # Entry HTML
│   ├── popup.tsx                    # React entry
│   ├── popup.css                    # Styles
│   ├── App.tsx                      # Main component
│   └── components/
│       ├── WelcomeScreen.tsx        # Create/import wallet
│       ├── UnlockScreen.tsx         # Password unlock
│       └── MainWallet.tsx           # Portfolio & send
├── background/
│   └── service-worker.ts            # Background worker
├── content/
│   ├── injected.ts                  # Content script
│   └── provider.ts                  # Web3 provider
└── assets/
    └── icons/                       # Extension icons (pending)

src/
└── chrome-storage.ts                # Chrome storage adapter

vite.config.extension.ts             # Build configuration
```

## How to Use

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Icons (Optional)
Open `scripts/generate-icons.html` in browser and save icons to `extension/assets/icons/`

### 3. Build Extension
```bash
npm run build:extension
```

### 4. Load in Chrome
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist-extension` folder

### 5. Development Mode
```bash
npm run watch:extension
```

See `EXTENSION_SETUP.md` for detailed instructions.

## What Works Now

1. **Wallet Creation**: Create new wallet with 12-word mnemonic
2. **Wallet Import**: Import existing wallet from recovery phrase
3. **Password Protection**: Encrypted wallet storage
4. **Multi-Chain Support**: Switch between networks (Sepolia, Mainnet, Polygon, Base, etc.)
5. **Balance Display**: View native token and ERC-20 balances
6. **Send Transactions**: Send ETH and tokens
7. **Auto-Lock**: Automatic lock after 15 minutes
8. **Basic dApp Support**: `window.ethereum` provider injected
9. **Account Access**: dApps can request account addresses
10. **Chain ID**: dApps can query current network

## What's Next (Phase 4 & 5)

### Immediate TODOs

1. **Icons**: Generate and add extension icons
2. **Transaction Approval UI** (priority)
3. **Signing Methods**: `personal_sign`, `eth_sign`, `eth_signTypedData*`
4. **Network Management**: `wallet_switchEthereumChain`, `wallet_addEthereumChain`

### Testing

- [ ] Unit tests for ChromeStorageAdapter
- [ ] Integration tests for message passing
- [ ] E2E tests with Puppeteer


