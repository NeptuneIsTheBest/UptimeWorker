import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  systemThemeQuery,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from './core';

interface ThemeContextValue {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readThemePreference);
  const [media] = useState(systemThemeQuery);
  const [systemDark, setSystemDark] = useState(() => media?.matches ?? false);
  const theme = resolveTheme(preference, systemDark);

  const setPreference = useCallback((next: ThemePreference) => {
    if (!isThemePreference(next)) return;
    updatePreference(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Keep the in-memory preference. */
    }
  }, []);

  useEffect(() => {
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [media]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY || event.key === null) updatePreference(readThemePreference());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useLayoutEffect(() => applyTheme(theme), [theme]);
  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme requires ThemeProvider');
  return value;
}
