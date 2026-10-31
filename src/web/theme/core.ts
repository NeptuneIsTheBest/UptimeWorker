export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemePreference, 'system'>;

export const THEME_STORAGE_KEY = 'uptimeworker.theme';
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';
export const THEME_COLORS = { light: '#f6f7f9', dark: '#111318' } as const;

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(saved)) return saved;
  } catch {
    /* Storage may be disabled; use the system preference. */
  }
  return 'system';
}

export function systemThemeQuery(): MediaQueryList | null {
  try {
    return window.matchMedia(SYSTEM_THEME_QUERY);
  } catch {
    return null;
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // The bootstrap provides a canvas color before the application stylesheet loads.
  root.style.removeProperty('background-color');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
