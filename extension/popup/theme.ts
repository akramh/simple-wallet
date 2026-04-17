/**
 * @fileoverview Theme preference management for the extension UI.
 *
 * Supports three user preferences — `light`, `dark`, and `auto`. `auto`
 * resolves at runtime via `prefers-color-scheme` and updates live when the
 * OS appearance changes. The persisted value is always the user preference
 * (including `auto`); the resolved value (`light` | `dark`) is what's
 * applied to the DOM as `.theme-light` / `.theme-dark` classes.
 */

/** User preference persisted to storage. */
export type UiTheme = 'light' | 'dark' | 'auto';

/** Resolved theme actually applied to the DOM. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'uiTheme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function normalizeTheme(value: unknown): UiTheme {
  if (value === 'dark' || value === 'light' || value === 'auto') return value;
  return 'auto';
}

/**
 * Resolves a user preference to the concrete theme to apply.
 * `auto` consults `prefers-color-scheme`; others pass through.
 */
export function resolveTheme(pref: UiTheme): ResolvedTheme {
  if (pref === 'auto') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return pref;
}

/**
 * Applies a user preference to the document. Resolves `auto` first.
 */
export function applyTheme(pref: UiTheme): void {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.classList.toggle('theme-dark', resolved === 'dark');
  root.classList.toggle('theme-light', resolved === 'light');
  root.dataset.themePref = pref;
}

export function getStoredTheme(): Promise<UiTheme> {
  return new Promise((resolve) => {
    // Default to 'auto' so new installs follow the OS by default.
    chrome.storage.local.get({ [STORAGE_KEY]: 'auto' }, (result) => {
      resolve(normalizeTheme(result?.[STORAGE_KEY]));
    });
  });
}

export function setStoredTheme(theme: UiTheme): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: theme }, () => resolve());
  });
}

/**
 * Subscribes to OS-level color scheme changes so `auto` preference updates
 * live without requiring the popup to be re-opened. The callback fires only
 * when the resolved theme actually changes.
 *
 * @returns An unsubscribe function.
 */
export function subscribeSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(DARK_QUERY);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches ? 'dark' : 'light');
  // Safari <14 uses addListener/removeListener; modern browsers use
  // addEventListener/removeEventListener. Chrome (the extension target) supports
  // the modern API, but we guard defensively for test environments.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}
