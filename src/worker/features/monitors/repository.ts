import { MAX_MONITORS } from '../../../shared/monitors/constants';
import type { AdminMonitor, MonitorConfig, MonitorStatus } from '../../../shared/monitors/types';
import type { MonitorRow } from './types';
import { parseMonitorConfig } from '../../../shared/monitors/validation';
import { assertGroup } from '../groups/repository';

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

export async function deleteMonitor(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM monitors WHERE id = ?').bind(id).run();
  return Boolean(result.meta.changes);
}
