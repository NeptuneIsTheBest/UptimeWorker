import { useI18n } from '../i18n/I18nProvider';
import { isThemePreference } from './core';
import { useTheme } from './ThemeProvider';

export function ThemeSelect() {
  const { preference, setPreference } = useTheme();
  const { t } = useI18n();
  return (
    <select
      className="theme-select"
      aria-label={t('theme.label')}
      value={preference}
      onChange={(event) => {
        if (isThemePreference(event.target.value)) setPreference(event.target.value);
      }}
    >
      <option value="system">{t('theme.system')}</option>
      <option value="light">{t('theme.light')}</option>
      <option value="dark">{t('theme.dark')}</option>
    </select>
  );
}
