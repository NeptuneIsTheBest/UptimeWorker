import type { PublicMonitor } from '../../src/shared/monitors/types';
import { currentStatus } from '../../src/worker/features/monitors/repository';
import type { DailyRow, PublicMonitorRow } from '../../src/worker/features/status/aggregation';
import { DAY, dayStart, utcDay } from '../../src/worker/lib/time';

// Retain the original aggregation as a correctness and timing baseline.
export function baselineMonitors(rows: PublicMonitorRow[], daily: DailyRow[], now: number): PublicMonitor[] {
  return rows.map((row) => {
    const indexed = new Map(
      daily.filter((stat) => stat.monitor_id === row.id).map((stat) => [stat.day, stat]),
    );
    const days = Array.from({ length: 90 }, (_, index) => {
      const day = utcDay(dayStart(now) - (89 - index) * DAY);
      const stat = indexed.get(day);
      return {
        day,
        total: stat?.total ?? 0,
        successful: stat?.successful ?? 0,
        uptime: stat?.total ? (stat.successful / stat.total) * 100 : null,
      };
    });
    const totals = days
      .slice(-30)
      .reduce((acc, day) => ({ total: acc.total + day.total, successful: acc.successful + day.successful }), {
        total: 0,
        successful: 0,
      });
    return {
      id: row.id,
      name: row.name,
      groupId: row.group_id,
      type: row.type,
      status: currentStatus(row, now),
      intervalMinutes: row.interval_minutes,
      lastCheckedAt: row.last_checked_at,
      latencyMs: row.last_latency_ms,
      uptime30d: totals.total ? (totals.successful / totals.total) * 100 : null,
      days,
    };
  });
}

export const baselinePublicEvents = `WITH scoped AS (SELECT e.* FROM events e)
  SELECT * FROM scoped WHERE status = 'open' OR id IN (
    SELECT id FROM scoped WHERE status != 'open' ORDER BY updated_at DESC, id DESC LIMIT 20
  ) ORDER BY updated_at DESC, id DESC`;

export function medianMs(work: () => unknown) {
  work();
  const times = Array.from({ length: 5 }, () => {
    const started = performance.now();
    work();
    return performance.now() - started;
  });
  return Number(times.sort((a, b) => a - b)[2].toFixed(3));
}
