export type UiTheme = 'light' | 'dark';

const STORAGE_KEY = 'uiTheme';

function normalizeTheme(value: unknown): UiTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: UiTheme) {
  const root = document.documentElement;
  root.classList.toggle('theme-dark', theme === 'dark');
  root.classList.toggle('theme-light', theme === 'light');
}

export function getStoredTheme(): Promise<UiTheme> {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [STORAGE_KEY]: 'light' }, (result) => {
      resolve(normalizeTheme(result?.[STORAGE_KEY]));
    });
  });
}

export function setStoredTheme(theme: UiTheme): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: theme }, () => resolve());
  });
}

