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
  isLocalePreference,
  LOCALE_STORAGE_KEY,
  readLocale,
  readLocalePreference,
  translator,
  type Locale,
  type LocalePreference,
} from './core';

interface I18nContextValue {
  preference: LocalePreference;
  locale: Locale;
  setPreference: (preference: LocalePreference) => void;
  t: ReturnType<typeof translator>;
}
const I18nContext = createContext<I18nContextValue | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState(readLocalePreference);
  const [systemLocale, updateSystemLocale] = useState(() => readLocale('system'));
  const locale = preference === 'system' ? systemLocale : preference;
  const setPreference = useCallback((next: LocalePreference) => {
    if (!isLocalePreference(next)) return;
    updatePreference(next);
    if (next === 'system') updateSystemLocale(readLocale('system'));
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* Keep the in-memory preference. */
    }
  }, []);
  useEffect(() => {
    const onLanguageChange = () => updateSystemLocale(readLocale('system'));
    onLanguageChange();
    window.addEventListener('languagechange', onLanguageChange);
    return () => window.removeEventListener('languagechange', onLanguageChange);
  }, []);
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
        updatePreference(readLocalePreference());
        updateSystemLocale(readLocale('system'));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const t = useMemo(() => translator(locale), [locale]);
  const value = useMemo(
    () => ({ preference, locale, setPreference, t }),
    [preference, locale, setPreference, t],
  );
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('page.description'));
  }, [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
}
