import type { MonitorGroup } from '../../../shared/groups/types';
import { ValidationError } from '../../../shared/errors';
import { ConflictError } from '../../errors';

export async function listGroups(db: D1Database): Promise<MonitorGroup[]> {
  return (
    await db
      .prepare(
        'SELECT id, name, sort_order AS sortOrder, version FROM monitor_groups ORDER BY sort_order, created_at, id',
      )
      .all<MonitorGroup>()
  ).results;
}
export async function saveGroup(
  db: D1Database,
  config: { name: string; sortOrder: number },
  id?: string,
  version?: number,
) {
  const groupId = id ?? crypto.randomUUID();
  const result = id
    ? await db
        .prepare(
          `UPDATE monitor_groups SET name = ?, sort_order = ?, version = version + 1
        WHERE id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ? AND id != ?)`,
        )
        .bind(config.name, config.sortOrder, id, version!, config.name, id)
        .run()
    : await db
        .prepare(
          `INSERT INTO monitor_groups(id, name, sort_order, created_at)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ?)`,
        )
        .bind(groupId, config.name, config.sortOrder, Date.now(), config.name)
        .run();
  if (!result.meta.changes) throw new ConflictError('group_conflict');
  return (await listGroups(db)).find((group) => group.id === groupId)!;
}
export async function assertGroup(db: D1Database, id: string | null | undefined) {
  if (id && !(await db.prepare('SELECT id FROM monitor_groups WHERE id = ?').bind(id).first()))
    throw new ValidationError('group_not_found');
}

export async function deleteGroup(db: D1Database, id: string, version: number) {
  const result = await db
    .prepare('DELETE FROM monitor_groups WHERE id = ? AND version = ?')
    .bind(id, version)
    .run();
  if (!result.meta.changes) throw new ConflictError('group_changed');
}
