import type { OrderItem } from '../../../shared/ordering';
import { ConflictError } from '../../errors';

export async function saveOrder(
  db: D1Database,
  table: 'monitors' | 'monitor_groups',
  items: OrderItem[],
  groupId: string | null = null,
) {
  const monitors = table === 'monitors';
  // Materialize the entire pre-write snapshot: updating one row must not
  // invalidate the guard for subsequent rows in the same statement.
  const statement = db.prepare(`
    WITH requested AS MATERIALIZED (
      SELECT json_extract(value, '$.id') AS id,
        json_extract(value, '$.expectedVersion') AS version,
        json_extract(value, '$.expectedSortOrder') AS sort_order,
        CAST(key AS INTEGER) AS position FROM json_each(?1)
    ), scope AS MATERIALIZED (
      SELECT id, version, sort_order FROM ${table} ${monitors ? 'WHERE group_id IS ?2' : ''}
    ), valid AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM requested) = (SELECT COUNT(*) FROM scope)
        AND NOT EXISTS (
          SELECT 1 FROM requested r LEFT JOIN scope s ON s.id = r.id
          WHERE s.id IS NULL OR s.version != r.version OR s.sort_order != r.sort_order
        ) AS ok
    )
    UPDATE ${table} SET
      ${monitors ? '' : `version = version + CASE WHEN sort_order != (SELECT position FROM requested WHERE id = ${table}.id) THEN 1 ELSE 0 END,`}
      sort_order = (SELECT position FROM requested WHERE id = ${table}.id)
    WHERE (SELECT ok FROM valid) AND id IN (SELECT id FROM requested)
  `);
  const result = await statement
    .bind(...(monitors ? [JSON.stringify(items), groupId] : [JSON.stringify(items)]))
    .run();
  if (!result.meta.changes) throw new ConflictError('order_conflict');
}
