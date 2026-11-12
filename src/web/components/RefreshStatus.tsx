import { useI18n } from '../i18n/I18nProvider';
import { intlLocale } from '../../shared/locale';
import { useMemo } from 'react';
import { formatTime, elapsedTime } from '../lib/format';
import { Icon } from './Icon';
import { useNow } from '../hooks/useNow';

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
  const now = useNow(1000, lastRefreshedAt !== null);
  const refreshedTime = useMemo(
    () =>
      lastRefreshedAt === null
        ? null
        : {
            iso: new Date(lastRefreshedAt).toISOString(),
            title: new Date(lastRefreshedAt).toLocaleString(intlLocale(locale), { hour12: false }),
            label: formatTime(lastRefreshedAt, false, locale),
          },
    [lastRefreshedAt, locale],
  );

  return (
    <div className="refresh-status" aria-label={t('refresh.label')}>
      <details className="refresh-disclosure">
        <summary className="refresh-time">
          <Icon name="clock" size={14} />
          <span>{t('refresh.last')}</span>
          {refreshedTime === null ? (
            <span className="refresh-pending">{t('refresh.pending')}</span>
          ) : (
            <time className="tabular" dateTime={refreshedTime.iso} title={refreshedTime.title}>
              {refreshedTime.label}
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
          <span className="refresh-interval">
            {pageRefreshSeconds === 0
              ? t('refresh.disabled')
              : t('refresh.interval', { count: pageRefreshSeconds })}
          </span>
        </div>
      </details>
      <button type="button" className="refresh-button" onClick={refresh} aria-busy={refreshing}>
        {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        {t('refresh.now')}
      </button>
    </div>
  );
}
