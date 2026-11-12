import { useI18n } from '../../i18n/I18nProvider';
import type { DailyStat } from '../../../shared/monitors/types';
import { percent } from '../../lib/format';
import { memo } from 'react';

export const HistoryBars = memo(function HistoryBars({
  days,
  compact = false,
}: {
  days: DailyStat[];
  compact?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <div className={`history${compact ? ' history-compact' : ''}`}>
      <div className="history-bars" aria-label={t('history.label')}>
        {days.map((day) => (
          <span
            key={day.day}
            className={`history-bar ${day.uptime === null ? 'empty' : day.uptime === 100 ? 'up' : day.uptime === 0 ? 'down' : 'partial'}`}
            title={`${day.day} UTC · ${day.total ? `${percent(day.uptime, locale)} · ${t('history.successful', { successful: day.successful, total: day.total })}` : t('history.noData')}`}
          />
        ))}
      </div>
      <div className="history-labels">
        <span>{t('history.start')}</span>
        <span>{t('history.today')}</span>
      </div>
    </div>
  );
});
export function Legend() {
  const { t } = useI18n();
  return (
    <div className="legend">
      <span>
        <i className="legend-dot up" />
        {t('history.healthy')}
      </span>
      <span>
        <i className="legend-dot partial" />
        {t('history.partial')}
      </span>
      <span>
        <i className="legend-dot down" />
        {t('history.down')}
      </span>
      <span>
        <i className="legend-dot empty" />
        {t('history.empty')}
      </span>
    </div>
  );
}
