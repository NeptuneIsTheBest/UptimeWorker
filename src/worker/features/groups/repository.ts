import { UNGROUPED_ID, type GroupListing, type MonitorGroup } from '../../../shared/groups/types';
import { ValidationError } from '../../../shared/errors';
import { ConflictError } from '../../errors';

async function allGroups(db: D1Database): Promise<MonitorGroup[]> {
  return (
    await db
      .prepare(
        `SELECT id, name, sort_order AS sortOrder, version FROM monitor_groups
        ORDER BY sort_order, id = '${UNGROUPED_ID}', created_at, id`,
      )
      .all<MonitorGroup>()
  ).results;
}
export async function listGroups(db: D1Database): Promise<MonitorGroup[]> {
  return (await allGroups(db)).filter((group) => group.id !== UNGROUPED_ID);
}

export async function listGroupOrder(db: D1Database): Promise<GroupListing> {
  const rows = await allGroups(db);
  const system = rows.find((group) => group.id === UNGROUPED_ID);
  if (!system) throw new Error('Ungrouped display order is unavailable');
  return {
    groups: rows.filter((group) => group.id !== UNGROUPED_ID),
    ungrouped: { id: UNGROUPED_ID, sortOrder: system.sortOrder, version: system.version },
  };
}

export async function saveGroup(
  db: D1Database,
  config: { name: string; sortOrder?: number },
  id?: string,
  version?: number,
) {
  if (id === UNGROUPED_ID) throw new ValidationError('group_readonly');
  const groupId = id ?? crypto.randomUUID();
  const result = id
    ? await db
        .prepare(
          `UPDATE monitor_groups SET name = ?, sort_order = COALESCE(?, sort_order), version = version + 1
        WHERE id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ? AND id != ?)`,
        )
        .bind(config.name, config.sortOrder ?? null, id, version!, config.name, id)
        .run()
    : (
        await db.batch([
          // Legacy numeric orders can occupy the top of the accepted range.
          // Compact them only when appending would otherwise exceed that range.
          db
            .prepare(
              `WITH positions AS MATERIALIZED (
          SELECT id, sort_order AS original_order,
            ROW_NUMBER() OVER (ORDER BY sort_order, id = '${UNGROUPED_ID}', created_at, id) - 1 AS position
          FROM monitor_groups
        ) UPDATE monitor_groups SET
          sort_order = (SELECT position FROM positions WHERE id = monitor_groups.id),
          version = version + 1
        WHERE ? IS NULL AND (SELECT MAX(original_order) FROM positions) >= 1000000
          AND NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ?)
          AND sort_order != (SELECT position FROM positions WHERE id = monitor_groups.id)`,
            )
            .bind(config.sortOrder ?? null, config.name),
          // Preserve a trailing Ungrouped entry when appending a new group.
          // All three statements run in one transaction, including the name guard.
          db
            .prepare(
              `WITH next AS MATERIALIZED (
          SELECT COALESCE(?, (SELECT COALESCE(MAX(sort_order), -1) + 1
            FROM monitor_groups WHERE id != '${UNGROUPED_ID}')) AS position
        ) UPDATE monitor_groups SET sort_order = (SELECT position + 1 FROM next), version = version + 1
        WHERE id = '${UNGROUPED_ID}' AND sort_order <= (SELECT position FROM next)
          AND NOT EXISTS (SELECT 1 FROM monitor_groups g
            WHERE g.id != '${UNGROUPED_ID}' AND g.sort_order > monitor_groups.sort_order)
          AND NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ?)`,
            )
            .bind(config.sortOrder ?? null, config.name),
          db
            .prepare(
              `INSERT INTO monitor_groups(id, name, sort_order, created_at)
        SELECT ?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), -1) + 1
          FROM monitor_groups WHERE id != '${UNGROUPED_ID}')), ?
        WHERE NOT EXISTS (SELECT 1 FROM monitor_groups WHERE name = ?)`,
            )
            .bind(groupId, config.name, config.sortOrder ?? null, Date.now(), config.name),
        ])
      )[2];
  if (!result.meta.changes) throw new ConflictError('group_conflict');
  return (await listGroups(db)).find((group) => group.id === groupId)!;
}
export async function assertGroup(db: D1Database, id: string | null | undefined) {
  if (id === UNGROUPED_ID) throw new ValidationError('group_invalid');
  if (id && !(await db.prepare('SELECT id FROM monitor_groups WHERE id = ?').bind(id).first()))
    throw new ValidationError('group_not_found');
}

export async function deleteGroup(db: D1Database, id: string, version: number) {
  if (id === UNGROUPED_ID) throw new ValidationError('group_readonly');
  const [, result] = await db.batch([
    db
      .prepare(
        `WITH positions AS MATERIALIZED (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, created_at, id) +
        (SELECT COALESCE(MAX(sort_order), -1) FROM monitors WHERE group_id IS NULL) AS position
      FROM monitors WHERE group_id = ?
    ) UPDATE monitors SET sort_order = (SELECT position FROM positions WHERE id = monitors.id)
    WHERE id IN (SELECT id FROM positions)
      AND EXISTS (SELECT 1 FROM monitor_groups WHERE id = ? AND version = ?)`,
      )
      .bind(id, id, version),
    db.prepare('DELETE FROM monitor_groups WHERE id = ? AND version = ?').bind(id, version),
  ]);
  if (!result.meta.changes) throw new ConflictError('group_changed');
}
