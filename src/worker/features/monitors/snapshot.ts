import type { MonitorRow, ProbeOptions } from './types';
import { prepareSettingsRead, storedSettings } from '../settings/repository';
import type { SettingsRow } from '../settings/types';

// D1 batches are transactional: settings and target configs share one snapshot.
export async function getProbeSnapshot(db: D1Database) {
  const reads = await db.batch([
    prepareSettingsRead(db),
    db.prepare('SELECT * FROM monitors ORDER BY next_check_at, id'),
  ]);
  const settings = storedSettings(reads[0].results[0] as unknown as SettingsRow | undefined);
  const monitors = reads[1].results as unknown as MonitorRow[];
  const options: ProbeOptions = { wafBypass: settings.wafBypass };
  return { monitors, options, reads };
}
