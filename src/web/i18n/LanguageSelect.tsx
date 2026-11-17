import { isLocalePreference } from './core';
import { useI18n } from './I18nProvider';

export function LanguageSelect() {
  const { preference, setPreference, t } = useI18n();
  return (
    <select
      className="language-select"
      aria-label={t('language.label')}
      value={preference}
      onChange={(event) => {
        if (isLocalePreference(event.target.value)) setPreference(event.target.value);
      }}
    >
      <option value="system">{t('language.system')}</option>
      <option value="zh-CN" lang="zh-CN">
        简体中文
      </option>
      <option value="en" lang="en">
        English
      </option>
    </select>
  );
}
