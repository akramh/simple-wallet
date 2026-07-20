/**
 * @fileoverview Alchemy Transfers API client for EVM transaction history.
 *
 * Replaces Etherscan V2 for the chains Alchemy supports (Ethereum, Base,
 * Polygon, Arbitrum, Optimism, and their testnets). For Avalanche, BSC, and
 * Linea the code path falls back to the existing Etherscan V2 client since
 * `alchemy_getAssetTransfers` is not available on those chains.
 *
 * @responsibilities
 * - Call `alchemy_getAssetTransfers` over JSON-RPC for sent and received sides
 * - Merge, de-dupe, and sort results into {@link NormalizedTransaction}
 * - Apply per-chain `category` arrays (`internal` is only valid on
 *   eth-mainnet and polygon-mainnet)
 *
 * @security No credentials in logs; the Alchemy URL (which contains the key)
 * comes from config and is passed opaquely to fetch().
 */

import type { NormalizedTransaction } from '../explorer-api.js';

/** Config network keys whose RPC array routes to Alchemy for transfers. */
export const ALCHEMY_TRANSFERS_NETWORKS: ReadonlySet<string> = new Set([
  'mainnet',
  'sepolia',
  'base',
  'polygon',
  'arbitrum',
  'optimism',
]);

/**
 * Config network keys where `category: "internal"` is supported. Per the
 * Alchemy Transfers docs
 * (https://docs.alchemy.com/reference/alchemy-getassettransfers), internal
 * transfers are only available on Ethereum Mainnet and Polygon Mainnet.
 * See also docs/alchemy.md (endpoint reference).
 */
const INTERNAL_CATEGORY_NETWORKS: ReadonlySet<string> = new Set(['mainnet', 'polygon']);

/**
 * Pulls the first `*.g.alchemy.com` URL out of a single-value or array-valued
 * `rpcUrl` config field. Returns `undefined` if none present (e.g., avalanche,
 * bsc, linea, or any setup without an Alchemy key).
 */
