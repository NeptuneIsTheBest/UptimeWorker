import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { AdminEvent, EventConfig, EventDeleteItem } from '../../../src/shared/events/types';
import {
  appendEventUpdate,
  bulkDeleteEvents,
  createEvent,
  deleteEvent,
  getEvent,
} from '../../../src/worker/features/events/repository';
import { createMonitor } from '../../../src/worker/features/monitors/repository';
import { adminHeaders, apiClient } from '../../support/api-client';
import { databaseFixture, httpConfig, resetDatabase, timestamp } from '../../support/fixtures';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let monitorId: string;
const at = (minutes: number) => timestamp + minutes * 60_000;
const items = (events: AdminEvent[]): EventDeleteItem[] => events.map(({ id, version }) => ({ id, version }));

beforeAll(async () => {
  fixture = await databaseFixture();
});
afterAll(async () => {
  await fixture?.dispose();
});
beforeEach(async () => {
  await resetDatabase(fixture.db);
  monitorId = (await createMonitor(fixture.db, httpConfig, timestamp))!.id;
});

const publish = (changes: Partial<EventConfig> = {}) =>
  createEvent(
    fixture.db,
    {
      title: '批量删除测试',
      body: '事件说明',
      type: 'incident',
      monitorIds: [monitorId],
      startsAt: null,
      endsAt: null,
      ...changes,
    },
    timestamp,
  );

async function automatic(status: AdminEvent['status']) {
  const id = crypto.randomUUID();
  await fixture.db.batch([
    fixture.db
      .prepare(
        `INSERT INTO events(id, title, body, type, source, status, started_at, created_at, updated_at)
      VALUES (?, '自动故障', '检测失败', 'incident', 'automatic', ?, ?, ?, ?)`,
      )
      .bind(id, status, timestamp, timestamp, timestamp),
    fixture.db
      .prepare(
        `INSERT INTO event_monitors(event_id, monitor_key, monitor_id, monitor_name)
      VALUES (?, ?, ?, '测试节点')`,
      )
      .bind(id, monitorId, monitorId),
  ]);
  return (await getEvent(fixture.db, id))!;
}

