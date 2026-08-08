/**
 * @fileoverview Generic EVM transaction primitives: raw calldata sends and
 * ERC-20 allowance/approve.
 *
 * Completes the per-chain module shape for `src/ethereum/` (the other chains
 * already split transaction building out of their providers). These are the
 * building blocks the swap feature needs — 1inch returns arbitrary calldata
 * and both 1inch and the Mayan Forwarder require ERC-20 approvals — and they
 * are deliberately not tied to EthereumProvider: they take an ethers Signer /
 * Provider directly so callers control which network the ad-hoc signer targets.
 *
 * Unlike EthereumProvider.sendTransaction/sendToken, nothing here blocks on
 * confirmation: sends return `{ hash, wait }` immediately after broadcast so
 * a two-step approve→swap flow doesn't serialize two full confirmations
 * unless the caller chooses to wait.
 *
 * @responsibilities
 * - Broadcast arbitrary `{to, data, value}` transactions from a signer
 * - Read ERC-20 allowances and send exact-amount approvals
 *
 * @security
 * - Calldata is caller-supplied; callers (WalletAppService) are responsible
 *   for only passing calldata from trusted swap APIs the user confirmed.
 * - Approvals are exact-amount, never unlimited — a compromised spender can
 *   take at most the amount the user just confirmed.
 * - The USDT-style approve race guard (zero-first) is handled here so no
 *   caller can forget it.
 *
 * @module ethereum/transaction
 */

import { ethers } from 'ethers';
import { ERC20_ABI } from './types.js';

/** Arbitrary EVM transaction request. */
export interface RawEvmTx {
  to: string;
  data: string;
  /** Native value to attach; defaults to 0. */
  value?: bigint;
  /** Gas limit; when omitted the signer/provider estimates. */
  gasLimit?: bigint;
}

/** A broadcast (but not necessarily mined) transaction. */
export interface SentEvmTx {
  hash: string;
  /**
   * Resolves when the tx is mined (null when the node prunes it). Callers
   * decide whether to block — broadcast itself has already happened.
   */
  wait: (confirmations?: number) => Promise<ethers.TransactionReceipt | null>;
}

const erc20Interface = new ethers.Interface(ERC20_ABI);

/**
 * Broadcast an arbitrary calldata transaction. Returns immediately after
 * broadcast — does NOT wait for inclusion.
 *
 * @param signer - Connected ethers signer (its provider selects the network)
 * @param tx - Transaction request; `value` defaults to 0
 * @returns Hash plus a `wait` handle for callers that need the receipt
 * @throws When the node rejects the transaction at broadcast
 * @async
 */
export async function sendRawEvmTransaction(
  signer: ethers.Signer,
  tx: RawEvmTx
): Promise<SentEvmTx> {
  const response = await signer.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    ...(tx.gasLimit !== undefined ? { gasLimit: tx.gasLimit } : {}),
  });
  return {
    hash: response.hash,
    wait: (confirmations?: number) => response.wait(confirmations),
  };
}

/**
 * Read an ERC-20 allowance via eth_call.
 *
 * @param provider - Provider for the token's network
 * @param tokenAddress - ERC-20 contract address
 * @param owner - Token owner
 * @param spender - Spender being queried
 * @returns Current allowance in base units
 * @async
 */
export async function getErc20Allowance(
  provider: ethers.Provider,
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const data = erc20Interface.encodeFunctionData('allowance', [owner, spender]);
  const result = await provider.call({ to: tokenAddress, data });
  const [allowance] = erc20Interface.decodeFunctionResult('allowance', result);
  return BigInt(allowance);
}

/**
 * Approve `spender` to spend exactly `amount` of an ERC-20.
 *
 * Handles the USDT-style race guard: tokens that revert on changing a
 * nonzero allowance require approve(0) first — when the current allowance is
 * nonzero (and insufficient, or the caller didn't check), a zero-approve is
 * sent and mined before the real approval. The returned tx is the final
 * approval; callers should `wait()` on it before spending the allowance.
 *
 * @param signer - Connected ethers signer (token owner)
 * @param tokenAddress - ERC-20 contract address
 * @param spender - Address being approved
 * @param amount - Exact allowance to grant, base units
 * @returns The (final) approval transaction
 * @async
 */
export async function approveErc20(
  signer: ethers.Signer,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<SentEvmTx> {
  const provider = signer.provider;
  if (provider) {
    const owner = await signer.getAddress();
    const current = await getErc20Allowance(provider, tokenAddress, owner, spender);
    if (current > 0n && current < amount) {
      const zeroTx = await sendRawEvmTransaction(signer, {
        to: tokenAddress,
        data: erc20Interface.encodeFunctionData('approve', [spender, 0n]),
      });
      // The zero-approve must be mined before the real one or the token
      // (e.g. USDT) reverts the second approve.
      await zeroTx.wait();
    }
  }
  return sendRawEvmTransaction(signer, {
    to: tokenAddress,
    data: erc20Interface.encodeFunctionData('approve', [spender, amount]),
  });
}
