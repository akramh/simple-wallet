# Chrome Extension Setup Guide

This guide will help you set up and build the Simple Crypto Wallet Chrome extension.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Chrome browser

## Installation Steps

### 1. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- Vite (build tool)
- React & React DOM (UI framework)
- TypeScript types for Chrome APIs
- Other build tools

### 2. Generate Extension Icons

Open `scripts/generate-icons.html` in your browser and save the generated icons to `extension/assets/icons/`:
- Right-click on each canvas
- Select "Save image as..."
- Save as `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` in `extension/assets/icons/`

Alternatively, you can use any 16x16, 32x32, 48x48, and 128x128 PNG images for the extension icons.

### 3. Build the Extension

```bash
npm run build:extension
```

This will:
- Compile TypeScript to JavaScript
- Bundle React components
- Process the manifest and assets
- Output everything to `dist-extension/` folder

### 4. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Navigate to and select the `dist-extension` folder
5. The extension should now appear in your extensions list

### 5. Pin the Extension (Optional)

1. Click the puzzle piece icon in Chrome toolbar
2. Find "Simple Crypto Wallet"
3. Click the pin icon to pin it to the toolbar

## Development Workflow

### Watch Mode

For active development with automatic rebuilds:

```bash
npm run watch:extension
```

This will watch for file changes and rebuild automatically. After changes:
1. The extension will rebuild
2. Go to `chrome://extensions/`
3. Click the refresh icon on the Simple Crypto Wallet extension
4. Test your changes

### Testing the Extension

1. **Create a Wallet**:
   - Click the extension icon
   - Click "Create Wallet"
   - Enter a password (min 8 characters)
   - Save the recovery phrase (12 words)

2. **Test Balance & Portfolio**:
   - Switch to Sepolia testnet
   - Get testnet ETH from a faucet (search "Sepolia faucet")
   - Check your balance in the extension

3. **Test Sending**:
   - Go to the "Send" tab
   - Select a token
   - Enter recipient address
   - Enter amount
   - Confirm transaction

4. **Test dApp Integration**:
   - Visit a test dApp (e.g., Uniswap, Sepolia testnet)
   - Click "Connect Wallet"
   - The extension should handle the connection
   - (Note: Full dApp integration is still in development)

## Project Structure

```
extension/
├── manifest.json              # Chrome extension manifest (MV3)
├── popup/                     # Extension popup UI
│   ├── popup.html            # Entry HTML
│   ├── popup.tsx             # React entry point
│   ├── popup.css             # Styles
│   ├── App.tsx               # Main app component
│   └── components/
│       ├── WelcomeScreen.tsx # Wallet creation/import
│       ├── UnlockScreen.tsx  # Password unlock
│       └── MainWallet.tsx    # Main interface
├── background/
│   └── service-worker.ts     # Background service worker
├── content/
│   ├── injected.ts           # Content script
│   └── provider.ts           # Web3 provider
└── assets/
    └── icons/                # Extension icons

src/
├── chrome-storage.ts         # Chrome storage adapter
├── wallet.ts                 # Core wallet logic
├── app-service.ts            # Wallet orchestration
├── crypto-adapter.ts         # WebCrypto implementation
└── ... (other wallet core files)
```

## Build Configuration

The extension uses Vite for building with the following configuration:

- **Entry Points**:
  - `popup/popup.html` → Popup UI
  - `background/service-worker.ts` → Background worker
  - `content/injected.ts` → Content script
  - `content/provider.ts` → Web3 provider

- **Output**: `dist-extension/`
- **Config**: `vite.config.extension.ts`

## Troubleshooting

### Build Errors

**TypeScript errors**: Make sure all dependencies are installed:
```bash
npm install
```

**Import errors**: Ensure all `.js` extensions are included in imports (ES modules requirement)

### Extension Not Loading

1. Check `chrome://extensions/` for error messages
2. Ensure the `dist-extension` folder exists and contains:
   - `manifest.json`
   - `popup/popup.html`
   - `background/service-worker.js`
   - `content/injected.js`
   - `content/provider.js`

### Extension Loads but Doesn't Work

1. Open DevTools on the extension popup (right-click → Inspect)
2. Check for JavaScript errors in Console
3. Go to `chrome://extensions/` and click "service worker" to inspect background script
4. Check console logs

### Storage Issues

The extension uses `chrome.storage.local` for persistence. To clear:
1. Open DevTools on extension
2. Application tab → Storage → Clear site data
3. Or use: `chrome.storage.local.clear()`

### Network Issues

The extension uses public RPC endpoints which may have rate limits:
- Sepolia: `https://rpc.sepolia.org`
- Mainnet: `https://eth.llamarpc.com`
- Consider adding your own RPC endpoints in `background/service-worker.ts`

## Next Steps

After setup, you can:

1. **Customize Networks**: Edit `defaultConfig` in `background/service-worker.ts`
2. **Add Custom Tokens**: Use the token management in the popup
3. **Enhance UI**: Modify components in `extension/popup/components/`
4. **Add Features**: Implement additional JSON-RPC methods in the provider

## Security Notes

This is a development/demo wallet. Before production use:

- [ ] Implement proper phishing detection
- [ ] Add transaction simulation/validation
- [ ] Implement rate limiting for unlock attempts
- [ ] Add hardware wallet support
- [ ] Perform security audit
- [ ] Add comprehensive error handling
- [ ] Implement backup/restore functionality
- [ ] Add multi-signature support (optional)

## Contributing

To contribute to the extension:

1. Create a new branch from `chrome-extension`
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [EIP-1193: Ethereum Provider](https://eips.ethereum.org/EIPS/eip-1193)
- [ethers.js Documentation](https://docs.ethers.org/)

## License

MIT
