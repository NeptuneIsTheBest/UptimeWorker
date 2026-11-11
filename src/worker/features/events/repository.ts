import type {
  AdminEvent,
  EventConfig,
  EventDeleteItem,
  EventUpdateConfig,
  StatusEvent,
} from '../../../shared/events/types';
import { resolveEventUpdateConfig } from '../../../shared/events/progress';
import { ValidationError } from '../../../shared/errors';
import { ConflictError } from '../../errors';
import { groupBy } from '../../../shared/collections';

interface EventRow {
  id: string;
  title: string;
  body: string;
  type: EventConfig['type'];
  source: AdminEvent['source'];
  status: AdminEvent['status'];
  version: number;
  starts_at: number | null;
  ends_at: number | null;
  started_at: number;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}
export function publicEvent(event: AdminEvent): StatusEvent {
  const { version: _version, ...result } = event;
  return result;
}
async function readEvents(
  db: D1Database,
  selection: string,
  values: (string | number)[],
): Promise<AdminEvent[]> {
  // Read the parent, associations and progress from one D1 snapshot so a
  // concurrent recovery cannot pair an old status with a new recovery note.
  const [parents, monitors, updates] = await db.batch([
    db.prepare(selection).bind(...values),
    db
      .prepare(
        `WITH selected AS (${selection})
      SELECT em.event_id, em.monitor_id AS id, COALESCE(m.name, em.monitor_name) AS name
      FROM event_monitors em JOIN selected e ON e.id = em.event_id
      LEFT JOIN monitors m ON m.id = em.monitor_id
      ORDER BY em.monitor_name, em.monitor_key`,
      )
      .bind(...values),
    db
      .prepare(
        `WITH selected AS (${selection})
      SELECT u.id, u.event_id, u.title, u.body, u.status, u.source, u.created_at AS createdAt
      FROM event_updates u JOIN selected e ON e.id = u.event_id ORDER BY u.created_at, u.id`,
      )
      .bind(...values),
  ]);
  const rows = parents.results as unknown as EventRow[];
  const monitorsByEvent = groupBy(
    monitors.results as unknown as (AdminEvent['monitors'][number] & { event_id: string })[],
    (item) => item.event_id,
  );
  const updatesByEvent = groupBy(
    updates.results as unknown as (AdminEvent['updates'][number] & { event_id: string })[],
    (item) => item.event_id,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    source: row.source,
    status: row.status,
    version: row.version,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    monitors: (monitorsByEvent.get(row.id) ?? []).map(({ id, name }) => ({ id, name })),
    updates: (updatesByEvent.get(row.id) ?? []).map(({ event_id: _eventId, ...item }) => item),
  }));
}
export async function getEvent(db: D1Database, id: string) {
  return (await readEvents(db, 'SELECT e.* FROM events e WHERE e.id = ?', [id]))[0] ?? null;
}
export async function listPublicEvents(db: D1Database, monitorId?: string): Promise<StatusEvent[]> {
  const scope = monitorId ? 'e.id IN (SELECT event_id FROM event_monitors WHERE monitor_id = ?) AND' : '';
  const rows = await readEvents(
    db,
    `SELECT * FROM (
      SELECT e.* FROM events e WHERE ${scope} e.status = 'open'
      UNION ALL
      SELECT * FROM (
        SELECT e.* FROM events e WHERE ${scope} e.status != 'open'
        ORDER BY e.updated_at DESC, e.id DESC LIMIT 20
      )
    )
    ORDER BY updated_at DESC, id DESC`,
    monitorId ? [monitorId, monitorId] : [],
  );
  return rows.map(publicEvent);
}
export async function listEvents(db: D1Database, options: { cursor?: string } = {}) {
  const predicates = ["e.status != 'open'"];
  const values: (string | number)[] = [];

  if (options.cursor) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(options.cursor);
    } catch {
      throw new ValidationError('cursor_invalid');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      !Number.isSafeInteger(cursor[0]) ||
      typeof cursor[1] !== 'string'
    )
      throw new ValidationError('cursor_invalid');
    predicates.push('(e.updated_at < ? OR (e.updated_at = ? AND e.id < ?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const rows = await readEvents(
    db,
    `SELECT * FROM (
      SELECT e.* FROM events e WHERE e.status = 'open'
      UNION ALL
      SELECT * FROM (
        SELECT e.* FROM events e WHERE ${predicates.join(' AND ')}
        ORDER BY e.updated_at DESC, e.id DESC LIMIT 21
      )
    )
    ORDER BY updated_at DESC, id DESC`,
    values,
  );
  const history = rows.filter((event) => event.status !== 'open');
  const extra = history[20];
  const last = history[19];
  return {
    events: rows.filter((event) => event.id !== extra?.id),
    nextCursor: extra && last ? JSON.stringify([last.updatedAt, last.id]) : null,
  };
}
// The private token gates every statement after the optimistic parent update.
// A stale writer cannot accidentally mutate children belonging to version + 1.
const guard = 'EXISTS (SELECT 1 FROM events WHERE id = ? AND write_token = ?)';
function endSuppressions(db: D1Database, id: string, token: string, now: number) {
  return [
    db
      .prepare(`DELETE FROM event_suppressions WHERE event_id = ? AND starts_at >= ? AND ${guard}`)
      .bind(id, now, id, token),
    db
      .prepare(
        `UPDATE event_suppressions SET ends_at = ? WHERE event_id = ? AND starts_at < ?
      AND (ends_at IS NULL OR ends_at > ?) AND ${guard}`,
      )
      .bind(now, id, now, now, id, token),
  ];
}
function addAssociations(db: D1Database, id: string, token: string, config: EventConfig, now: number) {
  return config.monitorIds.flatMap((monitorId) => [
    db
      .prepare(
        `INSERT INTO event_monitors(event_id, monitor_key, monitor_id, monitor_name)
      SELECT ?, id, id, name FROM monitors WHERE id = ? AND ${guard}`,
      )
      .bind(id, monitorId, id, token),
    db
      .prepare(
        `INSERT INTO event_suppressions(id, event_id, monitor_id, starts_at, ends_at)
      SELECT ?, ?, id, ?, ? FROM monitors WHERE id = ? AND ${guard}
      AND (SELECT status FROM events WHERE id = ?) = 'open' AND (? IS NULL OR ? > ?)`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        Math.max(config.startsAt ?? now, now),
        config.endsAt,
        monitorId,
        id,
        token,
        id,
        config.endsAt,
        config.endsAt,
        now,
      ),
  ]);
}
export async function createEvent(db: D1Database, config: EventConfig, now = Date.now()) {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const writes = await db.batch([
    db
      .prepare(
        `INSERT INTO events(id, title, body, type, source, starts_at, ends_at, started_at, created_at, updated_at, write_token)
      SELECT ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM monitors WHERE id IN (SELECT value FROM json_each(?))) = ?`,
      )
      .bind(
        id,
        config.title,
        config.body,
        config.type,
        config.startsAt,
        config.endsAt,
        now,
        now,
        now,
        token,
        JSON.stringify(config.monitorIds),
        config.monitorIds.length,
      ),
    ...addAssociations(db, id, token, config, now),
  ]);
  if (!writes[0].meta.changes) throw new ValidationError('event_monitor_not_found');
  return (await getEvent(db, id))!;
}
export async function editEvent(
  db: D1Database,
  id: string,
  version: number,
  config: EventConfig,
  now = Date.now(),
) {
  const token = crypto.randomUUID();
  const writes = await db.batch([
    db
      .prepare(
        `UPDATE events SET title = ?, body = ?, type = ?, starts_at = ?, ends_at = ?,
      updated_at = ?, version = version + 1, write_token = ? WHERE id = ? AND version = ? AND source = 'manual'
      AND (SELECT COUNT(*) FROM monitors WHERE id IN (SELECT value FROM json_each(?))) = ?
      AND (? > 0 OR EXISTS (SELECT 1 FROM event_monitors WHERE event_id = events.id AND monitor_id IS NULL))`,
      )
      .bind(
        config.title,
        config.body,
        config.type,
        config.startsAt,
        config.endsAt,
        now,
        token,
        id,
        version,
        JSON.stringify(config.monitorIds),
        config.monitorIds.length,
        config.monitorIds.length,
      ),
    ...endSuppressions(db, id, token, now),
    db
      .prepare(`DELETE FROM event_monitors WHERE event_id = ? AND monitor_id IS NOT NULL AND ${guard}`)
      .bind(id, id, token),
    ...addAssociations(db, id, token, config, now),
  ]);
  if (!writes[0].meta.changes) throw new ConflictError('event_edit_conflict');
  return (await getEvent(db, id))!;
}
export async function appendEventUpdate(
  db: D1Database,
  id: string,
  version: number,
  config: EventUpdateConfig,
  now = Date.now(),
) {
  const event = await getEvent(db, id);
  if (!event || event.version !== version) throw new ConflictError('event_changed');
  const { title, body, resolve } = resolveEventUpdateConfig(event, config);
  const token = crypto.randomUUID();
  const writes = await db.batch([
    db
      .prepare(
        `UPDATE events SET updated_at = ?, version = version + 1, write_token = ?,
      status = CASE WHEN ? THEN 'resolved' ELSE status END, ended_at = CASE WHEN ? THEN ? ELSE ended_at END
      WHERE id = ? AND version = ? AND (? = 0 OR (source = 'manual' AND status = 'open'))`,
      )
      .bind(now, token, Number(resolve), Number(resolve), now, id, version, Number(resolve)),
    db
      .prepare(
        `INSERT INTO event_updates(id, event_id, title, body, status, source, created_at)
      SELECT ?, ?, ?, ?, ?, 'manual', ? WHERE ${guard}`,
      )
      .bind(crypto.randomUUID(), id, title, body, resolve ? 'resolved' : null, now, id, token),
    ...(resolve ? endSuppressions(db, id, token, now) : []),
  ]);
  if (!writes[0].meta.changes) throw new ConflictError('event_update_conflict');
  return (await getEvent(db, id))!;
}
export async function deleteEvent(db: D1Database, id: string, version: number, now = Date.now()) {
  const token = crypto.randomUUID();
  const writes = await db.batch([
    db
      .prepare(
        `UPDATE events SET write_token = ?, version = version + 1 WHERE id = ? AND version = ?
      AND (source = 'manual' OR status != 'open')`,
      )
      .bind(token, id, version),
    ...endSuppressions(db, id, token, now),
    db.prepare('DELETE FROM events WHERE id = ? AND write_token = ?').bind(id, token),
  ]);
  if (!writes[0].meta.changes) throw new ConflictError('event_delete_conflict');
}

