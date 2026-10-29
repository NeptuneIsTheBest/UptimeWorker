import { useI18n } from '../i18n/I18nProvider';
import { intlLocale } from '../../shared/locale';
import { useEffect, useState } from 'react';
import { formatTime, elapsedTime } from '../lib/format';
import { Icon } from './Icon';

export function RefreshStatus({
  lastRefreshedAt,
  pageRefreshSeconds,
  refreshing,
  refresh,
}: {
  lastRefreshedAt: number | null;
  pageRefreshSeconds: number;
  refreshing: boolean;
  refresh: () => void;
}) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (lastRefreshedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const update = () => setNow(Date.now());
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [lastRefreshedAt]);

  return (
    <div className="refresh-status" aria-label={t('refresh.label')}>
      <details className="refresh-disclosure">
        <summary className="refresh-time">
          <Icon name="clock" size={14} />
          <span>{t('refresh.last')}</span>
          {lastRefreshedAt === null ? (
            <span className="refresh-pending">{t('refresh.pending')}</span>
          ) : (
            <time
              className="tabular"
              dateTime={new Date(lastRefreshedAt).toISOString()}
              title={new Date(lastRefreshedAt).toLocaleString(intlLocale(locale), { hour12: false })}
            >
              {formatTime(lastRefreshedAt, false, locale)}
            </time>
          )}
          <Icon name="chevron" size={12} />
        </summary>
        <div className="refresh-details">
          {lastRefreshedAt !== null && (
            <span className="refresh-elapsed tabular">
              {t('refresh.elapsed', { duration: elapsedTime(now - lastRefreshedAt, locale) })}
            </span>
          )}
          {pageRefreshSeconds !== 0 && (
            <span className="refresh-interval">{t('refresh.interval', { count: pageRefreshSeconds })}</span>
          )}
        </div>
      </details>
      {pageRefreshSeconds === 0 && <span className="refresh-interval">{t('refresh.disabled')}</span>}
      <button type="button" className="refresh-button" onClick={refresh} aria-busy={refreshing}>
        {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        {t('refresh.now')}
      </button>
    </div>
  );
}
