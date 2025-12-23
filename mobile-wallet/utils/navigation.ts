/**
 * @fileoverview Navigation helpers for safe back navigation.
 *
 * Provides a guarded back action to avoid "GO_BACK not handled" warnings
 * when a screen is opened without a back stack.
 */

import type { Router } from 'expo-router';

type RouterLike = Pick<Router, 'back' | 'replace' | 'canGoBack'>;
type RouterReplaceArg = Parameters<Router['replace']>[0];

const DEFAULT_FALLBACK: RouterReplaceArg = '/(tabs)/wallet';

export function safeGoBack(router: RouterLike, fallback: RouterReplaceArg = DEFAULT_FALLBACK): void {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
