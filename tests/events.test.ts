import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEventConfig, eventLabel } from '../src/shared/events';
import { createMonitor, findMonitor, getHistory, getStatus, updateMonitor } from '../src/worker/repository';
import {
  appendEventUpdate,
  createEvent,
  deleteEvent,
  editEvent,
  getEvent,
  listEvents,
  saveGroup,
} from '../src/worker/events';
import { runScheduled } from '../src/worker/scheduler';
import { apiClient } from './api-client';
import { databaseFixture, environment, httpConfig, resetDatabase, success, timestamp } from './helpers';
import type { AdminEvent, EventConfig, StatusEvent } from '../src/shared/types';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
beforeAll(async () => {
  fixture = await databaseFixture();
});
afterAll(async () => {
  await fixture?.dispose();
});
beforeEach(async () => {
  await resetDatabase(fixture.db);
});
const minute = 60_000;
const at = (n: number) => timestamp + n * minute;
const node = (intervalMinutes = 1) =>
  createMonitor(fixture.db, { ...httpConfig, intervalMinutes }, timestamp).then((row) => row!);
const tick = (n: number, ok = false) =>
  runScheduled(
    { DB: fixture.db },
    at(n),
    async () => ({
      ...success(at(n)),
      ok,
      errorCode: ok ? null : 'network',
      httpStatus: ok ? 200 : null,
    }),
    () => at(n),
  );
const recent = () => listEvents(fixture.db).then((result) => result.events);
const config = (id: string, changes: Partial<EventConfig> = {}): EventConfig => ({
  title: '节点故障说明',
  body: '正在处理',
  type: 'incident',
  monitorIds: [id],
  startsAt: null,
  endsAt: null,
  ...changes,
});

