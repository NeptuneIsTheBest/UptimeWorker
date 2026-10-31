import { groupBy } from '../../../shared/collections';
import type { DailyStat, PublicMonitor } from '../../../shared/monitors/types';
import { DAY, dayStart, utcDay } from '../../lib/time';
import { currentStatus } from '../monitors/repository';
import type { MonitorRow } from '../monitors/types';

export type PublicMonitorRow = Pick<
  MonitorRow,
  | 'id'
  | 'name'
  | 'group_id'
  | 'type'
  | 'enabled'
  | 'interval_minutes'
  | 'last_checked_at'
  | 'last_ok'
  | 'last_latency_ms'
>;

export interface DailyRow {
  monitor_id: string;
  day: string;
  total: number;
  successful: number;
}

export function publicMonitors(
  rows: readonly PublicMonitorRow[],
  daily: readonly DailyRow[],
  now: number,
): PublicMonitor[] {
  const today = dayStart(now);
  const dates = Array.from({ length: 90 }, (_, index) => utcDay(today - (89 - index) * DAY));
  const byMonitor = groupBy(daily, (stat) => stat.monitor_id);
  return rows.map((row) => {
    const indexed = new Map(byMonitor.get(row.id)?.map((stat) => [stat.day, stat]));
    let total = 0;
    let successful = 0;
    const days: DailyStat[] = dates.map((day, index) => {
      const stat = indexed.get(day);
      if (index >= 60 && stat) {
        total += stat.total;
        successful += stat.successful;
      }
      return {
        day,
        total: stat?.total ?? 0,
        successful: stat?.successful ?? 0,
        uptime: stat?.total ? (stat.successful / stat.total) * 100 : null,
      };
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
      uptime30d: total ? (successful / total) * 100 : null,
      days,
    };
  });
}
