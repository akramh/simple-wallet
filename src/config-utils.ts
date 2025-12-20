import type { Config, NetworkConfig } from './types/index.js';
import type { TonNetworkConfig } from './types/config.js';

type EnvRecord = Record<string, string | undefined>;

function getEnvValue(env: EnvRecord, key: string): string | undefined {
  const candidates = [key, `VITE_${key}`];
  for (const candidate of candidates) {
    const value = env[candidate];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function envNetworkSuffix(networkId: string): string {
  // Vite and most shells only support env var names using [A-Z0-9_].
  // Convert config network IDs like "solana-mainnet" to "SOLANA_MAINNET".
  return networkId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function getDefaultEnv(): EnvRecord {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as EnvRecord;
  }
  return {};
}

function withExplorerKey(network: NetworkConfig, apiKey?: string): NetworkConfig {
  const { explorerApiKey: _existing, ...rest } = network as any;
  if (!apiKey) {
    // Never keep explorer keys in config.json; keys must come from env.
    return rest as NetworkConfig;
  }
  return { ...(rest as NetworkConfig), explorerApiKey: apiKey };
}

function applyRpcApiKeys(network: NetworkConfig, env: EnvRecord): NetworkConfig {
  // Replace ${HELIUS_API_KEY} placeholder in RPC URLs with actual key from env
  // Applies to EVM/Solana; TON uses rpcApiKey and does not rely on URL templating.
  if (network.type === 'bitcoin') return network;

  if (network.type === 'ton') {
    const networkSuffix = network.tonNetwork === 'mainnet' ? 'TON_MAINNET' : 'TON_TESTNET';
    const apiKey = getEnvValue(env, `TONCENTER_API_KEY_${networkSuffix}`) ?? getEnvValue(env, 'TONCENTER_API_KEY');
    const { rpcApiKey: _existing, ...rest } = network as any;
    if (!apiKey) {
      return rest as TonNetworkConfig;
    }
    return { ...(rest as TonNetworkConfig), rpcApiKey: apiKey };
  }
  
  const heliusKey = getEnvValue(env, 'HELIUS_API_KEY');
  const networkWithRpc = network as { rpcUrl: string | string[] };
  
  if (!networkWithRpc.rpcUrl) return network;
  
  const rpcUrls = Array.isArray(networkWithRpc.rpcUrl) ? networkWithRpc.rpcUrl : [networkWithRpc.rpcUrl];
  const processedUrls = rpcUrls
    .map((url: string) => {
      if (url.includes('${HELIUS_API_KEY}')) {
        if (!heliusKey) {
          // No Helius key available, skip this URL
          return null;
        }
        return url.replace('${HELIUS_API_KEY}', heliusKey);
      }
      return url;
    })
    .filter((url): url is string => url !== null);
  
  if (processedUrls.length === 0) {
    // Fallback if all URLs were filtered out
    return network;
  }
  
  return {
    ...network,
    rpcUrl: processedUrls.length === 1 ? processedUrls[0] : processedUrls
  } as NetworkConfig;
}

export function applyExplorerApiKeys(
  config: Config & { network: string },
  env: EnvRecord = getDefaultEnv()
): { config: Config & { network: string }; globalApiKey?: string } {
  const globalApiKey = getEnvValue(env, 'EXPLORER_API_KEY');

  const networks = Object.fromEntries(
    Object.entries(config.networks).map(([networkId, network]) => {
      // Prefer normalized env var names for compatibility (e.g. SOLANA_MAINNET),
      // but keep a fallback to the legacy raw uppercase network ID.
      const normalizedKey = `EXPLORER_API_KEY_${envNetworkSuffix(networkId)}`;
      const legacyKey = `EXPLORER_API_KEY_${networkId.toUpperCase()}`;

      const envKey = getEnvValue(env, normalizedKey) ?? getEnvValue(env, legacyKey);
      const apiKey = envKey ?? globalApiKey;
      
      // Apply both explorer key and RPC API keys
      let processedNetwork = withExplorerKey(network, apiKey);
      processedNetwork = applyRpcApiKeys(processedNetwork, env);
      
      return [networkId, processedNetwork];
    })
  );

  return { config: { ...config, networks }, globalApiKey };
}
