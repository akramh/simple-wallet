/**
 * @fileoverview Debounce a rapidly-changing value (text input, slider, etc.)
 * so downstream effects fire at most once per `delayMs`.
 */

import { useEffect, useState } from 'react';

/**
 * Returns a copy of `value` that only updates after `delayMs` of quiet.
 *
 * Typical use: gate a network/RPC effect on the debounced output rather than
 * the raw input so a fast typist doesn't trigger a request per keystroke.
 *
 * ```ts
 * const [amount, setAmount] = useState('');
 * const debouncedAmount = useDebouncedValue(amount, 250);
 * useEffect(() => { estimateGas(debouncedAmount); }, [debouncedAmount]);
 * ```
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