export function extractAlchemyUrl(rpcUrl: string | string[] | undefined): string | undefined {
  if (!rpcUrl) return undefined;
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  return urls.find((u) => /\.g\.alchemy\.com\//.test(u));
}

/**
 * Returns true when a network should use the Alchemy transfers path. Requires
 * both the network be in the allowlist AND an Alchemy URL be resolvable.
 */
export function shouldUseAlchemyTransfers(
  network: string,
  rpcUrl: string | string[] | undefined,
): boolean {
  return ALCHEMY_TRANSFERS_NETWORKS.has(network) && !!extractAlchemyUrl(rpcUrl);
}

interface AlchemyTransfer {
  blockNum: string;
  uniqueId: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract: { value: string | null; address: string | null; decimal: string | null };
  metadata?: { blockTimestamp?: string };
}

interface AlchemyTransfersResult {
  transfers: AlchemyTransfer[];
  pageKey?: string;
}

/** Client for `alchemy_getAssetTransfers`. One instance per (network, rpcUrl). */
export class AlchemyTransfersClient {
  private cache = new Map<string, { data: NormalizedTransaction[]; timestamp: number }>();
  private readonly cacheDurationMs = 30_000;

  constructor(private readonly rpcUrl: string, private readonly network: string) {}

  /**
   * Fetches native + ERC-20 (+ internal, on eth/polygon) transfers for an
   * address. Matches the ExplorerAPI.getAllTransactions signature so callers
   * can be swapped transparently.
   *
   * @param address - 0x-prefixed address
   * @param network - network key (ignored; already bound in constructor, but
   *   kept for signature parity with ExplorerAPI)
   * @param _page - ignored; Alchemy pages via opaque `pageKey` cursors, not
   *   page numbers. First page only for now.
   * @param pageSize - max results per direction (caps at 1000)
   */
  async getAllTransactions(
    address: string,
    network: string,
    _page = 1,
    pageSize = 25,
  ): Promise<NormalizedTransaction[]> {
    const cacheKey = `${network}:${address.toLowerCase()}:${pageSize}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheDurationMs) {
      return cached.data;
    }

    const category = INTERNAL_CATEGORY_NETWORKS.has(this.network)
      ? ['external', 'internal', 'erc20']
      : ['external', 'erc20'];
    const maxCount = '0x' + Math.min(Math.max(pageSize, 1), 1000).toString(16);

    const commonParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category,
      withMetadata: true,
      excludeZeroValue: true,
      order: 'desc',
      maxCount,
    };

    try {
      const [sent, received] = await Promise.all([
        this.call<AlchemyTransfersResult>('alchemy_getAssetTransfers', [
          { ...commonParams, fromAddress: address },
        ]),
        this.call<AlchemyTransfersResult>('alchemy_getAssetTransfers', [
          { ...commonParams, toAddress: address },
        ]),
      ]);

      const merged = [...(sent?.transfers ?? []), ...(received?.transfers ?? [])];
      const normalized = this.normalize(merged, address, network);

      // De-dupe by hash (a tx can surface in both directions for contract calls)
      // and sort newest-first.
      const seen = new Set<string>();
      const deduped = normalized
        .filter((tx) => {
          if (seen.has(tx.hash)) return false;
          seen.add(tx.hash);
          return true;
        })
        .sort((a, b) => b.timestamp - a.timestamp);

      this.cache.set(cacheKey, { data: deduped, timestamp: Date.now() });
      return deduped;
    } catch (error) {
      console.error(`[alchemy-transfers] fetch failed for ${network}:`, error);
      return [];
    }
  }

  /** Clears in-memory cache; called on wallet/network switch. */
  clearCache(): void {
    this.cache.clear();
  }

  private async call<T>(method: string, params: unknown[]): Promise<T | null> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    if (response.status === 429) {
      console.warn('[alchemy-transfers] rate limited (429)');
      return null;
    }
    if (!response.ok) {
      console.warn(`[alchemy-transfers] HTTP ${response.status} from ${method}`);
      return null;
    }

    const data = (await response.json()) as { result?: T; error?: { message: string } };
    if (data.error) {
      console.warn(`[alchemy-transfers] ${method} error:`, data.error.message);
      return null;
    }
    return data.result ?? null;
  }

  private normalize(
    transfers: AlchemyTransfer[],
    address: string,
    network: string,
  ): NormalizedTransaction[] {
    const lower = address.toLowerCase();
    return transfers.map((t) => {
      const isSend = t.from.toLowerCase() === lower;
      const isErc20 = t.category === 'erc20' || t.category === 'erc721' || t.category === 'erc1155';
      const type: NormalizedTransaction['type'] = isErc20
        ? isSend
          ? 'send'
          : 'receive'
        : isSend
          ? 'send'
          : 'receive';

      // rawContract.value is hex wei; convert to decimal string for parity
      // with Etherscan's normalization.
      let value = '0';
      if (t.rawContract?.value) {
        try {
          value = BigInt(t.rawContract.value).toString();
        } catch {
          value = '0';
        }
      }

      const tokenDecimals = t.rawContract?.decimal
        ? Number.parseInt(t.rawContract.decimal, 16)
        : undefined;

      return {
        hash: t.hash,
        from: t.from,
        to: t.to ?? '',
        value,
        timestamp: t.metadata?.blockTimestamp ? Date.parse(t.metadata.blockTimestamp) : 0,
        blockNumber: Number.parseInt(t.blockNum, 16),
        gasUsed: '0',
        gasPrice: '0',
        status: 'confirmed',
        type,
        network,
        ...(isErc20 && t.asset ? { tokenSymbol: t.asset } : {}),
        ...(isErc20 && t.rawContract?.address ? { tokenAddress: t.rawContract.address } : {}),
        ...(isErc20 && Number.isFinite(tokenDecimals) ? { tokenDecimals } : {}),
      };
    });
  }
}
