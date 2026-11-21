import { useEffect, useState } from 'react';

/** Light or dark, or follow the device's setting. */
export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_KEY = 'pretty-penny-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The remembered choice. Browser storage can be missing or blocked, so this falls back to System. */
export function storedTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Whether a choice shows dark, given whether the device prefers dark. */
export const isDark = (choice: ThemeChoice, deviceDark: boolean) =>
  choice === 'dark' || (choice === 'system' && deviceDark);

/** Applies a choice to the page. */
export function applyTheme(choice: ThemeChoice) {
  const dark = isDark(choice, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** The theme choice, remembered on this device, following the device's setting live under System. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => applyTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [choice]);

  function choose(next: ThemeChoice) {
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembered, but still applied for now.
    }
    setChoice(next);
  }

  return [choice, choose] as const;
}
