import type { DailyStat, PublicMonitor } from '../../../shared/monitors/types';
import type { HistoryResponse, StatusResponse } from '../../../shared/status/types';
import type { Env } from '../../types';
import type { MonitorRow } from '../monitors/types';
import { getPageRefreshSeconds } from '../settings/repository';
import { listGroups } from '../groups/repository';
import { listPublicEvents } from '../events/repository';
import { currentStatus, findMonitor } from '../monitors/repository';
import { DAY, dayStart, utcDay } from '../../lib/time';

interface DailyRow {
  monitor_id: string;
  day: string;
  total: number;
  successful: number;
}
interface CheckRow {
  checked_at: number;
  ok: number;
  latency_ms: number;
  http_status: number | null;
  error_code: HistoryResponse['checks'][number]['errorCode'];
}
function publicMonitor(row: MonitorRow, daily: DailyRow[], now: number): PublicMonitor {
  const indexed = new Map(daily.map((stat) => [stat.day, stat]));
  const days: DailyStat[] = Array.from({ length: 90 }, (_, index) => {
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
    groupId: row.group_id ?? null,
    type: row.type,
    status: currentStatus(row, now),
    intervalMinutes: row.interval_minutes,
    lastCheckedAt: row.last_checked_at,
    latencyMs: row.last_latency_ms,
    uptime30d: totals.total ? (totals.successful / totals.total) * 100 : null,
    days,
  };
}
export async function getStatus(env: Env, now = Date.now()): Promise<StatusResponse> {
  const [[monitors, stats], pageRefreshSeconds, groups, events] = await Promise.all([
    env.DB.batch([
      env.DB.prepare('SELECT * FROM monitors ORDER BY created_at, id'),
      env.DB.prepare('SELECT * FROM daily_stats WHERE day >= ? ORDER BY day').bind(
        utcDay(dayStart(now) - 89 * DAY),
      ),
    ]),
    getPageRefreshSeconds(env.DB),
    listGroups(env.DB),
    listPublicEvents(env.DB),
  ]);
  const daily = stats.results as unknown as DailyRow[];
  return {
    groups: groups.map(({ version: _version, ...group }) => group),
    events,
    siteName: env.SITE_NAME || 'UptimeWorker',
    pageRefreshSeconds,
    generatedAt: now,
    monitors: (monitors.results as unknown as MonitorRow[]).map((row) =>
      publicMonitor(
        row,
        daily.filter((stat) => stat.monitor_id === row.id),
        now,
      ),
    ),
  };
}
export async function getHistory(
  db: D1Database,
  id: string,
  now = Date.now(),
): Promise<HistoryResponse | null> {
  const row = await findMonitor(db, id);
  if (!row) return null;
  const [[daily, checks], pageRefreshSeconds, events] = await Promise.all([
    db.batch([
      db
        .prepare('SELECT * FROM daily_stats WHERE monitor_id = ? AND day >= ? ORDER BY day')
        .bind(id, utcDay(dayStart(now) - 89 * DAY)),
      db
        .prepare(
          `SELECT checked_at, ok, latency_ms, http_status, error_code FROM check_results
      WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at DESC`,
        )
        .bind(id, now - DAY),
    ]),
    getPageRefreshSeconds(db),
    listPublicEvents(db, id),
  ]);
  return {
    events,
    monitor: publicMonitor(row, daily.results as unknown as DailyRow[], now),
    pageRefreshSeconds,
    generatedAt: now,
    checks: (checks.results as unknown as CheckRow[]).reverse().map((check) => ({
      checkedAt: Number(check.checked_at),
      ok: check.ok === 1,
      latencyMs: Number(check.latency_ms),
      httpStatus: check.http_status as number | null,
      errorCode: check.error_code as HistoryResponse['checks'][number]['errorCode'],
    })),
  };
}
