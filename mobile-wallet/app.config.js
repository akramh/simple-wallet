const path = require('path');
// Try to load dotenv from root
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

module.exports = ({ config }) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      // Price provider API key
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
      // Explorer API keys
      explorerApiKey: process.env.EXPLORER_API_KEY,
      explorerApiKeySolanaMainnet: process.env.EXPLORER_API_KEY_SOLANA_MAINNET,
      explorerApiKeySolanaDevnet: process.env.EXPLORER_API_KEY_SOLANA_DEVNET,
      // RPC API keys
      alchemyApiKey: process.env.ALCHEMY_API_KEY || process.env.EXPO_PUBLIC_ALCHEMY_API_KEY,
      heliusApiKey: process.env.HELIUS_API_KEY,
      tonCenterApiKeyMainnet: process.env.TONCENTER_API_KEY_TON_MAINNET,
      tonCenterApiKeyTestnet: process.env.TONCENTER_API_KEY_TON_TESTNET,
    },
  };
};
