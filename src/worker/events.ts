import type { AdminEvent, EventConfig, EventUpdateConfig, MonitorGroup, StatusEvent } from '../shared/types';
import { resolveEventUpdateConfig } from '../shared/events';
import { ValidationError } from '../shared/validation';

export class ConflictError extends Error {}
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
  if (!result.meta.changes) throw new ConflictError('分组已被修改或名称已存在，请刷新后重试。');
  return (await listGroups(db)).find((group) => group.id === groupId)!;
}
export async function assertGroup(db: D1Database, id: string | null | undefined) {
  if (id && !(await db.prepare('SELECT id FROM monitor_groups WHERE id = ?').bind(id).first()))
    throw new ValidationError('分组不存在，请刷新后重新选择');
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
    monitors: (monitors.results as unknown as (AdminEvent['monitors'][number] & { event_id: string })[])
      .filter((item) => item.event_id === row.id)
      .map(({ id, name }) => ({ id, name })),
    updates: (updates.results as unknown as (AdminEvent['updates'][number] & { event_id: string })[])
      .filter((item) => item.event_id === row.id)
      .map(({ event_id: _eventId, ...item }) => item),
  }));
}
export async function getEvent(db: D1Database, id: string) {
  return (await readEvents(db, 'SELECT e.* FROM events e WHERE e.id = ?', [id]))[0] ?? null;
}
export async function listPublicEvents(db: D1Database, monitorId?: string): Promise<StatusEvent[]> {
  const rows = await readEvents(
    db,
    `WITH scoped AS (
      SELECT e.* FROM events e ${
        monitorId
          ? 'WHERE EXISTS (SELECT 1 FROM event_monitors em WHERE em.event_id = e.id AND em.monitor_id = ?)'
          : ''
      }
    )
    SELECT * FROM scoped
    WHERE status = 'open' OR id IN (
      SELECT id FROM scoped WHERE status != 'open' ORDER BY updated_at DESC, id DESC LIMIT 20
    )
    ORDER BY updated_at DESC, id DESC`,
    monitorId ? [monitorId] : [],
  );
  return rows.map(publicEvent);
}
export async function listEvents(db: D1Database, options: { monitorId?: string; cursor?: string } = {}) {
  const predicates: string[] = [];
  const values: (string | number)[] = [];
  if (options.monitorId) {
    predicates.push(
      'EXISTS (SELECT 1 FROM event_monitors em WHERE em.event_id = e.id AND em.monitor_id = ?)',
    );
    values.push(options.monitorId);
  }
  if (options.cursor) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(options.cursor);
    } catch {
      throw new ValidationError('分页游标无效');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      !Number.isSafeInteger(cursor[0]) ||
      typeof cursor[1] !== 'string'
    )
      throw new ValidationError('分页游标无效');
    predicates.push('(e.updated_at < ? OR (e.updated_at = ? AND e.id < ?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const rows = await readEvents(
    db,
    `SELECT e.* FROM events e ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''}
      ORDER BY e.updated_at DESC, e.id DESC LIMIT 21`,
    values,
  );
  const page = rows.slice(0, 20);
  const last = page.at(-1);
  return {
    events: page,
    nextCursor: rows.length > 20 && last ? JSON.stringify([last.updatedAt, last.id]) : null,
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
  const slots = config.monitorIds.map(() => '?').join(',');
  const writes = await db.batch([
    db
      .prepare(
        `INSERT INTO events(id, title, body, type, source, starts_at, ends_at, started_at, created_at, updated_at, write_token)
      SELECT ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM monitors WHERE id IN (${slots})) = ?`,
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
        ...config.monitorIds,
        config.monitorIds.length,
      ),
    ...addAssociations(db, id, token, config, now),
  ]);
  if (!writes[0].meta.changes) throw new ValidationError('关联节点不存在，请刷新后重新选择');
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
  const slots = config.monitorIds.map(() => '?').join(',') || 'NULL';
  const writes = await db.batch([
    db
      .prepare(
        `UPDATE events SET title = ?, body = ?, type = ?, starts_at = ?, ends_at = ?,
      updated_at = ?, version = version + 1, write_token = ? WHERE id = ? AND version = ? AND source = 'manual'
      AND (SELECT COUNT(*) FROM monitors WHERE id IN (${slots})) = ?
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
        ...config.monitorIds,
        config.monitorIds.length,
        config.monitorIds.length,
      ),
    ...endSuppressions(db, id, token, now),
    db
      .prepare(`DELETE FROM event_monitors WHERE event_id = ? AND monitor_id IS NOT NULL AND ${guard}`)
      .bind(id, id, token),
    ...addAssociations(db, id, token, config, now),
  ]);
  if (!writes[0].meta.changes)
    throw new ConflictError('事件或关联节点已变更；自动事件不能编辑，请刷新后重试。');
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
  if (!event || event.version !== version) throw new ConflictError('事件已变更，请刷新后重试。');
  // Preserve the legacy completion conflict while fixed choices are validated below.
  if (config.title === null && config.resolve && (event.source !== 'manual' || event.status !== 'open'))
    throw new ConflictError('该事件状态由检测维护，或事件已结束，请刷新后重试。');
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
  if (!writes[0].meta.changes) throw new ConflictError('事件已变更，或该事件状态由检测维护，请刷新后重试。');
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
  if (!writes[0].meta.changes) throw new ConflictError('事件已变更，或自动事件仍在进行中，请刷新后重试。');
}
