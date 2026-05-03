/**
 * @fileoverview Compatibility map between private-key wallet types and the
 * networks they can sign on. Mnemonic wallets are compatible with everything;
 * private-key wallets are limited to networks of their own chain type.
 *
 * Used by both the network-select screen and the WalletHeader's pinned-network
 * computation. Keep these two call sites in sync via this single source of truth.
 */

export type PrivateKeyType = 'evm' | 'bitcoin' | 'solana' | 'xrp' | 'ton';
export type ImportType = 'mnemonic' | 'privateKey';

/**
 * Maps `privateKeyType` to the set of network `type` values it can sign on.
 * `undefined` is included in the EVM list because legacy EVM network configs
 * predate the explicit `type` field.
 */
export const CHAIN_TYPE_COMPATIBILITY: Record<PrivateKeyType, Array<string | undefined>> = {
  evm: ['evm', undefined],
  bitcoin: ['bitcoin'],
  solana: ['solana'],
  xrp: ['xrp'],
  ton: ['ton'],
};

interface NetworkConfigLike {
  type?: string;
}

/**
 * Returns true if a network can be used by the current wallet.
 *
 * @param networkConfig - Network config (only `type` is read).
 * @param importType - 'mnemonic' or 'privateKey'. Mnemonic always returns true.
 * @param privateKeyType - The chain type of a private-key wallet. If absent,
 *                          compatibility cannot be determined and we permit the
 *                          network (callers should treat as best-effort).
 */
export function isNetworkCompatible(
  networkConfig: NetworkConfigLike | undefined,
  importType: ImportType | undefined,
  privateKeyType: PrivateKeyType | undefined,
): boolean {
  if (importType !== 'privateKey') return true;
  if (!privateKeyType) return true;

  const compatibleTypes = CHAIN_TYPE_COMPATIBILITY[privateKeyType] ?? [];
  const networkType = networkConfig?.type ?? 'evm';
  return compatibleTypes.includes(networkType);
}
