import { isPageRefreshSeconds, parseGlobalSettingsPatch } from '../../../shared/settings/validation';
import type { GlobalSettings } from '../../../shared/settings/types';
import type { SettingsRow, StoredSettings } from './types';

const SETTINGS_COLUMNS =
  'version, page_refresh_seconds, auto_incident_after_minutes, waf_bypass_enabled, waf_bypass_token, workers_plan, probe_concurrency, max_checks_per_run, time_budget_seconds';
const SETTINGS_QUERY = `SELECT ${SETTINGS_COLUMNS} FROM global_settings WHERE id = 1`;
export function storedSettings(row: SettingsRow | undefined): StoredSettings {
  if (!row) throw new Error('Global settings are unavailable');
  try {
    const current: GlobalSettings = {
      version: row.version,
      performance: {
        workersPlan: row.workers_plan,
        concurrency: row.probe_concurrency,
        maxChecksPerRun: row.max_checks_per_run,
        timeBudgetSeconds: row.time_budget_seconds,
      },
      pageRefreshSeconds: row.page_refresh_seconds,
      autoIncidentAfterMinutes: row.auto_incident_after_minutes,
      wafBypassEnabled: row.waf_bypass_enabled === 1,
      wafBypassTokenConfigured: Boolean(row.waf_bypass_token),
    };
    const parsed = parseGlobalSettingsPatch(
      { ...current, wafBypassToken: row.waf_bypass_token ?? '' },
      current,
    );
    return {
      version: parsed.version,
      performance: parsed.performance,
      pageRefreshSeconds: parsed.pageRefreshSeconds,
      autoIncidentAfterMinutes: parsed.autoIncidentAfterMinutes,
      wafBypass: {
        enabled: parsed.wafBypassEnabled,
        token: parsed.wafBypassToken ?? null,
      },
    };
  } catch {
    // A broken stored configuration is an infrastructure failure, not a client validation error.
    throw new Error('Stored global settings are invalid');
  }
}

export function adminSettings(settings: StoredSettings): GlobalSettings {
  return {
    version: settings.version,
    performance: settings.performance,
    pageRefreshSeconds: settings.pageRefreshSeconds,
    autoIncidentAfterMinutes: settings.autoIncidentAfterMinutes,
    wafBypassEnabled: settings.wafBypass.enabled,
    wafBypassTokenConfigured: Boolean(settings.wafBypass.token),
  };
}

export async function getGlobalSettings(db: D1Database) {
  const result = await prepareSettingsRead(db).all<SettingsRow>();
  return { settings: storedSettings(result.results[0]), meta: result.meta };
}

// Public pages only read their display preference, independently of WAF credentials.
export async function getPageRefreshSeconds(db: D1Database): Promise<number> {
  const value = await db
    .prepare('SELECT page_refresh_seconds FROM global_settings WHERE id = 1')
    .first<number>('page_refresh_seconds');
  if (!isPageRefreshSeconds(value)) throw new Error('Page refresh settings are unavailable');
  return value;
}
export async function updateGlobalSettings(
  db: D1Database,
  patch: ReturnType<typeof parseGlobalSettingsPatch>,
): Promise<StoredSettings | null> {
  const result = await db
    .prepare(
      `UPDATE global_settings SET page_refresh_seconds = ?, auto_incident_after_minutes = ?, waf_bypass_enabled = ?,
      waf_bypass_token = COALESCE(?, waf_bypass_token), workers_plan = ?, probe_concurrency = ?,
      max_checks_per_run = ?, time_budget_seconds = ?, version = version + 1
    WHERE id = 1 AND version = ? RETURNING ${SETTINGS_COLUMNS}`,
    )
    .bind(
      patch.pageRefreshSeconds,
      patch.autoIncidentAfterMinutes,
      Number(patch.wafBypassEnabled),
      patch.wafBypassToken ?? null,
      patch.performance.workersPlan,
      patch.performance.concurrency,
      patch.performance.maxChecksPerRun,
      patch.performance.timeBudgetSeconds,
      patch.version,
    )
    .all<SettingsRow>();
  return result.results.length ? storedSettings(result.results[0]) : null;
}

export function prepareSettingsRead(db: D1Database) {
  return db.prepare(SETTINGS_QUERY);
}
