import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { AdminMonitor } from '../../../src/shared/monitors/types';
import type { MonitorGroup } from '../../../src/shared/groups/types';
import { orderItems } from '../../../src/shared/ordering';
import {
  adminMonitor,
  createMonitor,
  findMonitor,
  listMonitors,
  updateMonitor,
} from '../../../src/worker/features/monitors/repository';
import { deleteGroup, listGroups, saveGroup } from '../../../src/worker/features/groups/repository';
import { saveOrder } from '../../../src/worker/features/ordering/repository';
import { getStatus } from '../../../src/worker/features/status/queries';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { apiClient, adminHeaders } from '../../support/api-client';
import {
  databaseFixture,
  environment,
  httpConfig,
  resetDatabase,
  success,
  timestamp,
} from '../../support/fixtures';

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

const monitor = async (name: string, groupId: string | null = null, enabled = true) =>
  adminMonitor(
    (await createMonitor(
      fixture.db,
      { ...httpConfig, name, groupId, intervalMinutes: 1, enabled },
      timestamp,
    ))!,
  );
const current = async () => (await listMonitors(fixture.db)).map((row) => adminMonitor(row));
const snapshot = async () => (await fixture.db.prepare('SELECT * FROM monitors ORDER BY id').all()).results;

it('persists group and member ordering consistently in admin and public lists', async () => {
  const { request } = apiClient(fixture.db);
  const first = await saveGroup(fixture.db, { name: 'First', sortOrder: 10 });
  const second = await saveGroup(fixture.db, { name: 'Second', sortOrder: 20 });
  await monitor('Ungrouped');
  await monitor('B1', second.id);
  const a1 = await monitor('A1', first.id);
  const a2 = await monitor('A2', first.id);
  expect((await current()).map((row) => row.name)).toEqual(['A1', 'A2', 'B1', 'Ungrouped']);
  const response = await request('admin/groups/order', 'PUT', { items: orderItems([second, first]) });
  expect(response.status).toBe(200);
  expect(((await response.json()) as { groups: MonitorGroup[] }).groups.map((group) => group.name)).toEqual([
    'Second',
    'First',
  ]);
  expect(
    (await request('admin/monitors/order', 'PUT', { groupId: first.id, items: orderItems([a2, a1]) })).status,
  ).toBe(200);
  const listing = ((await (await request('admin/monitors')).json()) as { monitors: AdminMonitor[] }).monitors;
  expect(listing.map((row) => row.name)).toEqual(['B1', 'A2', 'A1', 'Ungrouped']);
  expect(
    listing.filter((row) => row.groupId === first.id).map((row) => [row.sortOrder, row.version]),
  ).toEqual([
    [0, 1],
    [1, 1],
  ]);
  expect((await getStatus(environment(fixture.db))).monitors.map((row) => row.name)).toEqual(
    listing.map((row) => row.name),
  );
  const renamed = await request(`admin/monitors/${a1.id}`, 'PATCH', {
    version: 1,
    name: 'Renamed',
    sortOrder: 0,
  });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toMatchObject({ sortOrder: 1 });
});

it('rejects invalid, partial, cross-group and stale orders without partial writes', async () => {
  const { request } = apiClient(fixture.db);
  const group = await saveGroup(fixture.db, { name: 'Group' });
  const a = await monitor('A');
  const b = await monitor('B');
  const elsewhere = await monitor('Elsewhere', group.id);
  const items = orderItems([b, a]);
  const before = await snapshot();
  for (const value of [
    undefined,
    [],
    [items[0], items[0]],
    [{ ...items[0], expectedSortOrder: -1 }],
    [{ ...items[0], expectedVersion: 1.5 }],
    [{ ...items[0], id: '' }],
  ]) {
    expect((await request('admin/monitors/order', 'PUT', { groupId: null, items: value })).status).toBe(400);
  }
  for (const invalidGroup of [undefined, '', 5]) {
    expect((await request('admin/monitors/order', 'PUT', { groupId: invalidGroup, items })).status).toBe(400);
  }
  for (const value of [
    items.slice(0, 1),
    orderItems([b, elsewhere]),
    [...items, { ...items[0], id: 'missing' }],
    [{ ...items[0], expectedVersion: 2 }, items[1]],
    [{ ...items[0], expectedSortOrder: 99 }, items[1]],
  ]) {
    const response = await request('admin/monitors/order', 'PUT', { groupId: null, items: value });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'order_conflict' });
    expect(await snapshot()).toEqual(before);
  }
});

