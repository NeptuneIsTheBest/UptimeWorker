import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { useI18n } from '../i18n/I18nProvider';
import { ThemeSelect } from '../theme/ThemeSelect';

export function HeaderPreferences() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

  return (
    <div
      className="header-preferences"
      ref={root}
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="preferences-toggle"
        ref={trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="sliders" size={16} />
        {t('nav.preferences')}
      </button>
      <div className="preferences-panel" id={id}>
        <label>
          <span className="preference-label">{t('language.label')}</span>
          <LanguageSelect />
        </label>
        <label>
          <span className="preference-label">{t('theme.label')}</span>
          <ThemeSelect />
        </label>
      </div>
    </div>
  );
}
