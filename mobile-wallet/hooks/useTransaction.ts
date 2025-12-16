/**
 * @fileoverview Hook for transaction operations.
 *
 * @responsibilities
 * - Provide UI state for gas estimation + sending flows
 * - Delegate all wallet operations to `useWalletStore` / `WalletBridge`
 * - Normalize error handling for screens (returns null on failure)
 *
 * @notes
 * - This hook does not sign transactions directly; signing happens in the shared SDK.
 */

import { useState, useCallback } from 'react';
import { useWalletStore } from '../store';
import type { Token, GasEstimate } from '../services';

interface SendState {
  isEstimating: boolean;
  isSending: boolean;
  gasEstimate: GasEstimate | null;
  error: string | null;
}

/**
 * Hook for sending transactions.
 *
 * @returns Send state + helpers for estimation and sending.
 */
export function useTransaction() {
  const { getGasEstimate, sendTransaction, refreshBalances } = useWalletStore();

  const [state, setState] = useState<SendState>({
    isEstimating: false,
    isSending: false,
    gasEstimate: null,
    error: null,
  });

  /**
   * Estimate gas/network fee for a proposed send.
   *
   * @param token - Token being sent.
   * @param to - Recipient address.
   * @param amount - Amount in display units.
   * @returns Gas estimate or null if inputs invalid or estimation failed.
   */
  const estimateGas = useCallback(
    async (token: Token, to: string, amount: string) => {
      if (!to || !amount || parseFloat(amount) <= 0) {
        setState((prev) => ({ ...prev, gasEstimate: null }));
        return null;
      }

      try {
        setState((prev) => ({ ...prev, isEstimating: true, error: null }));
        const estimate = await getGasEstimate(token, to, amount);
        setState((prev) => ({ ...prev, isEstimating: false, gasEstimate: estimate }));
        return estimate;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to estimate gas';
        setState((prev) => ({
          ...prev,
          isEstimating: false,
          error: message,
          gasEstimate: null,
        }));
        return null;
      }
    },
    [getGasEstimate]
  );

  const send = useCallback(
    async (
      token: Token,
      to: string,
      amount: string,
      destinationTag?: number
    ): Promise<{ hash: string } | null> => {
      try {
        setState((prev) => ({ ...prev, isSending: true, error: null }));
        const result = await sendTransaction(token, to, amount, destinationTag);
        setState((prev) => ({ ...prev, isSending: false }));

        /**
         * Refresh balances after transaction.
         * The store also schedules follow-up refreshes; this provides a quick UX update.
         */
        setTimeout(() => refreshBalances(), 2000);

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Transaction failed';
        setState((prev) => ({ ...prev, isSending: false, error: message }));
        return null;
      }
    },
    [sendTransaction, refreshBalances]
  );

  /** Clear the current error (if any). */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /** Reset the send state to its initial values. */
  const reset = useCallback(() => {
    setState({
      isEstimating: false,
      isSending: false,
      gasEstimate: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    estimateGas,
    send,
    clearError,
    reset,
  };
}
