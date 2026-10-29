import type { MonitorRow, ProbeOptions } from './types';
import { prepareSettingsRead, storedSettings } from '../settings/repository';
import type { SettingsRow } from '../settings/types';

// D1 batches are transactional: settings and target configs share one snapshot.
export async function getProbeSnapshot(db: D1Database, selection: { slot: number } | { id: string }) {
  const targets =
    'id' in selection
      ? db.prepare('SELECT * FROM monitors WHERE id = ?').bind(selection.id)
      : db
          .prepare(
            `SELECT * FROM monitors WHERE enabled = 1 AND next_check_at <= ?
        ORDER BY next_check_at, id LIMIT (SELECT max_checks_per_run FROM global_settings WHERE id = 1)`,
          )
          .bind(selection.slot);
  const reads = await db.batch([prepareSettingsRead(db), targets]);
  const settings = storedSettings(reads[0].results[0] as unknown as SettingsRow | undefined);
  const monitors = reads[1].results as unknown as MonitorRow[];
  const options: ProbeOptions = { wafBypass: settings.wafBypass };
  return { monitors, options, performance: settings.performance, reads };
}
