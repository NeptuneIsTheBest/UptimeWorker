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
import { isLocale, LOCALE_STORAGE_KEY, readLocale, translator, type Locale } from './core';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: ReturnType<typeof translator>;
}
const I18nContext = createContext<I18nContextValue | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState(readLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* Keep the in-memory preference. */
    }
  }, []);
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) updateLocale(readLocale());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: translator(locale) }), [locale, setLocale]);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.querySelector('meta[name="description"]')?.setAttribute('content', value.t('page.description'));
  }, [locale, value]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
}
