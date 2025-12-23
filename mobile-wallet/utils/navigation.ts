/**
 * @fileoverview Navigation helpers for safe back navigation.
 *
 * Provides a guarded back action to avoid "GO_BACK not handled" warnings
 * when a screen is opened without a back stack.
 */

type RouterLike = {
  canGoBack?: () => boolean;
  back: () => void;
  replace: (path: string) => void;
};

export function safeGoBack(router: RouterLike, fallback: string = '/(tabs)/wallet'): void {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
