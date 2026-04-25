/**
 * @fileoverview Lightweight boot/perf instrumentation for the mobile wallet.
 *
 * Captures monotonic timestamps for boot milestones and emits a single
 * `[perf]` log line per mark in __DEV__ builds. No-op in production so the
 * module has zero runtime cost on a release build aside from the captured
 * `bootStartedAt` constant.
 *
 * Usage:
 *   import { perfMark, perfSummary, bootStartedAt } from '../utils/perf';
 *   perfMark('rootLayout:mount');
 *   // later
 *   perfMark('firstScreen:mount');
 *   perfSummary();
 *
 * Phase 0 of the RN tuning plan uses this to lock in baseline numbers.
 * Later phases reuse the same API to prove deltas (cold start, unlock,
 * portfolio refresh, etc.).
 */

declare const __DEV__: boolean;

const now = (): number => {
  if (typeof globalThis.performance?.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
};

/**
 * Captured at module-evaluation time. The first thing imported in
 * `index.js` should be this module so this constant approximates the JS
 * VM start. Anything earlier (native init, splash) can be measured from
 * the OS side via Xcode Instruments / Android Studio Profiler.
 */
export const bootStartedAt: number = now();

interface PerfEntry {
  label: string;
  at: number;
  deltaSinceBoot: number;
  deltaSincePrev: number;
}

const entries: PerfEntry[] = [];
const seen = new Set<string>();

/**
 * Record a named milestone. Only the first occurrence of a given label is
 * recorded — subsequent calls are no-ops, so callers can safely place
 * `perfMark()` inside React `useEffect` hooks without worrying about
 * re-render duplicates.
 */
export function perfMark(label: string): void {
  if (seen.has(label)) return;
  seen.add(label);

  const at = now();
  const deltaSinceBoot = at - bootStartedAt;
  const prev = entries[entries.length - 1];
  const deltaSincePrev = prev ? at - prev.at : deltaSinceBoot;

  entries.push({ label, at, deltaSinceBoot, deltaSincePrev });

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(
      `[perf] ${label}  +${deltaSinceBoot.toFixed(1)}ms (Δ${deltaSincePrev.toFixed(1)}ms)`,
    );
  }
}

/**
 * Return a snapshot of all recorded marks. Useful for tests or for
 * surfacing the data in a debug panel.
 */
export function perfEntries(): readonly PerfEntry[] {
  return entries;
}

/**
 * Print a compact table of all marks since boot. Call this once after the
 * first interactive screen has mounted to get a single readable summary.
 */
export function perfSummary(): void {
  if (!__DEV__ || entries.length === 0) return;
  // eslint-disable-next-line no-console
  console.log('[perf] --- summary (ms since boot) ---');
  for (const e of entries) {
    // eslint-disable-next-line no-console
    console.log(`[perf]   ${e.deltaSinceBoot.toFixed(1).padStart(8)}  ${e.label}`);
  }
}