async function snapshot() {
  return (
    await fixture.db.batch(
      ['events', 'event_monitors', 'event_updates', 'event_suppressions', 'monitors', 'monitor_outages'].map(
        (table) => fixture.db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`),
      ),
    )
  ).map((result) => result.results);
}

it('deletes mixed eligible events and their children while preserving unselected events and monitors', async () => {
  const open = await publish();
  const progress = await appendEventUpdate(
    fixture.db,
    open.id,
    open.version,
    { title: 'Updated', body: '进展' },
    at(1),
  );
  const closed = await publish();
  const resolved = await appendEventUpdate(
    fixture.db,
    closed.id,
    closed.version,
    { title: 'Resolved', body: '已恢复' },
    at(1),
  );
  const maintenance = await publish({ type: 'maintenance', startsAt: at(2), endsAt: at(6) });
  const recovered = await automatic('resolved');
  const stopped = await automatic('stopped');
  const untouched = await publish({ title: '保留' });
  const targets = [progress, resolved, maintenance, recovered, stopped];
  const { request } = apiClient(fixture.db);
  const response = await request('admin/events/bulk-delete', 'POST', { items: items(targets) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, deletedCount: 5 });
  expect(response.headers.get('cache-control')).toBe('no-store');
  for (const event of targets) {
    expect(await getEvent(fixture.db, event.id)).toBeNull();
    expect((await request(`events/${event.id}`)).status).toBe(404);
  }
  expect(await getEvent(fixture.db, untouched.id)).toEqual(untouched);
  expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM event_monitors').first('n')).toBe(1);
  expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM event_updates').first('n')).toBe(0);
  expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM monitors').first('n')).toBe(1);
});

it('rejects invalid selections without writes', async () => {
  const event = await publish();
  const selected = items([event]);
  const before = await snapshot();
  const { request } = apiClient(fixture.db);
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    'events',
    [null],
    [[]],
    ['id'],
    [selected[0], selected[0]],
    [{ ...selected[0], id: '' }],
    [{ ...selected[0], id: ' ' }],
    [{ ...selected[0], id: 'a'.repeat(101) }],
    [{ id: event.id }],
    [{ ...selected[0], version: 0 }],
    [{ ...selected[0], version: -1 }],
    [{ ...selected[0], version: 1.5 }],
    [{ ...selected[0], version: '1' }],
    [{ ...selected[0], version: null }],
    [{ ...selected[0], version: Number.MAX_SAFE_INTEGER + 1 }],
  ]) {
    const response = await request('admin/events/bulk-delete', 'POST', { items: invalid });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('code');
  }
  expect((await request('admin/events/bulk-delete', 'POST', undefined, { body: '{broken' })).status).toBe(
    400,
  );
  expect(await snapshot()).toEqual(before);
});

it.each(['missing', 'stale', 'open automatic'] as const)(
  'rejects the entire batch when an event is %s',
  async (conflict) => {
    const first = await publish();
    const last = await publish();
    const invalid = conflict === 'open automatic' ? await automatic('open') : await publish();
    if (conflict === 'stale')
      await appendEventUpdate(
        fixture.db,
        invalid.id,
        invalid.version,
        { title: 'Updated', body: '并发更新' },
        at(1),
      );
    if (conflict === 'missing') await deleteEvent(fixture.db, invalid.id, invalid.version, at(1));
    const before = await snapshot();
    const { request } = apiClient(fixture.db);
    const response = await request('admin/events/bulk-delete', 'POST', {
      items: items([first, invalid, last]),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'event_bulk_delete_conflict' });
    expect(await snapshot()).toEqual(before);
  },
);

it('allows only one of two overlapping concurrent deletions and preserves the losing batch remainder', async () => {
  const a = await publish({ title: 'A' });
  const b = await publish({ title: 'B' });
  const c = await publish({ title: 'C' });
  const { request } = apiClient(fixture.db);
  const results = await Promise.all([
    request('admin/events/bulk-delete', 'POST', { items: items([a, b]) }),
    request('admin/events/bulk-delete', 'POST', { items: items([b, c]) }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const survivor = results[0].status === 200 ? c : a;
  expect(await getEvent(fixture.db, survivor.id)).toEqual(survivor);
  expect(await getEvent(fixture.db, b.id)).toBeNull();
  expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(1);
  expect(
    await fixture.db
      .prepare('SELECT ends_at FROM event_suppressions WHERE event_id = ?')
      .bind(survivor.id)
      .first('ends_at'),
  ).toBeNull();
});

it('keeps past suppression windows, ends active ones, and removes future windows including an exact start', async () => {
  const active = await publish();
  const maintenance = (start: number, end: number) =>
    publish({ type: 'maintenance', startsAt: at(start), endsAt: at(end) });
  const targets = [
    active,
    await maintenance(2, 9),
    await maintenance(1, 3),
    await maintenance(6, 9),
    await maintenance(5, 9),
    await maintenance(2, 5),
  ];
  const untouched = await publish();
  const before = (
    await fixture.db
      .prepare('SELECT id, event_id FROM event_suppressions')
      .all<{ id: string; event_id: string }>()
  ).results;
  expect(await bulkDeleteEvents(fixture.db, items(targets), at(5))).toBe(6);
  const expectedEnds = [at(5), at(5), at(3), undefined, undefined, at(5)];
  for (const [index, event] of targets.entries()) {
    const suppression = await fixture.db
      .prepare('SELECT event_id, ends_at FROM event_suppressions WHERE id = ?')
      .bind(before.find((row) => row.event_id === event.id)!.id)
      .first();
    expect(suppression).toEqual(
      expectedEnds[index] === undefined ? null : { event_id: null, ends_at: expectedEnds[index] },
    );
    expect(await getEvent(fixture.db, event.id)).toBeNull();
  }
  expect(await getEvent(fixture.db, untouched.id)).toEqual(untouched);
  expect(
    await fixture.db
      .prepare('SELECT ends_at FROM event_suppressions WHERE event_id = ?')
      .bind(untouched.id)
      .first('ends_at'),
  ).toBeNull();
});

it('rolls back claims, suppression changes and cascades when deletion fails midway', async () => {
  const active = await publish();
  const future = await publish({ type: 'maintenance', startsAt: at(8), endsAt: at(9) });
  const before = await snapshot();
  await fixture.db
    .prepare(
      `CREATE TRIGGER reject_bulk_delete BEFORE DELETE ON events
    WHEN OLD.id = '${future.id}' BEGIN SELECT RAISE(ABORT, 'delete failed'); END`,
    )
    .run();
  try {
    await expect(bulkDeleteEvents(fixture.db, items([active, future]), at(5))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  } finally {
    await fixture.db.prepare('DROP TRIGGER reject_bulk_delete').run();
  }
});

it('deletes over one hundred events with a payload larger than 16 KiB using bounded SQL parameters', async () => {
  const targets = Array.from({ length: 300 }, () => ({ id: crypto.randomUUID(), version: 1 }));
  await fixture.db
    .prepare(
      `INSERT INTO events(id, title, body, type, source, started_at, created_at, updated_at)
    SELECT json_extract(value, '$.id'), '批量事件', '说明', 'incident', 'manual', ?2, ?2, ?2 FROM json_each(?1)`,
    )
    .bind(JSON.stringify(targets), timestamp)
    .run();
  const body = { items: targets };
  expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeGreaterThan(16 * 1024);
  const { request } = apiClient(fixture.db);
  const response = await request('admin/events/bulk-delete', 'POST', body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, deletedCount: 300 });
  expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
});

it('enforces authentication, same-origin JSON and the route-specific envelope limit', async () => {
  const event = await publish();
  const body = { items: items([event]) };
  const { request } = apiClient(fixture.db);
  const path = 'admin/events/bulk-delete';
  const before = await snapshot();
  expect((await request(path, 'POST', body, { headers: {} })).status).toBe(401);
  expect(
    (
      await request(path, 'POST', body, {
        headers: { ...adminHeaders, 'Cf-Access-Jwt-Assertion': 'invalid' },
      })
    ).status,
  ).toBe(401);
  expect(
    (await request(path, 'POST', body, { headers: { ...adminHeaders, Origin: 'https://elsewhere.test' } }))
      .status,
  ).toBe(403);
  expect(
    (await request(path, 'POST', body, { headers: { ...adminHeaders, 'Content-Type': 'text/plain' } }))
      .status,
  ).toBe(415);
  expect((await request(path, 'POST', { ...body, padding: 'x'.repeat(256 * 1024) })).status).toBe(413);
  expect((await request('admin/events', 'POST', { padding: 'x'.repeat(16 * 1024) })).status).toBe(413);
  expect(await snapshot()).toEqual(before);
});