it('accepts only one concurrent writer using the same original order', async () => {
  const { request } = apiClient(fixture.db);
  const a = await monitor('A');
  const b = await monitor('B');
  const c = await monitor('C');
  const responses = await Promise.all([
    request('admin/monitors/order', 'PUT', { groupId: null, items: orderItems([c, a, b]) }),
    request('admin/monitors/order', 'PUT', { groupId: null, items: orderItems([b, c, a]) }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
});

it.each(['create', 'delete', 'edit', 'move'] as const)('detects a concurrent monitor %s', async (change) => {
  const { request } = apiClient(fixture.db);
  const group = await saveGroup(fixture.db, { name: 'Target' });
  const a = await monitor('A');
  const b = await monitor('B');
  if (change === 'create') await monitor('C');
  if (change === 'delete') await request(`admin/monitors/${a.id}`, 'DELETE', {});
  if (change === 'edit')
    await request(`admin/monitors/${a.id}`, 'PATCH', { version: a.version, name: 'Changed' });
  if (change === 'move')
    await request(`admin/monitors/${a.id}`, 'PATCH', { version: a.version, groupId: group.id });
  const before = await snapshot();
  expect(
    (await request('admin/monitors/order', 'PUT', { groupId: null, items: orderItems([b, a]) })).status,
  ).toBe(409);
  expect(await snapshot()).toEqual(before);
});

it('guards group reorders against stale versions and membership changes', async () => {
  const { request } = apiClient(fixture.db);
  const a = await saveGroup(fixture.db, { name: 'A' });
  const b = await saveGroup(fixture.db, { name: 'B' });
  const items = orderItems([b, a]);
  await saveGroup(fixture.db, { name: 'Renamed' }, a.id, a.version);
  const before = await listGroups(fixture.db);
  expect((await request('admin/groups/order', 'PUT', { items })).status).toBe(409);
  expect(await listGroups(fixture.db)).toEqual(before);
  const c = await saveGroup(fixture.db, { name: 'C' });
  expect((await request('admin/groups/order', 'PUT', { items: orderItems(before) })).status).toBe(409);
  const latest = await listGroups(fixture.db);
  await deleteGroup(fixture.db, c.id, c.version);
  expect((await request('admin/groups/order', 'PUT', { items: orderItems(latest) })).status).toBe(409);
});

it('appends new groups, preserves omitted orders on edits, and supports legacy numeric positions', async () => {
  const { request } = apiClient(fixture.db);
  const a = await saveGroup(fixture.db, { name: 'A', sortOrder: 50 });
  const b = await saveGroup(fixture.db, { name: 'B', sortOrder: 1_000_000 });
  const result = await request('admin/groups', 'POST', { name: 'C' });
  expect(result.status).toBe(201);
  const c = (await result.json()) as MonitorGroup;
  expect((await listGroups(fixture.db)).map((group) => [group.name, group.sortOrder])).toEqual([
    ['A', 0],
    ['B', 1],
    ['C', 2],
  ]);
  expect(
    (await request(`admin/groups/${c.id}`, 'PATCH', { name: 'Renamed', version: c.version })).status,
  ).toBe(200);
  const groups = await listGroups(fixture.db);
  expect(groups[2]).toMatchObject({ name: 'Renamed', sortOrder: 2 });
  expect(groups.slice(0, 2).map((group) => [group.id, group.version])).toEqual([
    [a.id, 2],
    [b.id, 2],
  ]);
  expect(
    (await request(`admin/groups/${b.id}`, 'PATCH', { name: 'B', version: 2, sortOrder: 0 })).status,
  ).toBe(200);
});

it('appends new and reassigned services, and appends a deleted group in its saved order', async () => {
  const group = await saveGroup(fixture.db, { name: 'Group' });
  const a = await monitor('A', group.id);
  const b = await monitor('B', group.id);
  const u = await monitor('Ungrouped');
  await saveOrder(fixture.db, 'monitors', orderItems([b, a]), group.id);
  const c = await monitor('C', group.id);
  expect(c.sortOrder).toBe(2);
  await updateMonitor(fixture.db, u.id, u.version, {
    ...httpConfig,
    name: u.name,
    groupId: group.id,
    intervalMinutes: 1,
  });
  await monitor('Existing ungrouped');
  const before = await current();
  await expect(deleteGroup(fixture.db, group.id, group.version + 1)).rejects.toThrow();
  expect(await current()).toEqual(before);
  await deleteGroup(fixture.db, group.id, group.version);
  const after = await current();
  expect(after.map((row) => row.name)).toEqual(['Existing ungrouped', 'B', 'A', 'C', 'Ungrouped']);
  expect(after.every((row) => row.groupId === null)).toBe(true);
});

it('keeps in-flight checks, schedules, statistics and outage streaks valid while sorting', async () => {
  const a = await monitor('Enabled');
  await monitor('Paused', null, false);
  const failure = (now: number) => ({
    ...success(now),
    ok: false,
    httpStatus: null,
    errorCode: 'network' as const,
  });
  await runScheduled(
    { DB: fixture.db },
    timestamp,
    async () => failure(timestamp),
    () => timestamp,
  );
  const before = await snapshot();
  const afterSort = async () => {
    await saveOrder(fixture.db, 'monitors', orderItems((await current()).reverse()));
    expect((await snapshot()).map(({ sort_order: _, ...rest }) => rest)).toEqual(
      before.map(({ sort_order: _, ...rest }) => rest),
    );
    return failure(timestamp + 60_000);
  };
  const metrics = await runScheduled(
    { DB: fixture.db },
    timestamp + 60_000,
    afterSort,
    () => timestamp + 60_000,
  );
  expect(metrics.stored).toBe(1);
  expect(await findMonitor(fixture.db, a.id)).toMatchObject({
    version: 1,
    last_checked_at: timestamp + 60_000,
    next_check_at: timestamp + 120_000,
  });
  expect(await fixture.db.prepare('SELECT total, successful FROM daily_stats').first()).toEqual({
    total: 2,
    successful: 0,
  });
  expect(await fixture.db.prepare('SELECT started_at, last_failed_at FROM monitor_outages').first()).toEqual({
    started_at: timestamp,
    last_failed_at: timestamp + 60_000,
  });
});

it('handles a full list exceeding 16 KiB without per-item SQL parameters', async () => {
  const { request } = apiClient(fixture.db);
  await fixture.db
    .prepare(
      `INSERT INTO monitors(id, name, type, config_json, interval_minutes, timeout_seconds, enabled, created_at, updated_at, sort_order)
    SELECT 'monitor-' || key, 'Monitor ' || key, 'http', ?, 1, 10, 1, ?, ?, CAST(key AS INTEGER) FROM json_each(?)`,
    )
    .bind(JSON.stringify(httpConfig), timestamp, timestamp, JSON.stringify(Array(350).fill(0)))
    .run();
  const items = orderItems((await current()).reverse());
  expect(JSON.stringify(items).length).toBeGreaterThan(16 * 1024);
  expect((await request('admin/monitors/order', 'PUT', { groupId: null, items })).status).toBe(200);
  expect((await current())[0].id).toBe(items[0].id);
});

it.each(['groups', 'monitors'])(
  'protects the %s ordering endpoint and enforces the body limit',
  async (kind) => {
    const { request } = apiClient(fixture.db);
    const path = `admin/${kind}/order`;
    for (const [headers, status] of [
      [{}, 401],
      [{ ...adminHeaders, Origin: 'https://other.test' }, 403],
      [{ ...adminHeaders, 'Content-Type': 'text/plain' }, 415],
    ] as const) {
      expect((await request(path, 'PUT', {}, { headers })).status).toBe(status);
    }
    expect((await request(path, 'PUT', { padding: 'a'.repeat(256 * 1024) })).status).toBe(413);
  },
);
