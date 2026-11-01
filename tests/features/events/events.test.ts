import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEventConfig } from '../../../src/shared/events/validation';
import { eventLabel } from '../../../src/web/features/events/labels';
import { eventTimeline, latestEventEntry } from '../../../src/web/features/events/presentation';
import { createMonitor, findMonitor, updateMonitor } from '../../../src/worker/features/monitors/repository';
import { getHistory, getStatus } from '../../../src/worker/features/status/queries';
import {
  appendEventUpdate,
  createEvent,
  deleteEvent,
  editEvent,
  getEvent,
  listEvents,
} from '../../../src/worker/features/events/repository';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { apiClient } from '../../support/api-client';
import {
  databaseFixture,
  environment,
  httpConfig,
  resetDatabase,
  success,
  timestamp,
} from '../../support/fixtures';
import type { AdminEvent, EventConfig, StatusEvent } from '../../../src/shared/events/types';

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
const databaseNow = () =>
  fixture.db
    .prepare("SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now")
    .first<number>('now')
    .then((now) => now!);
const config = (id: string, changes: Partial<EventConfig> = {}): EventConfig => ({
  title: '节点故障说明',
  body: '正在处理',
  type: 'incident',
  monitorIds: [id],
  startsAt: null,
  endsAt: null,
  ...changes,
});

