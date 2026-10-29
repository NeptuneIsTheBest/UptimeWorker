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
  card = false,
}: {
  lastRefreshedAt: number | null;
  pageRefreshSeconds: number;
  refreshing: boolean;
  refresh: () => void;
  card?: boolean;
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
    <div
      className={`refresh-status ${card ? 'stat-card refresh-card' : 'refresh-strip'}`}
      aria-label={t('refresh.label')}
    >
      <div className="refresh-time">
        <span className="stat-label">
          <Icon name="clock" size={16} />
          {t('refresh.last')}
        </span>
        {lastRefreshedAt === null ? (
          <span className="refresh-pending">{t('refresh.pending')}</span>
        ) : (
          <time
            className={card ? 'stat-value time-value' : 'tabular'}
            dateTime={new Date(lastRefreshedAt).toISOString()}
            title={new Date(lastRefreshedAt).toLocaleString(intlLocale(locale), { hour12: false })}
          >
            {formatTime(lastRefreshedAt, false, locale)}
          </time>
        )}
      </div>
      <div className="refresh-details">
        {lastRefreshedAt !== null && (
          <span className="refresh-elapsed tabular">
            {t('refresh.elapsed', { duration: elapsedTime(now - lastRefreshedAt, locale) })}
          </span>
        )}
        <span className="refresh-interval">
          {pageRefreshSeconds === 0
            ? t('refresh.disabled')
            : t('refresh.interval', { count: pageRefreshSeconds })}
        </span>
      </div>
      <button type="button" className="text-button refresh-button" onClick={refresh} aria-busy={refreshing}>
        {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        {t('refresh.now')}
      </button>
    </div>
  );
}
