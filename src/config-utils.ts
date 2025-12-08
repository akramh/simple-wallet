import type { Config, NetworkConfig } from './types/index.js';

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

function getDefaultEnv(): EnvRecord {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as EnvRecord;
  }
  return {};
}

function withExplorerKey(network: NetworkConfig, apiKey?: string): NetworkConfig {
  if (!apiKey) {
    return network;
  }
  return { ...network, explorerApiKey: apiKey };
}

export function applyExplorerApiKeys(
  config: Config & { network: string },
  env: EnvRecord = getDefaultEnv()
): { config: Config & { network: string }; globalApiKey?: string } {
  const globalApiKey = getEnvValue(env, 'EXPLORER_API_KEY');

  const networks = Object.fromEntries(
    Object.entries(config.networks).map(([networkId, network]) => {
      const envKey = getEnvValue(env, `EXPLORER_API_KEY_${networkId.toUpperCase()}`);
      const apiKey = envKey ?? globalApiKey;
      return [networkId, withExplorerKey(network, apiKey)];
    })
  );

  return { config: { ...config, networks }, globalApiKey };
}
