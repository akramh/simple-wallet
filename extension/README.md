# Simple Crypto Wallet - Browser Extension

A Chrome extension for multi-chain cryptocurrency wallet management with dApp integration. Supports Ethereum (EVM chains), Bitcoin, Solana, XRP, and TON.

## Quick Start

### Prerequisites

- Node.js 18+
- Chrome browser

### Installation

1. Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd simple-wallet
npm install
```

2. Build the extension:
```bash
npm run build:extension
```

This creates a `dist-extension` folder with the compiled extension.

3. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked"
   - Select the `dist-extension` folder

### Development Mode

For active development with auto-rebuild:
```bash
npm run watch:extension
```

This watches for changes and rebuilds automatically. Reload the extension in Chrome after each build.

## Features

### Wallet Management
- Create new wallet with 12-word recovery phrase
- Import existing wallet from mnemonic
- Password-protected encryption
- Multi-account support (HD wallet)

### Multi-Chain Support
- **Ethereum & EVM Chains** - Mainnet, Sepolia, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC, Linea
- **Bitcoin** - Mainnet and Testnet
- **Solana** - Mainnet and Devnet
- **XRP** - XRP Ledger Mainnet and Testnet
- **TON** - TON blockchain Mainnet and Testnet

### Token Management
- Native token (ETH, MATIC, etc.) balance
- ERC-20 token support
- Add custom tokens
- Portfolio view

### Transaction Features
- Send native tokens
- Send ERC-20 tokens
- Send BTC/SOL/XRP (native)
- Transaction confirmation
- Gas estimation

### dApp Integration (EIP-1193)
The extension provides a `window.ethereum` provider for dApp compatibility:

- `eth_requestAccounts` - Connect wallet to dApp
- `eth_accounts` - Get connected accounts
- `eth_chainId` - Get current chain ID
- `eth_sendTransaction` - Send transactions (with approval UI)
- `personal_sign` - Sign messages
- `eth_sign_typed_data_v4` - Sign typed data
- More methods in development

### Security
- Auto-lock after 15 minutes of inactivity
- Password encryption for wallet data
- WebCrypto for browser-safe cryptography
- Chrome storage for persistent data

## Architecture

```
extension/
├── manifest.json              # Extension configuration
├── popup/                     # Extension popup UI
│   ├── popup.html
│   ├── popup.tsx             # React app entry
│   ├── popup.css             # Styles
│   ├── App.tsx               # Main app component
│   └── components/
│       ├── WelcomeScreen.tsx # Create/import wallet
│       ├── UnlockScreen.tsx  # Unlock wallet
│       └── MainWallet.tsx    # Main wallet interface
├── background/
│   └── service-worker.ts     # Background service worker
└── content/
    ├── injected.ts           # Content script
    └── provider.ts           # Web3 provider (page context)
```

## Message Flow

1. **dApp → Provider**: dApp calls `window.ethereum.request({ method: '...' })`
2. **Provider → Content Script**: Provider posts message to content script
3. **Content Script → Background**: Content script sends message to service worker
4. **Background → Content Script**: Service worker processes and responds
5. **Content Script → Provider**: Content script posts response back
6. **Provider → dApp**: Provider resolves promise with result

## Security Features

- **AES-256-GCM Encryption** - Military-grade encryption for wallet data
- **PBKDF2 Key Derivation** - 100,000 iterations for password hashing
- **Auto-lock** - Automatically locks after 15 minutes of inactivity
- **WebCrypto** - Browser-safe cryptography using asmcrypto.js
- **Chrome Storage** - Secure persistent storage via chrome.storage.local

## Integration with Core SDK

The extension uses the shared core SDK (`../src/`) via platform adapters:

- **ChromeStorageAdapter** - Implements `StorageAdapter` for chrome.storage.local
- **WebCryptoAdapter** - Implements `CryptoAdapter` for browser-safe crypto
- **Service Worker** - Acts as central message handler and state manager

This architecture enables ~90% code reuse with the CLI and mobile app.

## Security Best Practices

**IMPORTANT:** This is a development wallet. For production use:
- Use strong, unique passwords (12+ characters)
- Back up your recovery phrase offline
- Never share private keys or mnemonics
- Test on testnets before using mainnet
- Verify addresses before sending transactions

**For Production Deployment:**
- Implement rate limiting for failed unlock attempts
- Add phishing detection
- Consider hardware wallet integration
- Perform professional security audit
- Implement CSP (Content Security Policy)
- Add transaction simulation before signing

## License

MIT
