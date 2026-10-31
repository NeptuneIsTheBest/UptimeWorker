import { useI18n } from '../i18n/I18nProvider';
import { useEffect, type ReactNode } from 'react';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { ThemeSelect } from '../theme/ThemeSelect';
import { Icon } from '../components/Icon';

export function Layout({
  children,
  admin = false,
  siteName = 'UptimeWorker',
}: {
  children: ReactNode;
  admin?: boolean;
  siteName?: string;
}) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${siteName} · ${admin ? t('nav.admin') : t('page.status')}`;
  }, [siteName, admin, t]);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a href="/" className="brand" title={siteName}>
            <span className="brand-mark">
              <Icon size={24} />
            </span>
            <span className="brand-name">
              {siteName === 'UptimeWorker' ? (
                <>
                  Uptime<span className="brand-light">Worker</span>
                </>
              ) : (
                siteName
              )}
            </span>
          </a>
          <nav aria-label={t('nav.main')}>
            <a href="/" className={!admin ? 'active' : ''}>
              {t('nav.overview')}
            </a>
            <a href="/admin" className={admin ? 'active' : ''}>
              {t('nav.admin')}
            </a>
          </nav>
          <div className="header-preferences">
            <LanguageSelect />
            <ThemeSelect />
          </div>
        </div>
      </header>
      <main className="main-content">{children}</main>
      <footer className="site-footer">
        <span>
          <Icon size={15} /> UptimeWorker
        </span>
      </footer>
    </>
  );
}
