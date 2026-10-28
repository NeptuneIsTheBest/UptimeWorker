import { parseGlobalSettingsPatch } from '../shared/settings';
import type { GlobalSettings } from '../shared/types';
import type { MonitorRow, ProbeOptions, WafBypassSettings } from './types';

const SETTINGS_COLUMNS = 'version, waf_bypass_enabled, waf_bypass_token';
const SETTINGS_QUERY = `SELECT ${SETTINGS_COLUMNS} FROM global_settings WHERE id = 1`;

interface SettingsRow {
  version: number;
  waf_bypass_enabled: number;
  waf_bypass_token: string | null;
}
export interface StoredSettings {
  version: number;
  wafBypass: WafBypassSettings;
}

function storedSettings(row: SettingsRow | undefined): StoredSettings {
  if (!row) throw new Error('Global settings are unavailable');
  try {
    const parsed = parseGlobalSettingsPatch(
      {
        version: row.version,
        wafBypassEnabled: row.waf_bypass_enabled === 1,
        wafBypassToken: row.waf_bypass_token ?? '',
      },
      {
        version: row.version,
        wafBypassEnabled: false,
        wafBypassTokenConfigured: false,
      },
    );
    return {
      version: parsed.version,
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
    wafBypassEnabled: settings.wafBypass.enabled,
    wafBypassTokenConfigured: Boolean(settings.wafBypass.token),
  };
}

export async function getGlobalSettings(db: D1Database) {
  const result = await db.prepare(SETTINGS_QUERY).all<SettingsRow>();
  return { settings: storedSettings(result.results[0]), meta: result.meta };
}

// D1 batches are transactional: settings and target configs share one snapshot.
export async function getProbeSnapshot(db: D1Database) {
  const reads = await db.batch([
    db.prepare(SETTINGS_QUERY),
    db.prepare('SELECT * FROM monitors ORDER BY next_check_at, id'),
  ]);
  const settings = storedSettings(reads[0].results[0] as unknown as SettingsRow | undefined);
  const monitors = reads[1].results as unknown as MonitorRow[];
  const options: ProbeOptions = { wafBypass: settings.wafBypass };
  return { monitors, options, reads };
}

export async function updateGlobalSettings(
  db: D1Database,
  patch: ReturnType<typeof parseGlobalSettingsPatch>,
): Promise<StoredSettings | null> {
  const result = await db
    .prepare(
      `UPDATE global_settings SET waf_bypass_enabled = ?,
      waf_bypass_token = COALESCE(?, waf_bypass_token), version = version + 1
    WHERE id = 1 AND version = ? RETURNING ${SETTINGS_COLUMNS}`,
    )
    .bind(Number(patch.wafBypassEnabled), patch.wafBypassToken ?? null, patch.version)
    .all<SettingsRow>();
  return result.results.length ? storedSettings(result.results[0]) : null;
}
