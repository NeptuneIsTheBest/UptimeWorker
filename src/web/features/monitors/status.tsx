import { STATUS_LABELS } from './labels';
import type { MonitorStatus, PublicMonitor } from '../../../shared/monitors/types';

export function effectiveStatus(monitor: PublicMonitor, now: number): MonitorStatus {
  return ['up', 'down'].includes(monitor.status) &&
    monitor.lastCheckedAt !== null &&
    now - monitor.lastCheckedAt > monitor.intervalMinutes * 120_000
    ? 'stale'
    : monitor.status;
}
export function StatusBadge({ status }: { status: MonitorStatus }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}