describe('events and groups', () => {
  it('validates event content, node selection and maintenance dates', () => {
    const base = config('monitor');
    expect(parseEventConfig({ ...base, monitorIds: ['monitor', 'monitor'] }).monitorIds).toEqual(['monitor']);
    for (const change of [
      { title: '' },
      { body: '' },
      { monitorIds: [] },
      { type: 'other' },
      { type: 'maintenance', startsAt: 3, endsAt: 3 },
      { type: 'maintenance', startsAt: '1', endsAt: 5 },
    ])
      expect(() => parseEventConfig({ ...base, ...change })).toThrow();
  });
  it('keeps current state and failure streaks when changing names/groups; deleting groups ungroups nodes', async () => {
    const row = await node();
    const group = await saveGroup(fixture.db, { name: '亚洲', sortOrder: 2 });
    await tick(0);
    const changed = await updateMonitor(
      fixture.db,
      row.id,
      1,
      { ...httpConfig, intervalMinutes: 1, name: '新名称', groupId: group.id },
      at(0),
    );
    expect(changed).toMatchObject({
      last_ok: 0,
      last_checked_at: at(0),
      next_check_at: at(1),
      group_id: group.id,
    });
    await fixture.db.prepare('DELETE FROM monitor_groups WHERE id = ?').bind(group.id).run();
    expect((await findMonitor(fixture.db, row.id))?.group_id).toBeNull();
    for (let n = 1; n <= 5; n++) await tick(n);
    expect(await recent()).toHaveLength(1);
    expect((await recent())[0].title).toContain('新名称');
  });
  it('publishes once at the threshold, resolves once, and starts a new incident after recovery', async () => {
    const row = await node();
    for (let n = 0; n < 5; n++) await tick(n);
    expect(await recent()).toHaveLength(0);
    await tick(5);
    await tick(5);
    await tick(6);
    const event = (await recent())[0];
    expect(event).toMatchObject({ source: 'automatic', status: 'open', startedAt: at(0), createdAt: at(5) });
    expect(await recent()).toHaveLength(1);
    await tick(7, true);
    await tick(8, true);
    expect(await getEvent(fixture.db, event.id)).toMatchObject({
      status: 'resolved',
      endedAt: at(7),
      updates: [{ status: 'resolved' }],
    });
    for (let n = 9; n <= 14; n++) await tick(n);
    expect(await recent()).toHaveLength(2);
    const publicData = await getStatus(environment(fixture.db), at(14));
    expect(publicData.events?.[0]).not.toHaveProperty('version');
    expect(JSON.stringify(publicData.events)).not.toContain(httpConfig.url);
    expect((await getHistory(fixture.db, row.id, at(14)))?.events).toHaveLength(2);
  });
  it('clears short failures and does not infer downtime across stale gaps', async () => {
    await node();
    await tick(0);
    await tick(1, true);
    await tick(2);
    await tick(10);
    expect(await recent()).toHaveLength(0);
    for (let n = 11; n <= 15; n++) await tick(n);
    expect((await recent())[0].startedAt).toBe(at(10));
  });
  it('waits for a confirming failed probe when the interval exceeds the threshold', async () => {
    await node(10);
    await tick(0);
    await tick(5);
    expect(await recent()).toHaveLength(0);
    await tick(10);
    expect((await recent())[0]).toMatchObject({ startedAt: at(0), createdAt: at(10) });
  });
  it('resets pending state on configuration changes and pause without resolving existing incidents', async () => {
    const row = await node();
    await tick(0);
    await tick(1);
    await updateMonitor(
      fixture.db,
      row.id,
      1,
      { ...httpConfig, intervalMinutes: 1, timeoutSeconds: 11 },
      at(2),
    );
    for (let n = 2; n <= 7; n++) await tick(n);
    expect((await recent())[0].startedAt).toBe(at(2));
    await updateMonitor(fixture.db, row.id, 2, { ...httpConfig, intervalMinutes: 1, enabled: false }, at(8));
    await tick(8, true);
    expect((await recent())[0].status).toBe('open');
    await updateMonitor(fixture.db, row.id, 3, { ...httpConfig, intervalMinutes: 1 }, at(9));
    await tick(9, true);
    expect((await recent())[0].status).toBe('resolved');
  });
  it('suppresses maintenance at the inclusive start and restarts at the exclusive end', async () => {
    const row = await node();
    const maintenance = await createEvent(
      fixture.db,
      config(row.id, { type: 'maintenance', startsAt: at(3), endsAt: at(8) }),
      at(0),
    );
    for (let n = 0; n <= 12; n++) await tick(n);
    expect(await recent()).toHaveLength(1);
    await tick(13);
    expect((await recent())[0]).toMatchObject({ source: 'automatic', startedAt: at(8) });
    expect(eventLabel(maintenance, at(2))).toBe('待开始');
    expect(eventLabel(maintenance, at(3))).toBe('维护进行中');
    expect(eventLabel(maintenance, at(8))).toBe('已过计划时间');
    expect((await getEvent(fixture.db, maintenance.id))?.status).toBe('open');
  });
  it('breaks a streak for maintenance entirely between probes, even if later deleted', async () => {
    const row = await node(10);
    const maintenance = await createEvent(
      fixture.db,
      config(row.id, { type: 'maintenance', startsAt: at(3), endsAt: at(6) }),
      at(0),
    );
    await tick(0);
    await deleteEvent(fixture.db, maintenance.id, 1, at(8));
    await tick(10);
    expect(await recent()).toHaveLength(0);
    await tick(20);
    expect((await recent())[0].startedAt).toBe(at(10));
  });
  it('overlapping maintenance stays suppressed until all windows end; early completion ends one window', async () => {
    const row = await node();
    const first = await createEvent(
      fixture.db,
      config(row.id, { type: 'maintenance', startsAt: at(0), endsAt: at(20) }),
      at(0),
    );
    await createEvent(
      fixture.db,
      config(row.id, { type: 'maintenance', startsAt: at(0), endsAt: at(8) }),
      at(0),
    );
    for (let n = 0; n <= 3; n++) await tick(n);
    await appendEventUpdate(fixture.db, first.id, 1, '提前完成', true, at(4));
    for (let n = 4; n <= 12; n++) await tick(n);
    expect(await recent()).toHaveLength(2);
    await tick(13);
    expect((await recent())[0]).toMatchObject({ source: 'automatic', startedAt: at(8) });
  });
  it('avoids duplicate manual incidents, protects their status, and resolves existing automatic incidents during suppression', async () => {
    const row = await node();
    const manual = await createEvent(fixture.db, config(row.id), at(0));
    for (let n = 0; n <= 6; n++) await tick(n);
    await tick(7, true);
    expect((await recent())[0].status).toBe('open');
    await appendEventUpdate(fixture.db, manual.id, 1, '已处理', true, at(8));
    for (let n = 8; n <= 13; n++) await tick(n);
    expect(await recent()).toHaveLength(2);
    await createEvent(fixture.db, config(row.id), at(14));
    await tick(14, true);
    expect((await recent()).find((event) => event.source === 'automatic')?.status).toBe('resolved');
  });
  it('disabling automatic publication resets pending timers but still resolves published incidents', async () => {
    await node();
    for (let n = 0; n <= 5; n++) await tick(n);
    await fixture.db.prepare('UPDATE global_settings SET auto_incident_after_minutes = 0').run();
    await tick(6, true);
    expect((await recent())[0].status).toBe('resolved');
    await tick(7);
    await tick(8);
    await fixture.db.prepare('UPDATE global_settings SET auto_incident_after_minutes = 5').run();
    for (let n = 9; n <= 13; n++) await tick(n);
    expect(await recent()).toHaveLength(1);
    await tick(14);
    expect((await recent())[0].startedAt).toBe(at(9));
  });
  it('retains snapshots and stops tracking when a node is deleted', async () => {
    const row = await node();
    for (let n = 0; n <= 5; n++) await tick(n);
    await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(row.id).run();
    const event = (await recent())[0];
    expect(event).toMatchObject({
      status: 'stopped',
      monitors: [{ id: null, name: row.name }],
      updates: [{ status: 'stopped' }],
    });
    expect((await getStatus(environment(fixture.db))).events).toMatchObject([
      { id: event.id, status: 'stopped', monitors: event.monitors, updates: event.updates },
    ]);
    expect((await fixture.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
  it('applies multi-node edits and progress atomically and rejects stale writers', async () => {
    const a = await node();
    const b = await node();
    const event = await createEvent(fixture.db, config(a.id), at(0));
    const edited = await editEvent(
      fixture.db,
      event.id,
      1,
      config(a.id, { monitorIds: [a.id, b.id], body: '两台节点' }),
      at(1),
    );
    await expect(editEvent(fixture.db, event.id, 1, config(b.id), at(2))).rejects.toThrow();
    expect((await getEvent(fixture.db, event.id))?.monitors).toHaveLength(2);
    const results = await Promise.allSettled([
      appendEventUpdate(fixture.db, event.id, edited.version, '完成', true, at(3)),
      appendEventUpdate(fixture.db, event.id, edited.version, '竞争更新', false, at(3)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getEvent(fixture.db, event.id))?.updates).toHaveLength(1);
    await expect(createEvent(fixture.db, config('missing'), at(4))).rejects.toThrow();
    expect(await recent()).toHaveLength(1);
  });
  it('rolls back automatic events and failure tracking with a failed check batch', async () => {
    const row = await node();
    for (let n = 0; n < 5; n++) await tick(n);
    await expect(
      fixture.db.batch([
        fixture.db
          .prepare(
            `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
        VALUES (?, 1, ?, ?, 0, 1)`,
          )
          .bind(row.id, at(5), at(5)),
        fixture.db.prepare('INSERT INTO monitor_groups(id, name, created_at) VALUES (NULL, NULL, 0)'),
      ]),
    ).rejects.toThrow();
    expect(await recent()).toHaveLength(0);
    expect((await findMonitor(fixture.db, row.id))?.last_checked_at).toBe(at(4));
    await tick(5);
    expect(await recent()).toHaveLength(1);
  });
  it('preserves deleted-node snapshots when editing shared and orphaned manual events', async () => {
    const a = await node();
    const b = await node();
    const event = await createEvent(fixture.db, config(a.id, { monitorIds: [a.id, b.id] }), at(0));
    await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(a.id).run();
    const edited = await editEvent(fixture.db, event.id, 1, config(b.id, { title: '保留原关联' }), at(1));
    expect(edited.monitors).toHaveLength(2);
    expect(edited.monitors.filter((monitor) => monitor.id === null)).toHaveLength(1);
    await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(b.id).run();
    const { request } = apiClient(fixture.db);
    const changed = await request(`admin/events/${event.id}`, 'PATCH', {
      ...config(b.id),
      title: '历史故障说明',
      monitorIds: [],
      version: edited.version,
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      title: '历史故障说明',
      monitors: [
        { id: null, name: a.name },
        { id: null, name: b.name },
      ],
    });
    expect((await request('admin/events', 'POST', { ...config(a.id), monitorIds: [] })).status).toBe(400);
  });
  it('protects automatic lifecycle and keeps immediate connection tests out of events', async () => {
    const row = await node();
    for (let n = 0; n <= 5; n++) await tick(n);
    const event = (await recent())[0];
    const { request } = apiClient(fixture.db);
    expect((await request(`admin/monitors/${row.id}/test`, 'POST', {})).status).toBe(200);
    expect((await getEvent(fixture.db, event.id))?.status).toBe('open');
    expect((await request(`admin/events/${event.id}`, 'DELETE', { version: event.version })).status).toBe(
      409,
    );
    expect(
      (await request(`admin/events/${event.id}`, 'PATCH', { ...config(row.id), version: event.version }))
        .status,
    ).toBe(409);
    expect(
      (
        await request(`admin/events/${event.id}/updates`, 'POST', {
          version: event.version,
          body: '手动完成',
          resolve: true,
        })
      ).status,
    ).toBe(409);
    expect((await getEvent(fixture.db, event.id))?.updates).toHaveLength(0);
    await tick(6, true);
    const resolved = (await recent())[0];
    expect(
      (await request(`admin/events/${resolved.id}`, 'DELETE', { version: resolved.version })).status,
    ).toBe(200);
    expect(await recent()).toHaveLength(0);
  });
  it('does not publish from checks invalidated by an edit, an expired lease, or out-of-order time', async () => {
    const row = await node();
    for (let n = 0; n < 5; n++) await tick(n);
    await runScheduled(
      { DB: fixture.db },
      at(5),
      async () => {
        await updateMonitor(
          fixture.db,
          row.id,
          1,
          { ...httpConfig, intervalMinutes: 1, name: '更名' },
          at(5),
        );
        return { ...success(at(5)), ok: false, errorCode: 'network' };
      },
      () => at(5),
    );
    expect(await recent()).toHaveLength(0);
    await fixture.db
      .prepare(
        `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES (?, 2, ?, ?, 1, 1)`,
      )
      .bind(row.id, at(5) + 1, at(2))
      .run();
    expect((await findMonitor(fixture.db, row.id))?.last_ok).toBe(0);
    let now = at(6);
    await runScheduled(
      { DB: fixture.db },
      at(6),
      async () => {
        now += 240_001;
        return { ...success(at(6)), ok: false, errorCode: 'network' };
      },
      () => now,
    );
    expect(await recent()).toHaveLength(0);
    await tick(11);
    expect(await recent()).toHaveLength(0);
    for (let n = 12; n <= 16; n++) await tick(n);
    expect((await recent())[0].startedAt).toBe(at(11));
  });
  it('returns all open events and the latest 20 closed events within each public scope', async () => {
    const first = await node();
    const second = await node();
    const open: AdminEvent[] = [];
    const closed: AdminEvent[] = [];
    for (let index = 0; index < 24; index++) {
      open.push(
        await createEvent(
          fixture.db,
          config(first.id, {
            title: `未结束 ${index}`,
            monitorIds: index === 0 ? [first.id, second.id] : [first.id],
            ...(index < 3
              ? { type: 'maintenance', startsAt: at(index * 40), endsAt: at(index * 40 + 20) }
              : {}),
          }),
          at(0),
        ),
      );
    }
    for (let index = 0; index < 22; index++) {
      const event = await createEvent(fixture.db, config(first.id, { title: `已结束 ${index}` }), at(1));
      closed.push(await appendEventUpdate(fixture.db, event.id, 1, '处理完成', true, at(10 + (index % 3))));
    }
    const unrelatedOpen = await createEvent(fixture.db, config(second.id, { title: '其他节点故障' }), at(30));
    const unrelated = await createEvent(fixture.db, config(second.id, { title: '其他节点已恢复' }), at(31));
    const unrelatedClosed = await appendEventUpdate(fixture.db, unrelated.id, 1, '已恢复', true, at(32));
    const newestFirst = (a: AdminEvent, b: AdminEvent) =>
      b.updatedAt - a.updatedAt || b.id.localeCompare(a.id);
    closed.sort(newestFirst);
    expect(open.slice(0, 3).map((event) => eventLabel(event, at(50)))).toEqual([
      '已过计划时间',
      '维护进行中',
      '待开始',
    ]);
    const { request } = apiClient(fixture.db);
    const cases: [string, AdminEvent[]][] = [
      ['status', [...open, unrelatedOpen, unrelatedClosed, ...closed.slice(0, 19)]],
      [`monitors/${first.id}/history`, [...open, ...closed.slice(0, 20)]],
      [`monitors/${second.id}/history`, [open[0], unrelatedOpen, unrelatedClosed]],
    ];
    for (const [path, expected] of cases) {
      const response = await request(path, 'GET', undefined, { headers: {} });
      expect(response.status).toBe(200);
      const { events } = (await response.json()) as { events: StatusEvent[] };
      expect(events).toEqual(expected.sort(newestFirst).map(({ version: _version, ...event }) => event));
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
      expect(JSON.stringify(events)).not.toContain(httpConfig.url);
    }
    expect((await listEvents(fixture.db)).events).toHaveLength(20);
  });
  it('paginates identical timestamps without duplicates and protects management APIs', async () => {
    const row = await node();
    for (let n = 0; n < 22; n++) await createEvent(fixture.db, config(row.id, { title: `事件 ${n}` }), at(0));
    const page = await listEvents(fixture.db);
    const next = await listEvents(fixture.db, { cursor: page.nextCursor! });
    expect(page.events).toHaveLength(20);
    expect(next.events).toHaveLength(2);
    expect(new Set([...page.events, ...next.events].map((event) => event.id)).size).toBe(22);
    const { request } = apiClient(fixture.db);
    for (const path of ['admin/groups', 'admin/events']) {
      expect((await request(path, 'GET', undefined, { headers: {} })).status).toBe(401);
      expect(
        (await request(path, 'POST', {}, { headers: { 'Content-Type': 'application/json' } })).status,
      ).toBe(401);
    }
    expect((await request('admin/events?cursor=bad')).status).toBe(400);
    const created = await request('admin/groups', 'POST', { name: '区域', sortOrder: 1 });
    expect(created.status).toBe(201);
    const group = (await created.json()) as { id: string; version: number };
    expect((await request(`admin/groups/${group.id}`, 'DELETE', { version: group.version + 1 })).status).toBe(
      409,
    );
    expect((await request('admin/monitors', 'POST', { ...httpConfig, groupId: 'missing' })).status).toBe(400);
    const event = page.events[0];
    expect(
      (
        await request(`admin/events/${event.id}/updates`, 'POST', {
          version: event.version,
          body: '确认完成',
          resolve: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request('admin/settings', 'PATCH', { version: 1, autoIncidentAfterMinutes: 1441 })).status,
    ).toBe(400);
    expect(
      (await request('admin/settings', 'PATCH', { version: 1, autoIncidentAfterMinutes: 0 })).status,
    ).toBe(200);
  });
});
