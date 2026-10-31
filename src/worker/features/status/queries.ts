import type { HistoryResponse, StatusResponse } from '../../../shared/status/types';
import type { Env } from '../../types';
import { getPageRefreshSeconds } from '../settings/repository';
import { listGroupOrder } from '../groups/repository';
import { listPublicEvents } from '../events/repository';
import { monitorsInDisplayOrder } from '../monitors/repository';
import { DAY, dayStart, utcDay } from '../../lib/time';
import { publicMonitors, type DailyRow, type PublicMonitorRow } from './aggregation';

const PUBLIC_MONITOR_COLUMNS = `m.id, m.name, m.group_id, m.type, m.enabled,
  m.interval_minutes, m.last_checked_at, m.last_ok, m.last_latency_ms`;
interface CheckRow {
  checked_at: number;
  ok: number;
  latency_ms: number;
  http_status: number | null;
  error_code: HistoryResponse['checks'][number]['errorCode'];
}
export async function getStatus(env: Env, now = Date.now()): Promise<StatusResponse> {
  const [[monitors, stats], pageRefreshSeconds, { groups, ungrouped }, events] = await Promise.all([
    env.DB.batch([
      env.DB.prepare(`SELECT ${PUBLIC_MONITOR_COLUMNS} ${monitorsInDisplayOrder}`),
      env.DB.prepare('SELECT * FROM daily_stats WHERE day >= ? ORDER BY day').bind(
        utcDay(dayStart(now) - 89 * DAY),
      ),
    ]),
    getPageRefreshSeconds(env.DB),
    listGroupOrder(env.DB),
    listPublicEvents(env.DB),
  ]);
  const daily = stats.results as unknown as DailyRow[];
  return {
    groups: groups.map(({ version: _version, ...group }) => group),
    ungrouped: { id: ungrouped.id, sortOrder: ungrouped.sortOrder },
    events,
    siteName: env.SITE_NAME || 'UptimeWorker',
    pageRefreshSeconds,
    generatedAt: now,
    monitors: publicMonitors(monitors.results as unknown as PublicMonitorRow[], daily, now),
  };
}
export async function getHistory(
  db: D1Database,
  id: string,
  now = Date.now(),
): Promise<HistoryResponse | null> {
  const row = await db
    .prepare(`SELECT ${PUBLIC_MONITOR_COLUMNS} FROM monitors m WHERE m.id = ?`)
    .bind(id)
    .first<PublicMonitorRow>();
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
    monitor: publicMonitors([row], daily.results as unknown as DailyRow[], now)[0],
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
