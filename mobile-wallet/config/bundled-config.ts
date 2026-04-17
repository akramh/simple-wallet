/**
 * @fileoverview Bundled configuration for the mobile app.
 *
 * This file imports the main config.json and tokens.json from the parent
 * directory so they're available at runtime in React Native.
 *
 * @responsibilities
 * - Provide a typed, Metro-friendly way to access shared `config.json` and `tokens.json`
 * - Establish the canonical "network key" strings used across mobile (e.g. `sepolia`, `bitcoin-mainnet`)
 *
 * @notes
 * - Network keys here must match the keys expected by `WalletBridge.switchNetwork()` and
 *   the shared SDK's provider routing.
 * - Certain features (tx history, explorer links, price lookup) depend on specific
 *   config fields (e.g. `chainId` for EVM pricing, `type` for routing).
 */

// Import main configuration (networks)
import mainConfig from '../../config.json';

// Import token lists
import tokenList from '../../tokens.json';

// Expo constants for runtime config
import Constants from 'expo-constants';

// Type definitions
export interface NetworkConfig {
  type?: 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
  name: string;
  rpcUrl?: string | string[];
  wsUrl?: string | string[];
  chainId?: number;
  nativeSymbol: string;
  nativeName?: string;
  blockExplorer?: string;
  explorerApiUrl?: string;
  explorerApiKey?: string;
  rpcApiKey?: string;
  bitcoinNetwork?: 'mainnet' | 'testnet';
  solanaCluster?: 'mainnet-beta' | 'devnet' | 'testnet';
  xrpNetwork?: 'mainnet' | 'testnet' | 'devnet';
  tonNetwork?: 'mainnet' | 'testnet';
}

export interface Config {
  network: string;
  networks: Record<string, NetworkConfig>;
}

export interface Token {
  symbol: string;
  name: string;
  type?: 'native' | 'erc20';
  address?: string;
  decimals: number;
  icon?: string;
}

export type TokenRegistry = Record<string, Token[]>;

/**
 * Get API keys from Expo Constants (loaded from .env via app.config.js)
 */
function getApiKeys() {
  const extra = Constants.expoConfig?.extra || {};
  return {
    explorerApiKey: extra.explorerApiKey as string | undefined,
    explorerApiKeySolanaMainnet: extra.explorerApiKeySolanaMainnet as string | undefined,
    explorerApiKeySolanaDevnet: extra.explorerApiKeySolanaDevnet as string | undefined,
    alchemyApiKey: extra.alchemyApiKey as string | undefined,
    heliusApiKey: extra.heliusApiKey as string | undefined,
    tonCenterApiKeyMainnet: extra.tonCenterApiKeyMainnet as string | undefined,
    tonCenterApiKeyTestnet: extra.tonCenterApiKeyTestnet as string | undefined,
  };
}

/**
 * Apply API keys from .env to network configs.
 * Mirrors the logic in src/config-utils.ts for CLI/extension.
 */
function applyApiKeysToNetworks(
  networks: Record<string, NetworkConfig>
): Record<string, NetworkConfig> {
  const keys = getApiKeys();
  const result: Record<string, NetworkConfig> = {};

  for (const [networkId, network] of Object.entries(networks)) {
    let processedNetwork = { ...network };

    // Apply explorer API key
    if (networkId === 'solana-mainnet' && keys.explorerApiKeySolanaMainnet) {
      processedNetwork.explorerApiKey = keys.explorerApiKeySolanaMainnet;
    } else if (networkId === 'solana-devnet' && keys.explorerApiKeySolanaDevnet) {
      processedNetwork.explorerApiKey = keys.explorerApiKeySolanaDevnet;
    } else if (keys.explorerApiKey) {
      processedNetwork.explorerApiKey = keys.explorerApiKey;
    }

    // Apply TON RPC API key
    if (network.type === 'ton') {
      if (networkId === 'ton-mainnet' && keys.tonCenterApiKeyMainnet) {
        processedNetwork.rpcApiKey = keys.tonCenterApiKeyMainnet;
      } else if (networkId === 'ton-testnet' && keys.tonCenterApiKeyTestnet) {
        processedNetwork.rpcApiKey = keys.tonCenterApiKeyTestnet;
      }
    }

    // Substitute ${ALCHEMY_API_KEY} and ${HELIUS_API_KEY} placeholders in RPC URLs.
    // Applies to EVM and Solana (TON uses rpcApiKey, Bitcoin has no templated URLs).
    if (processedNetwork.rpcUrl && network.type !== 'bitcoin' && network.type !== 'ton') {
      const rpcUrls = Array.isArray(processedNetwork.rpcUrl)
        ? processedNetwork.rpcUrl
        : [processedNetwork.rpcUrl];

      const processedUrls = rpcUrls
        .map((url) => {
          if (url.includes('${ALCHEMY_API_KEY}')) {
            if (!keys.alchemyApiKey) return null;
            return url.split('${ALCHEMY_API_KEY}').join(keys.alchemyApiKey);
          }
          if (url.includes('${HELIUS_API_KEY}')) {
            if (!keys.heliusApiKey) return null;
            return url.split('${HELIUS_API_KEY}').join(keys.heliusApiKey);
          }
          return url;
        })
        .filter((url): url is string => url !== null);

      if (processedUrls.length > 0) {
        processedNetwork.rpcUrl =
          processedUrls.length === 1 ? processedUrls[0] : processedUrls;
      }
    }

    result[networkId] = processedNetwork;
  }

  return result;
}

/**
 * Get the bundled network configuration.
 * API keys are injected from .env via Expo Constants.
 *
 * @returns The parsed `config.json` content with API keys applied.
 */
export function getBundledConfig(): Config {
  const config = mainConfig as Config;
  return {
    ...config,
    networks: applyApiKeysToNetworks(config.networks as Record<string, NetworkConfig>),
  };
}

/**
 * Get the bundled token list.
 *
 * @returns Token registry keyed by network (each value is a token array).
 */
export function getBundledTokens(): TokenRegistry {
  return tokenList as TokenRegistry;
}

/**
 * Get list of all available network keys.
 *
 * @returns Array of network keys in `config.json`.
 */
export function getNetworkKeys(): string[] {
  return Object.keys(mainConfig.networks);
}

/**
 * Get a specific network config.
 *
 * @param networkKey - Network identifier key (e.g. `sepolia`).
 * @returns Network configuration or undefined if unknown.
 */
export function getNetworkConfig(networkKey: string): NetworkConfig | undefined {
  return (mainConfig.networks as Record<string, NetworkConfig>)[networkKey];
}

/**
 * Get tokens for a specific network.
 *
 * @param networkKey - Network identifier key (e.g. `sepolia`).
 * @returns Token list for that network (empty if none).
 */
export function getTokensForNetwork(networkKey: string): Token[] {
  return (tokenList as TokenRegistry)[networkKey] || [];
}

/**
 * Get the CoinGecko API key from Expo config.
 *
 * @returns CoinGecko API key or undefined if not configured.
 */
export function getCoingeckoApiKey(): string | undefined {
  return Constants.expoConfig?.extra?.coingeckoApiKey;
}
