import { parseGlobalSettingsPatch } from '../shared/settings';
import type { GlobalSettings } from '../shared/types';
import type { WafBypassSettings } from './types';

interface SettingsRow {
  version: number;
  waf_bypass_enabled: number;
  waf_bypass_token: string | null;
  waf_bypass_domains_json: string;
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
        wafBypassDomains: JSON.parse(row.waf_bypass_domains_json),
        wafBypassToken: row.waf_bypass_token ?? '',
      },
      {
        version: row.version,
        wafBypassEnabled: false,
        wafBypassDomains: [],
        wafBypassTokenConfigured: false,
      },
    );
    return {
      version: parsed.version,
      wafBypass: {
        enabled: parsed.wafBypassEnabled,
        domains: parsed.wafBypassDomains,
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
    wafBypassDomains: [...settings.wafBypass.domains],
    wafBypassTokenConfigured: Boolean(settings.wafBypass.token),
  };
}

export async function getGlobalSettings(db: D1Database) {
  const result = await db.prepare('SELECT * FROM global_settings WHERE id = 1').all<SettingsRow>();
  return { settings: storedSettings(result.results[0]), meta: result.meta };
}

export async function updateGlobalSettings(
  db: D1Database,
  patch: ReturnType<typeof parseGlobalSettingsPatch>,
): Promise<StoredSettings | null> {
  const result = await db
    .prepare(
      `UPDATE global_settings SET waf_bypass_enabled = ?, waf_bypass_domains_json = ?,
      waf_bypass_token = COALESCE(?, waf_bypass_token), version = version + 1
    WHERE id = 1 AND version = ? RETURNING *`,
    )
    .bind(
      Number(patch.wafBypassEnabled),
      JSON.stringify(patch.wafBypassDomains),
      patch.wafBypassToken ?? null,
      patch.version,
    )
    .all<SettingsRow>();
  return result.results.length ? storedSettings(result.results[0]) : null;
}
