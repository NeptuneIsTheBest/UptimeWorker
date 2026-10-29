import { useI18n } from '../../i18n/I18nProvider';
import type { PublicMonitor } from '../../../shared/monitors/types';
import { HistoryBars } from './HistoryBars';
import { Icon } from '../../components/Icon';
import { StatusBadge, effectiveStatus } from './status';
import { latency, percent } from '../../lib/format';

export function MonitorCard({ monitor, now }: { monitor: PublicMonitor; now: number }) {
  const { t, locale } = useI18n();
  return (
    <article className="monitor-card">
      <div className="monitor-top">
        <div className="monitor-title-group">
          <span className="service-icon">
            <Icon name={monitor.type === 'http' ? 'globe' : 'server'} size={21} />
          </span>
          <div>
            <a className="monitor-name" href={`/monitors/${monitor.id}`}>
              {monitor.name}
              <Icon name="arrow" size={15} />
            </a>
            <div className="monitor-meta">
              <span className="protocol">{monitor.type === 'http' ? 'HTTP' : 'TCP'}</span>
            </div>
          </div>
        </div>
        <div className="monitor-figures">
          <div className="inline-metric">
            <strong>{latency(monitor.latencyMs, locale)}</strong>
            <span>{t('monitor.latency')}</span>
          </div>
          <div className="inline-metric">
            <strong>{percent(monitor.uptime30d, locale)}</strong>
            <span>{t('monitor.uptime')}</span>
          </div>
          <StatusBadge status={effectiveStatus(monitor, now)} />
        </div>
      </div>
      <HistoryBars days={monitor.days} />
    </article>
  );
}
