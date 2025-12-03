# Simple Crypto Wallet

A command-line Ethereum wallet supporting testnet and mainnet operations.

## Features

- 🆕 Create new wallet with 12-word mnemonic phrase
- 📥 Import existing wallet from mnemonic
- 💰 Check wallet balance
- 📤 Send ETH transactions
- 📥 Display receive address
- ⚙️ Switch between Sepolia testnet and Ethereum mainnet

## Installation

```bash
npm install
```

## Usage

Start the wallet:

```bash
npm start
```

## Configuration

Edit `config.json` to change the default network or add custom RPC endpoints:

```json
{
  "network": "sepolia",
  "networks": {
    "sepolia": {
      "name": "Sepolia Testnet",
      "rpcUrl": "https://rpc.sepolia.org",
      "chainId": 11155111
    },
    "mainnet": {
      "name": "Ethereum Mainnet",
      "rpcUrl": "https://eth.llamarpc.com",
      "chainId": 1
    }
  }
}
```

## Security Notes

⚠️ **IMPORTANT SECURITY WARNINGS:**

1. **Never share your mnemonic phrase** - Anyone with your mnemonic can access your funds
2. **Back up your mnemonic** - Store it securely offline
3. **Keep wallet.json secure** - This file contains sensitive data
4. **Use testnet first** - Test all operations on Sepolia before using mainnet
5. **This is a demo wallet** - For production use, consider hardware wallets or established solutions

## Getting Testnet ETH

To test the wallet on Sepolia testnet:
- Visit a Sepolia faucet (search "Sepolia faucet")
- Enter your wallet address
- Receive free test ETH

## Switching Networks

Use the "Change Network" option in the menu to switch between Sepolia testnet and Ethereum mainnet. The application will restart after changing networks.

## File Structure

- `index.js` - Main CLI interface
- `wallet.js` - Wallet logic and Ethereum interactions
- `config.json` - Network configuration
- `wallet.json` - Encrypted wallet storage (auto-generated)
- `.gitignore` - Protects sensitive files from git

## License

MIT