export async function bulkDeleteEvents(db: D1Database, items: EventDeleteItem[], now = Date.now()) {
  const token = crypto.randomUUID();
  const requested = JSON.stringify(items);
  const ids = "SELECT json_extract(value, '$.id') FROM json_each(?1)";
  const claimed = `SELECT id FROM events WHERE id IN (${ids}) AND write_token = ?2`;
  const writes = await db.batch([
    db
      .prepare(
        // Materialize validation before any version changes. Every later write
        // is guarded by this batch's token, so a conflict leaves no side effects.
        `WITH requested AS MATERIALIZED (
          SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.version') AS version
          FROM json_each(?1)
        ), valid AS MATERIALIZED (
          SELECT (SELECT COUNT(*) FROM requested) > 0
            AND (SELECT COUNT(*) FROM requested) = (SELECT COUNT(DISTINCT id) FROM requested)
            AND NOT EXISTS (
              SELECT 1 FROM requested r LEFT JOIN events e ON e.id = r.id
              WHERE e.id IS NULL OR e.version != r.version OR (e.source = 'automatic' AND e.status = 'open')
            ) AS ok
        )
        UPDATE events SET write_token = ?2, version = version + 1
        WHERE id IN (SELECT id FROM requested) AND (SELECT ok FROM valid)`,
      )
      .bind(requested, token),
    db
      .prepare(`DELETE FROM event_suppressions WHERE event_id IN (${claimed}) AND starts_at >= ?3`)
      .bind(requested, token, now),
    db
      .prepare(
        `UPDATE event_suppressions SET ends_at = ?3 WHERE event_id IN (${claimed})
        AND starts_at < ?3 AND (ends_at IS NULL OR ends_at > ?3)`,
      )
      .bind(requested, token, now),
    db.prepare(`DELETE FROM events WHERE id IN (${ids}) AND write_token = ?2`).bind(requested, token),
  ]);
  if (!writes[0].meta.changes) throw new ConflictError('event_bulk_delete_conflict');
  return items.length;
}
