import type { PublicMonitor } from '../../../shared/monitors/types';
import { HistoryBars } from './HistoryBars';
import { Icon } from '../../components/Icon';
import { StatusBadge, effectiveStatus } from './status';
import { formatTime, latency, percent } from '../../lib/format';

export function MonitorCard({ monitor, now }: { monitor: PublicMonitor; now: number }) {
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
              <span>每 {monitor.intervalMinutes} 分钟</span>
              <span className="last-check">最近检测 {formatTime(monitor.lastCheckedAt)}</span>
            </div>
          </div>
        </div>
        <div className="monitor-figures">
          <div className="inline-metric">
            <strong>{latency(monitor.latencyMs)}</strong>
            <span>响应时间</span>
          </div>
          <div className="inline-metric">
            <strong>{percent(monitor.uptime30d)}</strong>
            <span>30 日可用率</span>
          </div>
          <StatusBadge status={effectiveStatus(monitor, now)} />
        </div>
      </div>
      <HistoryBars days={monitor.days} />
    </article>
  );
}
