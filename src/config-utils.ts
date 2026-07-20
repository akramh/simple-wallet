/**
 * @fileoverview Environment-driven API key injection into the network config.
 *
 * `config.json` ships with `${ALCHEMY_API_KEY}` (and legacy `${HELIUS_API_KEY}`)
 * placeholders inside EVM/Solana `rpcUrl` entries instead of real keys. This
 * module is the canonical substitution step shared by the CLI and the
 * extension build: it resolves each placeholder from the environment and
 * attaches per-network explorer (Etherscan) and TON keys.
 *
 * @responsibilities
 * - Substitute RPC URL placeholders from env, checking both `KEY` and
 *   `VITE_KEY` names so one code path serves Node and Vite builds
 * - Drop any URL whose required key is missing rather than sending a request
 *   with an empty key (the remaining array entries keep failover working);
 *   if *no* URL survives, return the original config so callers fail loudly
 * - Attach `explorerApiKey` per network (`EXPLORER_API_KEY_<NETWORK>`, network
 *   IDs normalized to `[A-Z0-9_]`, falling back to the global
 *   `EXPLORER_API_KEY`) and `rpcApiKey` for TON (`TONCENTER_API_KEY_*`)
 *
 * @security Keys flow strictly env → in-memory config. Any key present in the
 * incoming config object is stripped before substitution so nothing can be
 * persisted back into `config.json` (see the guard in `src/app-service.ts`).
 * One Alchemy key serves every chain — the URL hostname selects the chain;
 * see docs/alchemy.md.
 */

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

function substitutePlaceholder(
  urls: string[],
  placeholder: string,
  value: string | undefined,
): string[] {
  return urls
    .map((url) => {
      if (!url.includes(placeholder)) return url;
      if (!value) return null; // drop URLs whose required key isn't available
      return url.split(placeholder).join(value);
    })
    .filter((url): url is string => url !== null);
}

function applyRpcApiKeys(network: NetworkConfig, env: EnvRecord): NetworkConfig {
  // Replace ${ALCHEMY_API_KEY} and legacy ${HELIUS_API_KEY} placeholders in RPC URLs
  // with values from env. Applies to EVM/Solana; TON uses rpcApiKey, not URL templating.
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

  const networkWithRpc = network as { rpcUrl: string | string[] };
  if (!networkWithRpc.rpcUrl) return network;

  const alchemyKey = getEnvValue(env, 'ALCHEMY_API_KEY');
  const heliusKey = getEnvValue(env, 'HELIUS_API_KEY');

  const rpcUrls = Array.isArray(networkWithRpc.rpcUrl) ? networkWithRpc.rpcUrl : [networkWithRpc.rpcUrl];
  let processedUrls = substitutePlaceholder(rpcUrls, '${ALCHEMY_API_KEY}', alchemyKey);
  processedUrls = substitutePlaceholder(processedUrls, '${HELIUS_API_KEY}', heliusKey);

  if (processedUrls.length === 0) {
    // All URLs required a missing key; surface original config so callers fail loudly.
    return network;
  }

  return {
    ...network,
    rpcUrl: processedUrls.length === 1 ? processedUrls[0] : processedUrls,
  } as NetworkConfig;
}

/**
 * Injects all env-sourced API keys into a loaded config: explorer keys,
 * RPC URL placeholders (`${ALCHEMY_API_KEY}` / `${HELIUS_API_KEY}`), and TON
 * `rpcApiKey`. Pure — returns a new config object; the input is not mutated.
 *
 * @param config - Parsed config with a selected `network`
 * @param env - Env lookup source; defaults to `process.env` when available
 *   (browser builds pass `import.meta.env` explicitly)
 * @returns The key-substituted config plus the global `EXPLORER_API_KEY`
 *   value (if set) for callers that register explorers separately
 */
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
