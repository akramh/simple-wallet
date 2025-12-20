/**
 * @fileoverview TON transaction building helpers.
 *
 * @responsibilities
 * - Build internal TON transfer messages
 * - Validate TON transfer amounts and comments
 *
 * @security
 * - Ensures amounts are validated and converted to nanoTON
 * - Avoids leaking secret keys (no signing here)
 *
 * @module ton/transaction
 */

import { Address, internal } from '@ton/core';
import { parseTonAddress } from './address.js';
import { tonToNano } from './types.js';

/**
 * Parameters for building a TON transfer message.
 */
export interface TonTransferParams {
  /** Recipient TON address (friendly or raw). */
  toAddress: string;
  /** Amount in TON (decimal string). */
  amountTon: string;
  /** Optional comment payload (plain text). */
  comment?: string;
  /** Whether to bounce if recipient is uninitialized. */
  bounce?: boolean;
}

/**
 * Build a TON internal message for a transfer.
 *
 * Creates an internal message suitable for use with WalletContractV4.sendTransfer().
 * Handles bounce flag derivation from friendly address format when not explicitly specified.
 *
 * @param params - Transfer parameters including recipient, amount, and optional comment
 * @param params.toAddress - Recipient TON address (friendly or raw format)
 * @param params.amountTon - Amount to send in TON (decimal string, e.g., "1.5")
 * @param params.comment - Optional text comment to attach to the transaction
 * @param params.bounce - Whether to bounce if recipient is uninitialized; derived from address if omitted
 * @returns Internal message object for wallet transfer
 * @throws {Error} If the amount is invalid or less than or equal to 0
 * @throws {Error} If the recipient address cannot be parsed
 *
 * @example
 * const message = buildTonTransferMessage({
 *   toAddress: "UQBExample...",
 *   amountTon: "1.5",
 *   comment: "Payment for services"
 * });
 */
export function buildTonTransferMessage(params: TonTransferParams): ReturnType<typeof internal> {
  const { toAddress, amountTon, comment, bounce } = params;
  const to = parseTonAddress(toAddress);
  const value = tonToNano(amountTon);

  if (value <= 0n) {
    throw new Error('Amount must be greater than 0');
  }

  let bounceFlag = bounce;
  if (typeof bounceFlag === 'undefined' && Address.isFriendly(toAddress)) {
    try {
      bounceFlag = Address.parseFriendly(toAddress).isBounceable;
    } catch {
      bounceFlag = undefined;
    }
  }
  if (typeof bounceFlag === 'undefined') {
    bounceFlag = true;
  }

  return internal({
    to,
    value,
    bounce: bounceFlag,
    body: comment && comment.trim().length > 0 ? comment : undefined,
  });
}
