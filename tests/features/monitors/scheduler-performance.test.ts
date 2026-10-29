import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitor, findMonitor } from '../../../src/worker/features/monitors/repository';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { getProbeSnapshot } from '../../../src/worker/features/monitors/snapshot';
import { apiClient } from '../../support/api-client';
import {
  databaseFixture,
  httpConfig,
  resetDatabase,
  success,
  tcpConfig,
  timestamp,
} from '../../support/fixtures';

describe('bounded scheduling without a monitor count limit', () => {
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
  async function seed(count: number, type: 'http' | 'tcp' = 'http', offset = 0) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = (await createMonitor(
        fixture.db,
        { ...(type === 'http' ? httpConfig : tcpConfig), name: `Target ${i + offset}`, intervalMinutes: 1 },
        timestamp,
      ))!;
      await fixture.db
        .prepare('UPDATE monitors SET next_check_at = ? WHERE id = ?')
        .bind(offset + i, row.id)
        .run();
      ids.push(row.id);
    }
    return ids;
  }
  it.each([1, 2, 6])('uses configured concurrency %s and admits over ten checks', async (concurrency) => {
    await seed(16);
    await fixture.db
      .prepare(
        "UPDATE global_settings SET workers_plan = 'paid', max_checks_per_run = 20, probe_concurrency = ?",
      )
      .bind(concurrency)
      .run();
    let active = 0,
      peak = 0;
    const result = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return success();
      },
      () => timestamp,
    );
    expect(peak).toBe(concurrency);
    expect(result).toMatchObject({ checked: 16, stored: 16 });
  });
  it('bounds the snapshot and carries the oldest unstarted targets into following minutes', async () => {
    const ids = await seed(7);
    await fixture.db.prepare('UPDATE global_settings SET max_checks_per_run = 2').run();
    const snapshot = await getProbeSnapshot(fixture.db, { slot: timestamp });
    expect(snapshot.monitors.map((row) => row.id)).toEqual(ids.slice(0, 2));
    const checked: string[] = [];
    for (let minute = 0; minute < 4; minute++) {
      const now = timestamp + minute * 60_000;
      await runScheduled(
        { DB: fixture.db },
        now,
        async (config) => {
          checked.push(config.name);
          return success(now);
        },
        () => now,
      );
    }
    expect(checked.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => `Target ${i}`));
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results WHERE ok = 0').first('n')).toBe(
      0,
    );
  });
  it('stops HTTP at twelve full redirect chains while still admitting TCP', async () => {
    const ids = await seed(13);
    await seed(3, 'tcp', 13);
    await fixture.db.prepare('UPDATE global_settings SET max_checks_per_run = 20').run();
    const probe = vi.fn(async () => success());
    expect(await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp)).toMatchObject({
      checked: 15,
      stored: 15,
    });
    expect(await findMonitor(fixture.db, ids[12])).toMatchObject({
      next_check_at: 12,
      last_checked_at: null,
    });
    expect(probe.mock.calls).toHaveLength(15);
    const next = timestamp + 60_000;
    const nextProbe = vi.fn(async () => success(next));
    await runScheduled({ DB: fixture.db }, next, nextProbe, () => next);
    expect(nextProbe.mock.calls[0]).toBeDefined();
    expect(await findMonitor(fixture.db, ids[12])).toMatchObject({ last_checked_at: next });
  });
  it('defers probes that cannot fit their full timeout and saves admitted samples', async () => {
    const ids = await seed(6);
    await fixture.db
      .prepare('UPDATE global_settings SET probe_concurrency = 1, time_budget_seconds = 40')
      .run();
    let clock = timestamp;
    const run = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        const checkedAt = clock;
        clock += 10_000;
        return success(checkedAt);
      },
      () => clock,
    );
    expect(run).toMatchObject({ checked: 3, stored: 3 });
    for (const id of ids.slice(3))
      expect(await findMonitor(fixture.db, id)).toMatchObject({ last_checked_at: null });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
  });
  it('backs off an internal failure without a sample so it cannot monopolize the queue', async () => {
    const ids = await seed(3);
    await fixture.db.prepare('UPDATE global_settings SET max_checks_per_run = 1').run();
    const bad = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        throw new Error('internal');
      },
      () => timestamp,
    );
    expect(bad).toMatchObject({ checked: 0, stored: 0 });
    expect(await findMonitor(fixture.db, ids[0])).toMatchObject({
      next_check_at: timestamp + 60_000,
      last_checked_at: null,
      last_ok: null,
    });
    const next = timestamp + 60_000;
    await runScheduled(
      { DB: fixture.db },
      next,
      async () => success(next),
      () => next,
    );
    expect(await findMonitor(fixture.db, ids[1])).toMatchObject({ last_checked_at: next });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(1);
  });
  it('filters future and paused targets and isolates immediate tests from unrelated configs', async () => {
    const ids = await seed(3);
    await fixture.db.batch([
      fixture.db
        .prepare('UPDATE monitors SET enabled = 0, config_json = ? WHERE id = ?')
        .bind('broken', ids[1]),
      fixture.db
        .prepare('UPDATE monitors SET next_check_at = ? WHERE id = ?')
        .bind(timestamp + 60_000, ids[2]),
    ]);
    expect((await getProbeSnapshot(fixture.db, { slot: timestamp })).monitors.map((row) => row.id)).toEqual([
      ids[0],
    ]);
    expect((await getProbeSnapshot(fixture.db, { id: ids[2] })).monitors.map((row) => row.id)).toEqual([
      ids[2],
    ]);
    const probe = vi.fn(async () => success());
    const { request } = apiClient(fixture.db, probe);
    expect((await request(`admin/monitors/${ids[2]}/test`, 'POST', {})).status).toBe(200);
    expect(probe).toHaveBeenCalledOnce();
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(0);
  });
});
