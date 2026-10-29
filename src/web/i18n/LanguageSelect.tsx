import { isLocale } from './core';
import { useI18n } from './I18nProvider';

export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      className="language-select"
      aria-label={t('language.label')}
      value={locale}
      onChange={(event) => {
        if (isLocale(event.target.value)) setLocale(event.target.value);
      }}
    >
      <option value="zh-CN" lang="zh-CN">
        简体中文
      </option>
      <option value="en" lang="en">
        English
      </option>
    </select>
  );
}
