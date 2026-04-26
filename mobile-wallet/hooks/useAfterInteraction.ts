/**
 * @fileoverview Defer a callback until the current React Native interaction
 * (typically the navigation transition that just brought a screen into view)
 * finishes painting.
 *
 * Wraps `InteractionManager.runAfterInteractions` in a `useEffect` so screens
 * can launch their auto-refresh fan-out without blocking the transition's
 * UI-thread work. Manual user-initiated refreshes should NOT use this — those
 * should fire immediately and show their own loading indicator.
 */

import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Run `callback` after the current interaction settles, then clean up if the
 * component unmounts before the deferred work has fired.
 *
 * `deps` follows the same contract as a `useEffect` dependency array — the
 * effect re-arms when any dep changes. Passing `[]` arms once on mount.
 */
export function useAfterInteraction(
  callback: () => void | (() => void),
  deps: React.DependencyList,
): void {
  useEffect(() => {
    let cleanup: void | (() => void);
    const handle = InteractionManager.runAfterInteractions(() => {
      cleanup = callback();
    });
    return () => {
      handle.cancel();
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
