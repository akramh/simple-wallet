# Simple Crypto Wallet - Chrome Extension

A browser extension for Ethereum and multi-chain wallet management.

## Building the Extension

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build:extension
```

This will create a `dist-extension` folder with the compiled extension.

## Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `dist-extension` folder

## Development

For active development with auto-rebuild:
```bash
npm run watch:extension
```

This will watch for changes and rebuild automatically.

## Features

### Wallet Management
- Create new wallet with 12-word recovery phrase
- Import existing wallet from mnemonic
- Password-protected encryption
- Multi-account support (HD wallet)

### Multi-Chain Support
- Ethereum Mainnet
- Sepolia Testnet
- Polygon
- Base
- Arbitrum
- Optimism
- Bitcoin (mainnet/testnet)
- Solana (mainnet/devnet)
- XRP Ledger (mainnet/testnet)
- And more...

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
- `window.ethereum` provider injection
- `eth_requestAccounts` - Connect wallet
- `eth_accounts` - Get connected accounts
- `eth_chainId` - Get current chain ID
- `eth_sendTransaction` - Send transactions (with approval UI)
- More JSON-RPC methods coming soon

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

## TODO

- [ ] Add placeholder icons (16x16, 32x32, 48x48, 128x128)
- [ ] Implement transaction approval popup
- [ ] Add signing methods (personal_sign, eth_sign, etc.)
- [ ] Implement wallet_switchEthereumChain
- [ ] Implement wallet_addEthereumChain
- [ ] Add transaction history
- [ ] Add QR code for receive address
- [ ] Add custom RPC endpoints
- [ ] Improve error handling
- [ ] Add tests for UI components

## Security Notes

This is a demo wallet extension. For production use:
- Add rate limiting for failed unlock attempts
- Implement phishing detection
- Add hardware wallet support
- Perform security audit
- Add additional layers of encryption
- Implement secure key derivation

## License

MIT
