/**
 * @fileoverview Update batcher and state utilities for efficient updates.
 *
 * @description
 * Collects multiple state update requests and flushes them together to reduce re-renders.
 * Uses React Native's unstable_batchedUpdates to batch multiple Redux/Zustand dispatches
 * into a single render cycle.
 *
 * @responsibilities
 * - Collect update requests within a configurable time window
 * - Flush all pending updates together using batched updates
 * - Prevent excessive re-renders from rapid state changes
 * - Provide deep equality comparison for selectors
 */

import { unstable_batchedUpdates } from 'react-native';

/**
 * A generic batcher that collects items and flushes them together.
 *
 * @template T - The type of items being batched
 *
 * @example
 * ```ts
 * const batcher = new Batcher<string>((items) => {
 *   items.forEach(key => store.dispatch({ type: 'UPDATE', payload: key }));
 * }, 10);
 *
 * batcher.add('balances');
 * batcher.add('prices');
 * // After 10ms, handler is called with ['balances', 'prices']
 * ```
 */
export class Batcher<T> {
  private pending = new Set<T>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay: number;
  private handler: (items: T[]) => void;

  /**
   * Creates a new Batcher instance.
   *
   * @param handler - Function called with all collected items when flushing
   * @param delay - Debounce delay in milliseconds before flushing (default: 10ms)
   */
  constructor(handler: (items: T[]) => void, delay = 10) {
    this.handler = handler;
    this.delay = delay;
  }

  /**
   * Add an item to the pending batch.
   * Starts or resets the flush timer.
   *
   * @param item - Item to add to the batch
   */
  add(item: T): void {
    this.pending.add(item);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.delay);
    }
  }

  /**
   * Immediately flush all pending items.
   * Wraps the handler call in unstable_batchedUpdates for optimal rendering.
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pending.size === 0) return;

    const items = Array.from(this.pending);
    this.pending.clear();

    // Wrap in batched updates for optimal React rendering
    unstable_batchedUpdates(() => {
      this.handler(items);
    });
  }

  /**
   * Clear all pending items without flushing.
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  /**
   * Check if there are pending items.
   */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }
}

/**
 * Wraps a function call in React Native's unstable_batchedUpdates.
 * Use this to batch multiple state updates into a single render cycle.
 *
 * @param fn - Function to execute within batched context
 *
 * @example
 * ```ts
 * batchUpdates(() => {
 *   set({ balances: newBalances });
 *   set({ prices: newPrices });
 *   set({ totalValue: newTotal });
 * });
 * // Results in single re-render instead of three
 * ```
 */
export function batchUpdates(fn: () => void): void {
  unstable_batchedUpdates(fn);
}

/**
 * Performs deep equality comparison between two values.
 * Useful for selector memoization to prevent unnecessary re-renders.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if values are deeply equal
 *
 * @example
 * ```ts
 * const selector = (state) => ({ balances: state.balances, prices: state.prices });
 * useStore(selector, deepEqual);
 * ```
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}