describe('events', () => {
  it('creates and edits events with over one hundred associations without exceeding SQL parameters', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) ids.push((await node()).id);
    const { request } = apiClient(fixture.db);
    const created = await request('admin/events', 'POST', config(ids[0], { monitorIds: ids }));
    expect(created.status).toBe(201);
    const event = (await created.json()) as AdminEvent;
    expect(event.monitors).toHaveLength(105);
    expect(
      await fixture.db
        .prepare('SELECT COUNT(*) AS n FROM event_suppressions WHERE event_id = ?')
        .bind(event.id)
        .first('n'),
    ).toBe(105);
    const updated = await request(`admin/events/${event.id}`, 'PATCH', {
      ...config(ids[0], { title: '更新关联', monitorIds: ids.slice(1) }),
      version: event.version,
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as AdminEvent).monitors).toHaveLength(104);
    expect(
      (
        await request(`admin/events/${event.id}`, 'PATCH', {
          ...config(ids[0], { monitorIds: ids }),
          version: event.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (await request('admin/events', 'POST', config(ids[0], { monitorIds: [...ids, 'missing'] }))).status,
    ).toBe(400);
    expect(
      (
        await request(`admin/events/${event.id}`, 'PATCH', {
          ...config(ids[0], { monitorIds: [...ids, 'missing'] }),
          version: event.version + 1,
        })
      ).status,
    ).toBe(409);
    const saved = (await getEvent(fixture.db, event.id))!;
    expect(saved.title).toBe('更新关联');
    expect(saved.monitors.map((monitor) => monitor.id).sort()).toEqual(ids.slice(1).sort());
  });
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
      updates: [{ title: 'Resolved', status: 'resolved' }],
    });
    for (let n = 9; n <= 14; n++) await tick(n);
    expect(await recent()).toHaveLength(2);
    const publicData = await getStatus(environment(fixture.db), at(14));
    expect(publicData.events[0]).not.toHaveProperty('version');
    expect(JSON.stringify(publicData.events)).not.toContain(httpConfig.url);
    expect((await getHistory(environment(fixture.db), row.id, at(14)))?.events).toHaveLength(2);
  });
  it('publishes recovery after progress added during the probe across public cards and timelines', async () => {
    const row = await node();
    for (let n = 0; n <= 5; n++) await tick(n);
    const event = (await recent())[0];
    const checkedAt = at(6);
    let now = checkedAt;
    const beforeRecovery = await databaseNow();
    await runScheduled(
      { DB: fixture.db },
      checkedAt,
      async () => {
        now += 1000;
        await appendEventUpdate(
          fixture.db,
          event.id,
          event.version,
          { title: 'Investigating', body: '排查中' },
          now,
        );
        now += 1000;
        return { ...success(checkedAt), latencyMs: now - checkedAt };
      },
      () => now,
    );
    const afterRecovery = await databaseNow();
    const saved = (await getEvent(fixture.db, event.id))!;
    expect(saved.updates.map((update) => update.title)).toEqual(['Investigating', 'Resolved']);
    const [manual, recovery] = saved.updates;
    expect(recovery).toMatchObject({ source: 'automatic', status: 'resolved' });
    expect(recovery.createdAt).toBeGreaterThan(manual.createdAt);
    expect(recovery.createdAt).toBeGreaterThanOrEqual(beforeRecovery);
    expect(recovery.createdAt).toBeLessThanOrEqual(afterRecovery);
    expect(saved).toMatchObject({
      status: 'resolved',
      endedAt: checkedAt,
      updatedAt: recovery.createdAt,
      version: event.version + 2,
    });
    expect(await findMonitor(fixture.db, row.id)).toMatchObject({ last_checked_at: checkedAt, last_ok: 1 });

    const { request } = apiClient(fixture.db);
    for (const path of ['status', `events/${event.id}`, `monitors/${row.id}/history`]) {
      const response = await request(path, 'GET', undefined, { headers: {} });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { event?: StatusEvent; events?: StatusEvent[] };
      const publicEvent = data.event ?? data.events?.find((item) => item.id === event.id);
      expect(publicEvent).toMatchObject({ status: 'resolved', updatedAt: recovery.createdAt });
      expect(publicEvent!.updates).toEqual(saved.updates);
      expect(latestEventEntry(publicEvent!)).toEqual(recovery);
      expect(eventTimeline(publicEvent!).slice(0, 2)).toEqual([recovery, manual]);
    }

    await fixture.db
      .prepare(
        `INSERT OR IGNORE INTO check_results SELECT * FROM check_results
        WHERE monitor_id = ? AND scheduled_at = ?`,
      )
      .bind(row.id, checkedAt)
      .run();
    await tick(7, true);
    expect(await getEvent(fixture.db, event.id)).toEqual(saved);
  });
  it.each([0, -1, 1])(
    'keeps recovery after both timestamps when the event differs from its progress by %i ms',
    async (eventOffset) => {
      await node();
      for (let n = 0; n <= 5; n++) await tick(n);
      const event = (await recent())[0];
      // Keep both timestamps ahead of the database clock to exercise the ordering boundary without sleeps.
      const progressAt = (await databaseNow()) + minute;
      await appendEventUpdate(
        fixture.db,
        event.id,
        event.version,
        { title: 'Investigating', body: '排查中' },
        progressAt,
      );
      const updatedAt = progressAt + eventOffset;
      await fixture.db
        .prepare('UPDATE events SET updated_at = ? WHERE id = ?')
        .bind(updatedAt, event.id)
        .run();
      await tick(6, true);
      const saved = (await getEvent(fixture.db, event.id))!;
      expect(saved.updates.map((update) => update.title)).toEqual(['Investigating', 'Resolved']);
      const recovery = saved.updates.at(-1)!;
      expect(recovery.createdAt).toBeGreaterThan(progressAt);
      expect(recovery.createdAt).toBeGreaterThan(updatedAt);
      expect(saved.updatedAt).toBe(recovery.createdAt);
      expect(saved.endedAt).toBe(at(6));
    },
  );
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
    await appendEventUpdate(fixture.db, first.id, 1, { title: 'Completed', body: '提前完成' }, at(4));
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
    await appendEventUpdate(fixture.db, manual.id, 1, { title: 'Resolved', body: '已处理' }, at(8));
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
    expect((await recent()).find((event) => event.status === 'open')?.startedAt).toBe(at(9));
  });
  it('retains snapshots and stops tracking when a node is deleted', async () => {
    const row = await node();
    for (let n = 0; n <= 5; n++) await tick(n);
    await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(row.id).run();
    const event = (await recent())[0];
    expect(event).toMatchObject({
      status: 'stopped',
      monitors: [{ id: null, name: row.name }],
      updates: [{ title: 'Stopped', status: 'stopped' }],
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
      appendEventUpdate(fixture.db, event.id, edited.version, { title: 'Resolved', body: '完成' }, at(3)),
      appendEventUpdate(fixture.db, event.id, edited.version, { title: 'Updated', body: '竞争更新' }, at(3)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const saved = (await getEvent(fixture.db, event.id))!;
    const winner = results[0].status === 'fulfilled';
    expect(saved).toMatchObject({
      version: edited.version + 1,
      status: winner ? 'resolved' : 'open',
      updates: [
        {
          title: winner ? 'Resolved' : 'Updated',
          body: winner ? '完成' : '竞争更新',
          status: winner ? 'resolved' : null,
        },
      ],
    });
    expect(saved.updates).toHaveLength(1);
    await expect(createEvent(fixture.db, config('missing'), at(4))).rejects.toThrow();
    expect(await recent()).toHaveLength(1);
  });
  it.each(['incident', 'maintenance'] as const)(
    'completes %s from its fixed stage atomically across admin and public responses',
    async (type) => {
      const row = await node();
      const event = await createEvent(
        fixture.db,
        config(row.id, {
          type,
          ...(type === 'maintenance' ? { startsAt: at(0), endsAt: Date.now() + minute } : {}),
        }),
        at(0),
      );
      const title = type === 'maintenance' ? 'Completed' : 'Resolved';
      const { request } = apiClient(fixture.db);
      const response = await request(`admin/events/${event.id}/updates`, 'POST', {
        version: event.version,
        title: `  ${title}  `,
        body: '  服务已恢复\n继续观察  ',
      });
      expect(response.status).toBe(200);
      const saved = (await response.json()) as AdminEvent;
      expect(saved).toMatchObject({
        title: event.title,
        status: 'resolved',
        version: event.version + 1,
        updates: [
          {
            title,
            body: '服务已恢复\n继续观察',
            status: 'resolved',
            source: 'manual',
          },
        ],
      });
      expect(saved.updates).toHaveLength(1);
      expect(saved.endedAt).not.toBeNull();
      const detail = await request(`admin/events/${event.id}`);
      expect(((await detail.json()) as AdminEvent).updates).toEqual(saved.updates);
      const publicDetail = await request(`events/${event.id}`, 'GET', undefined, { headers: {} });
      expect(publicDetail.status).toBe(200);
      expect(await publicDetail.json()).toMatchObject({
        event: { status: 'resolved', updates: saved.updates },
      });
      for (const path of ['admin/events', 'status', `monitors/${row.id}/history`]) {
        const response = await request(path);
        expect(response.status).toBe(200);
        const data = (await response.json()) as { events: StatusEvent[] };
        expect(data.events[0].updates).toEqual(saved.updates);
      }
      expect(
        await fixture.db
          .prepare('SELECT ends_at FROM event_suppressions WHERE event_id = ?')
          .bind(event.id)
          .first('ends_at'),
      ).toBe(saved.endedAt);
    },
  );
  it('requires a fixed title and rejects invalid or unavailable stages without writes', async () => {
    const row = await node();
    let event = await createEvent(fixture.db, config(row.id), at(0));
    const { request } = apiClient(fixture.db);
    for (const title of ['Investigating', '  Identified  ', 'Monitoring', 'Updated']) {
      const response = await request(`admin/events/${event.id}/updates`, 'POST', {
        version: event.version,
        title,
        body: '继续排查',
      });
      expect(response.status).toBe(200);
      const saved = (await response.json()) as AdminEvent;
      const update = saved.updates.find((update) => !event.updates.some((old) => old.id === update.id));
      expect(update).toMatchObject({ title: title.trim(), body: '继续排查', status: null });
      event = saved;
    }
    for (const change of [
      ...[
        undefined,
        null,
        '',
        ' \n\t ',
        false,
        123,
        {},
        [],
        '自由标题',
        'Stopped',
        'Scheduled',
        'In Progress',
        'Completed',
        'x'.repeat(121),
      ].map((title) => ({ title })),
      { body: '' },
      { body: '  ' },
    ]) {
      const response = await request(`admin/events/${event.id}/updates`, 'POST', {
        version: event.version,
        title: 'Resolved',
        body: '检测恢复正常',
        ...change,
      });
      expect(response.status).toBe(400);
      expect(await getEvent(fixture.db, event.id)).toEqual(event);
    }
    const completed = await request(`admin/events/${event.id}/updates`, 'POST', {
      version: event.version,
      title: 'Resolved',
      body: '确认完成',
    });
    expect(completed.status).toBe(200);
    event = (await completed.json()) as AdminEvent;
    expect(event.status).toBe('resolved');
    expect(event.updates.at(-1)).toMatchObject({ title: 'Resolved', status: 'resolved' });
    for (const title of ['Investigating', 'Resolved']) {
      expect(
        (
          await request(`admin/events/${event.id}/updates`, 'POST', {
            version: event.version,
            title,
            body: '事件已结束',
          })
        ).status,
      ).toBe(400);
      expect(await getEvent(fixture.db, event.id)).toEqual(event);
    }
    const followup = await request(`admin/events/${event.id}/updates`, 'POST', {
      version: event.version,
      title: 'Updated',
      body: '事后说明',
    });
    expect(followup.status).toBe(200);
    expect(await followup.json()).toMatchObject({ status: 'resolved', endedAt: event.endedAt });
  });
  it('keeps maintenance clock-derived until the Completed stage is submitted', async () => {
    const row = await node();
    let event = await createEvent(
      fixture.db,
      config(row.id, {
        type: 'maintenance',
        startsAt: Date.now() + minute,
        endsAt: Date.now() + 2 * minute,
      }),
    );
    const { request } = apiClient(fixture.db);
    for (const title of ['Scheduled', 'Updated', 'In Progress']) {
      const response = await request(`admin/events/${event.id}/updates`, 'POST', {
        version: event.version,
        title,
        body: '维护进展',
      });
      expect(response.status).toBe(200);
      event = (await response.json()) as AdminEvent;
      expect(event.status).toBe('open');
      expect(eventLabel(event, event.startsAt! - 1)).toBe('待开始');
      expect(eventLabel(event, event.startsAt!)).toBe('维护进行中');
    }
    for (const title of ['Investigating', 'Identified', 'Monitoring', 'Resolved']) {
      expect(
        (
          await request(`admin/events/${event.id}/updates`, 'POST', {
            version: event.version,
            title,
            body: '类型不匹配',
          })
        ).status,
      ).toBe(400);
      expect(await getEvent(fixture.db, event.id)).toEqual(event);
    }
    const response = await request(`admin/events/${event.id}/updates`, 'POST', {
      version: event.version,
      title: 'Completed',
      body: '取消计划并提前完成',
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as AdminEvent;
    expect(saved.updates.at(-1)).toMatchObject({ title: 'Completed', status: 'resolved' });
    expect(
      await fixture.db
        .prepare('SELECT COUNT(*) AS n FROM event_suppressions WHERE event_id = ?')
        .bind(event.id)
        .first('n'),
    ).toBe(0);
  });
  it('rolls back a titled completion and suppression changes when progress insertion fails', async () => {
    const row = await node();
    const event = await createEvent(fixture.db, config(row.id), at(0));
    await fixture.db
      .prepare(
        `CREATE TRIGGER reject_progress BEFORE INSERT ON event_updates
      BEGIN SELECT RAISE(ABORT, 'progress failed'); END`,
      )
      .run();
    try {
      await expect(
        appendEventUpdate(fixture.db, event.id, 1, { title: 'Resolved', body: '恢复正常' }, at(1)),
      ).rejects.toThrow();
      expect(await getEvent(fixture.db, event.id)).toEqual(event);
      expect(
        await fixture.db
          .prepare('SELECT ends_at FROM event_suppressions WHERE event_id = ?')
          .bind(event.id)
          .first('ends_at'),
      ).toBeNull();
    } finally {
      await fixture.db.prepare('DROP TRIGGER reject_progress').run();
    }
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
    expect((await getEvent(fixture.db, event.id))?.updates).toHaveLength(0);
    expect(
      (
        await request(`admin/events/${event.id}/updates`, 'POST', {
          version: event.version,
          title: 'Resolved',
          body: '不能手动恢复',
        })
      ).status,
    ).toBe(400);
    const progress = await request(`admin/events/${event.id}/updates`, 'POST', {
      version: event.version,
      title: 'Identified',
      body: '补充排查说明',
    });
    expect(progress.status).toBe(200);
    expect(await progress.json()).toMatchObject({
      status: 'open',
      updates: [{ title: 'Identified', status: null }],
    });
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
      closed.push(
        await appendEventUpdate(
          fixture.db,
          event.id,
          1,
          { title: 'Resolved', body: '处理完成' },
          at(10 + (index % 3)),
        ),
      );
    }
    const unrelatedOpen = await createEvent(fixture.db, config(second.id, { title: '其他节点故障' }), at(30));
    const unrelated = await createEvent(fixture.db, config(second.id, { title: '其他节点已恢复' }), at(31));
    const unrelatedClosed = await appendEventUpdate(
      fixture.db,
      unrelated.id,
      1,
      { title: 'Resolved', body: '已恢复' },
      at(32),
    );
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
    const old = closed.at(-1)!;
    const oldDetail = await request(`events/${old.id}`, 'GET', undefined, { headers: {} });
    expect(oldDetail.status).toBe(200);
    const { version: _version, ...publicOld } = old;
    expect(await oldDetail.json()).toMatchObject({ event: publicOld });
  });
  it('reads progress and deleted monitor snapshots publicly and returns uncached missing-event errors', async () => {
    const row = await node();
    const event = await createEvent(fixture.db, config(row.id), at(0));
    await fixture.db
      .prepare(
        "INSERT INTO event_updates (id, event_id, title, body, source, created_at) VALUES ('progress', ?, ?, ?, 'manual', ?)",
      )
      .bind(event.id, 'Updated', '<script>正文</script>', at(1))
      .run();
    await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(row.id).run();
    const { request } = apiClient(fixture.db);
    const response = await request(`events/${event.id}`, 'GET', undefined, { headers: {} });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { event: StatusEvent };
    expect(data.event).toMatchObject({
      monitors: [{ id: null, name: row.name }],
      updates: [{ title: 'Updated', body: '<script>正文</script>' }],
    });
    expect(data.event).not.toHaveProperty('version');
    expect(JSON.stringify(data)).not.toContain(httpConfig.url);
    const missing = await request('events/missing', 'GET', undefined, { headers: {} });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(await missing.json()).toEqual({ code: 'event_not_found' });
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
    const created = await request('admin/groups', 'POST', { name: '区域' });
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
          title: 'Resolved',
          body: '确认完成',
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
