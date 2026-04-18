/**
 * @fileoverview Persisted UI preferences for the unified portfolio.
 *
 * Stored under `userPreferences` in `chrome.storage.local` so settings
 * survive popup close/reopen and service-worker suspension. Reads are
 * hydrated once on mount; writes fire-and-forget.
 */
import { useCallback, useEffect, useState } from 'react';
import type { TokenSort } from '../../../src/types/unified-portfolio.js';

/** Preferences shape. Keep optional so additions don't break hydration. */
export interface UserPreferences {
  tokenSort?: TokenSort;
  hideZeroBalances?: boolean;
  privacyMode?: boolean;
}

const STORAGE_KEY = 'userPreferences';

const DEFAULTS: Required<UserPreferences> = {
  tokenSort: 'fiat',
  hideZeroBalances: true,
  privacyMode: false,
};

/**
 * Read + write the popup's persisted preferences.
 *
 * The returned `update()` merges partial patches so callers don't have to
 * pass the whole object on each change.
 */
export function useUserPreferences() {
  const [prefs, setPrefs] = useState<Required<UserPreferences>>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get(STORAGE_KEY).then(res => {
      if (cancelled) return;
      const stored = (res?.[STORAGE_KEY] ?? {}) as UserPreferences;
      setPrefs({ ...DEFAULTS, ...stored });
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<UserPreferences>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ [STORAGE_KEY]: next }).catch(() => { /* best-effort */ });
      return next;
    });
  }, []);

  return { prefs, update, loaded };
}
