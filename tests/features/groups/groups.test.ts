import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMonitor, findMonitor, updateMonitor } from '../../../src/worker/features/monitors/repository';
import { listEvents } from '../../../src/worker/features/events/repository';
import { listGroupOrder, saveGroup } from '../../../src/worker/features/groups/repository';
import { UNGROUPED_ID } from '../../../src/shared/groups/types';
import { apiClient } from '../../support/api-client';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { databaseFixture, httpConfig, resetDatabase, success, timestamp } from '../../support/fixtures';

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
describe('monitor groups', () => {
  it('protects the system group and rejects assigning monitors to its reserved ID', async () => {
    const { request } = apiClient(fixture.db);
    const row = await node();
    const { ungrouped } = await listGroupOrder(fixture.db);
    const before = await listGroupOrder(fixture.db);
    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await request(`admin/groups/${UNGROUPED_ID}`, method, {
        name: 'Renamed',
        version: ungrouped.version,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'group_readonly' });
    }
    expect((await request('admin/monitors', 'POST', { ...httpConfig, groupId: UNGROUPED_ID })).status).toBe(
      400,
    );
    expect(
      (await request(`admin/monitors/${row.id}`, 'PATCH', { version: 1, groupId: UNGROUPED_ID })).status,
    ).toBe(400);
    expect(await findMonitor(fixture.db, row.id)).toMatchObject({ group_id: null, version: 1 });
    expect(await listGroupOrder(fixture.db)).toEqual(before);
    const custom = await saveGroup(fixture.db, { name: '未分组' });
    expect(custom.id).not.toBe(UNGROUPED_ID);
    expect((await listGroupOrder(fixture.db)).groups).toEqual([custom]);
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
});
