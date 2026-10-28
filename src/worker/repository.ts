import {
  MAX_MONITORS,
  type AdminMonitor,
  type DailyStat,
  type HistoryResponse,
  type MonitorConfig,
  type MonitorStatus,
  type PublicMonitor,
  type StatusResponse,
} from '../shared/types';
import type { Env, MonitorRow } from './types';
import { parseMonitorConfig } from '../shared/validation';
import { getPageRefreshSeconds } from './settings';
import { assertGroup, listGroups, listPublicEvents } from './events';

const DAY = 86_400_000;
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export const dayStart = (time: number) => Math.floor(time / DAY) * DAY;

export function monitorConfig(row: MonitorRow): MonitorConfig {
  return parseMonitorConfig({
    ...JSON.parse(row.config_json),
    name: row.name,
    groupId: row.group_id ?? null,
    type: row.type,
    intervalMinutes: row.interval_minutes,
    timeoutSeconds: row.timeout_seconds,
    enabled: row.enabled === 1,
  });
}
export function currentStatus(row: MonitorRow, now: number): MonitorStatus {
  if (!row.enabled) return 'paused';
  if (row.last_checked_at === null) return 'unknown';
  if (now - row.last_checked_at > row.interval_minutes * 120_000) return 'stale';
  return row.last_ok === 1 ? 'up' : 'down';
}
export function adminMonitor(row: MonitorRow, now = Date.now()): AdminMonitor {
  return {
    ...monitorConfig(row),
    id: row.id,
    version: row.version,
    status: currentStatus(row, now),
    lastCheckedAt: row.last_checked_at,
    latencyMs: row.last_latency_ms,
    errorCode: row.last_error_code,
  };
}
export async function findMonitor(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM monitors WHERE id = ?').bind(id).first<MonitorRow>();
}
export async function listMonitors(db: D1Database) {
  return (await db.prepare('SELECT * FROM monitors ORDER BY created_at, id').all<MonitorRow>()).results;
}
export async function createMonitor(
  db: D1Database,
  config: MonitorConfig,
  now = Date.now(),
): Promise<MonitorRow | null> {
  await assertGroup(db, config.groupId);
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO monitors
    (id, name, type, config_json, interval_minutes, timeout_seconds, enabled, created_at, updated_at, group_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM monitors) < ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM monitor_groups WHERE id = ?))`,
    )
    .bind(
      id,
      config.name,
      config.type,
      JSON.stringify(config),
      config.intervalMinutes,
      config.timeoutSeconds,
      Number(config.enabled),
      now,
      now,
      config.groupId ?? null,
      MAX_MONITORS,
      config.groupId ?? null,
      config.groupId ?? null,
    )
    .run();
  if (!result.meta.changes) await assertGroup(db, config.groupId);
  return result.meta.changes ? findMonitor(db, id) : null;
}
export async function updateMonitor(
  db: D1Database,
  id: string,
  version: number,
  config: MonitorConfig,
  now = Date.now(),
) {
  await assertGroup(db, config.groupId);
  const current = await findMonitor(db, id);
  if (!current || current.version !== version) return null;
  const probeConfig = (value: MonitorConfig) => {
    const { name: _name, groupId: _groupId, ...probe } = value;
    return JSON.stringify(probe);
  };
  const reset = probeConfig(monitorConfig(current)) !== probeConfig(parseMonitorConfig(config));
  const result = await db
    .prepare(
      `UPDATE monitors SET name = ?, type = ?, config_json = ?, interval_minutes = ?,
    timeout_seconds = ?, enabled = ?, updated_at = ?, group_id = ?, version = version + 1,
    next_check_at = CASE WHEN ? THEN 0 ELSE next_check_at END,
    last_checked_at = CASE WHEN ? THEN NULL ELSE last_checked_at END,
    last_ok = CASE WHEN ? THEN NULL ELSE last_ok END,
    last_latency_ms = CASE WHEN ? THEN NULL ELSE last_latency_ms END,
    last_error_code = CASE WHEN ? THEN NULL ELSE last_error_code END
    WHERE id = ? AND version = ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM monitor_groups WHERE id = ?))`,
    )
    .bind(
      config.name,
      config.type,
      JSON.stringify(config),
      config.intervalMinutes,
      config.timeoutSeconds,
      Number(config.enabled),
      now,
      config.groupId ?? null,
      ...Array(5).fill(Number(reset)),
      id,
      version,
      config.groupId ?? null,
      config.groupId ?? null,
    )
    .run();
  if (!result.meta.changes) await assertGroup(db, config.groupId);
  return result.meta.changes ? findMonitor(db, id) : null;
}

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
