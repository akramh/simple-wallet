/**
 * @fileoverview Chain-neutral swap types shared by all UI surfaces.
 *
 * These types are the swap vocabulary the CLI, extension, and mobile app
 * consume. They deliberately contain no provider-specific concepts beyond the
 * `provider` discriminator: routing (same-chain 1inch vs cross-chain Mayan)
 * is decided inside WalletAppService, and each provider's opaque quote
 * payload rides along in `SwapQuoteView.raw` untouched by UIs. Every field a
 * UI renders is a pre-formatted string, so adding a swap provider or chain
 * must not require changes to this file's consumers — only a new dispatch
 * branch in WalletAppService.
 *
 * All views must survive a structured-clone / JSON round-trip: the extension
 * passes them through chrome.runtime messages and mobile passes them through
 * route params.
 *
 * @module types/swap
 */

import type { Token } from './token.js';

/** Which service fulfils a swap. */
export type SwapProviderId = 'oneinch' | 'mayan';

/**
 * What swapping looks like from a given source network — UIs render buttons,
 * pickers, and copy from this instead of hardcoding chain semantics.
 */
export interface SwapCapabilities {
  /** True when this network can be the source of at least one swap kind. */
  canSwap: boolean;
  /** Same-network token swaps available (1inch; requires ONEINCH_API_KEY). */
  sameChain: boolean;
  /** Cross-chain swaps available (Mayan). */
  crossChain: boolean;
  /**
   * Network keys valid as a destination from this source, including the
   * source itself when `sameChain` is true. Empty when `canSwap` is false.
   */
  destinationNetworkKeys: string[];
  /** One-line reason when a capability is gated off (UI copy). */
  unsupportedReason?: string;
}

/**
 * A quote request. Amounts are human-unit decimal strings ("1.5"); base-unit
 * conversion happens inside the service using `fromToken.decimals`.
 */
export interface SwapQuoteRequest {
  /** Source network key (e.g. 'mainnet', 'solana-mainnet'). */
  fromNetworkKey: string;
  /** Source token; native tokens use the repo convention address ''. */
  fromToken: Token;
  /** Destination network key; equal to fromNetworkKey for same-chain swaps. */
  toNetworkKey: string;
  /** Destination token; native tokens use address ''. */
  toToken: Token;
  /** Amount of fromToken to swap, in human units. */
  amount: string;
  /** Max acceptable price slippage in percent. Default 1. */
  slippagePercent?: number;
}

/**
 * A priced quote as rendered by the UIs. Formatted strings are display-only;
 * consumers must not do unit math on them.
 */
export interface SwapQuoteView {
  provider: SwapProviderId;
  fromNetworkKey: string;
  toNetworkKey: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  /** Input amount, human units (echo of the request, normalized). */
  amountInFormatted: string;
  /** Expected output amount, human units. */
  amountOutFormatted: string;
  /** Guaranteed minimum output after slippage, human units. */
  minAmountOutFormatted: string;
  /** Display rate line, e.g. "1 ETH ≈ 3,412.55 USDC". */
  rateFormatted: string;
  /** Estimated source-chain network fee, formatted with native symbol. */
  feeFormatted: string;
  /** Mayan relayer/bridge fee line when present; undefined for 1inch. */
  bridgeFeeFormatted?: string;
  /** Estimated completion time in seconds (Mayan cross-chain only). */
  etaSeconds?: number;
  /** True when an ERC-20 approval tx must precede the swap tx. */
  needsApproval: boolean;
  /** Spender the approval targets (1inch router / Mayan Forwarder). */
  approvalSpender?: string;
  /**
   * Epoch ms after which executeSwap refuses this quote and the UI must
   * re-quote. Prices move; stale quotes must never be executed.
   */
  expiresAt: number;
  /**
   * Opaque provider payload passed back verbatim to executeSwap.
   * oneinch: the quoted amounts (calldata is fetched fresh at execute time).
   * mayan: the JSON quote object from fetchQuote.
   * Must be JSON-serializable.
   */
  raw: unknown;
  /** Echo of the request — executeSwap re-resolves tokens/signers from it. */
  request: SwapQuoteRequest;
}

/**
 * Progress phases surfaced during executeSwap, in order. The approval phases
 * only occur when `SwapQuoteView.needsApproval` was true.
 */
export type SwapPhase =
  | 'checking-allowance'
  | 'approving'
  | 'approval-confirmed'
  | 'submitting-swap'
  | 'swap-submitted';

/** Result of a submitted swap. The swap may still be in flight on-chain. */
export interface SwapExecuteResult {
  provider: SwapProviderId;
  /** Source-chain transaction hash (EVM) or signature (Solana). */
  txId: string;
  /** Approval transaction hash when an approval was sent first. */
  approvalTxId?: string;
  fromNetworkKey: string;
  toNetworkKey: string;
}

/**
 * Terminal-or-not state of a swap.
 * - `pending`   — source tx unmined, or bridge still relaying (Mayan).
 * - `completed` — destination funds delivered (Mayan) / swap tx mined (1inch).
 * - `refunded`  — Mayan could not complete and returned funds on the source chain.
 * - `failed`    — source-chain tx reverted (1inch) or the provider reported failure.
 */
export type SwapStatusState = 'pending' | 'completed' | 'refunded' | 'failed';

/** Point-in-time swap status. Polling loops live in the UI surfaces. */
export interface SwapStatusView {
  state: SwapStatusState;
  /** Destination-chain tx id once known (Mayan completed swaps). */
  destTxId?: string;
  /** Optional human-readable detail line. */
  detail?: string;
}
