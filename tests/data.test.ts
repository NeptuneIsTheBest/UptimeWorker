import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitor, findMonitor, getHistory, getStatus, updateMonitor } from '../src/worker/repository';
import { runScheduled } from '../src/worker/scheduler';
import { databaseFixture, environment, httpConfig, resetDatabase, success, timestamp } from './helpers';

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
const count = async (table: string) =>
  fixture.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');
describe('D1 scheduling and aggregation', () => {
  it('migrates an empty database and atomically records a check plus daily stats', async () => {
    const row = await createMonitor(fixture.db, httpConfig, timestamp);
    const metrics = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => success(),
      () => timestamp,
    );
    expect(metrics).toMatchObject({ claimed: true, checked: 1, stored: 1 });
    expect(await findMonitor(fixture.db, row!.id)).toMatchObject({
      last_ok: 1,
      next_check_at: timestamp + 300_000,
    });
    expect(await fixture.db.prepare('SELECT total, successful FROM daily_stats').first()).toEqual({
      total: 1,
      successful: 1,
    });
    expect(metrics.rowsWritten).toBeGreaterThan(0);
  });
  it('ignores completed slots and duplicate result writes without inflating aggregates', async () => {
    await createMonitor(fixture.db, httpConfig, timestamp);
    const probe = vi.fn(async () => success());
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect((await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp)).claimed).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    await fixture.db.batch([
      fixture.db.prepare('UPDATE scheduler_state SET last_completed_slot = 0'),
      fixture.db.prepare('UPDATE monitors SET next_check_at = 0'),
    ]);
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect(await count('check_results')).toBe(1);
    expect(await fixture.db.prepare('SELECT total FROM daily_stats').first('total')).toBe(1);
  });
  it('leases prevent overlapping invocations', async () => {
    await createMonitor(fixture.db, httpConfig, timestamp);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const probe = vi.fn(async () => {
      await gate;
      return success();
    });
    const first = runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    const second = await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect(second.claimed).toBe(false);
    finish();
    await first;
    expect(await count('check_results')).toBe(1);
  });
  it('expires a crashed lease and rejects an expired in-flight result', async () => {
    await createMonitor(fixture.db, httpConfig, timestamp);
    await fixture.db
      .prepare('UPDATE scheduler_state SET lease_owner = ?, lease_until = ?')
      .bind('crashed', timestamp - 1)
      .run();
    let now = timestamp;
    const result = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        now += 240_001;
        return success();
      },
      () => now,
    );
    expect(result).toMatchObject({ claimed: true, stored: 0 });
    expect(await count('check_results')).toBe(0);
    expect(
      (
        await runScheduled(
          { DB: fixture.db },
          timestamp,
          async () => success(now),
          () => now,
        )
      ).stored,
    ).toBe(1);
  });
  it('does not let checks started before edits or deletions write stale results', async () => {
    const row = await createMonitor(fixture.db, httpConfig, timestamp);
    await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        await updateMonitor(fixture.db, row!.id, 1, { ...httpConfig, name: '已修改' }, timestamp);
        return success();
      },
      () => timestamp,
    );
    expect(await count('check_results')).toBe(0);
    expect(await findMonitor(fixture.db, row!.id)).toMatchObject({ version: 2, last_checked_at: null });
    await runScheduled(
      { DB: fixture.db },
      timestamp + 300_000,
      async () => {
        await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(row!.id).run();
        return success(timestamp + 300_000);
      },
      () => timestamp + 300_000,
    );
    expect(await count('check_results')).toBe(0);
  });
  it('honors longer intervals, pause and resume', async () => {
    const config = { ...httpConfig, intervalMinutes: 10 };
    const row = await createMonitor(fixture.db, config, timestamp);
    const probe = vi.fn(async () => success());
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    await runScheduled({ DB: fixture.db }, timestamp + 300_000, probe, () => timestamp + 300_000);
    expect(probe).toHaveBeenCalledOnce();
    await updateMonitor(fixture.db, row!.id, 1, { ...config, enabled: false });
    await runScheduled({ DB: fixture.db }, timestamp + 600_000, probe, () => timestamp + 600_000);
    expect(probe).toHaveBeenCalledOnce();
    await updateMonitor(fixture.db, row!.id, 2, config);
    await runScheduled({ DB: fixture.db }, timestamp + 900_000, probe, () => timestamp + 900_000);
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it('rolls back counters and current state if a batch fails', async () => {
    const row = await createMonitor(fixture.db, httpConfig, timestamp);
    const statement = (slot: number, ms: number) =>
      fixture.db
        .prepare(
          `INSERT INTO check_results
      (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms) VALUES (?, 1, ?, ?, 1, ?)`,
        )
        .bind(row!.id, slot, timestamp, ms);
    await expect(fixture.db.batch([statement(timestamp, 1), statement(timestamp + 1, -1)])).rejects.toThrow();
    expect(await count('check_results')).toBe(0);
    expect(await count('daily_stats')).toBe(0);
    expect((await findMonitor(fixture.db, row!.id))?.last_checked_at).toBeNull();
  });
  it('reports unknown, paused, stale and sampled uptime without leaking targets', async () => {
    const row = await createMonitor(fixture.db, httpConfig, timestamp);
    const env = environment(fixture.db);
    expect((await getStatus(env, timestamp)).monitors[0]).toMatchObject({
      status: 'unknown',
      uptime30d: null,
    });
    await runScheduled(
      env,
      timestamp,
      async () => success(),
      () => timestamp,
    );
    await runScheduled(
      env,
      timestamp + 300_000,
      async () => ({ ...success(timestamp + 300_000), ok: false, errorCode: 'network' }),
      () => timestamp + 300_000,
    );
    const status = await getStatus(env, timestamp + 300_000);
    expect(status.monitors[0]).toMatchObject({ status: 'down', uptime30d: 50 });
    expect(status.monitors[0].days).toHaveLength(90);
    expect(status.monitors[0].days[0].uptime).toBeNull();
    expect(JSON.stringify(status)).not.toContain('example.com');
    expect((await getStatus(env, timestamp + 900_001)).monitors[0].status).toBe('stale');
    expect((await getHistory(fixture.db, row!.id, timestamp + 300_000))?.checks).toHaveLength(2);
    await updateMonitor(fixture.db, row!.id, 1, { ...httpConfig, enabled: false });
    expect((await getStatus(env, timestamp + 900_001)).monitors[0].status).toBe('paused');
  });
  it('prunes raw history while preserving retained daily summaries', async () => {
    await createMonitor(fixture.db, httpConfig, timestamp);
    await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => success(),
      () => timestamp,
    );
    const later = timestamp + 8 * 86_400_000;
    await runScheduled(
      { DB: fixture.db },
      later,
      async () => success(later),
      () => later,
    );
    expect(await count('check_results')).toBe(1);
    expect(await count('daily_stats')).toBe(2);
    const oldestExpired = timestamp + 91 * 86_400_000;
    await runScheduled(
      { DB: fixture.db },
      oldestExpired,
      async () => success(oldestExpired),
      () => oldestExpired,
    );
    expect(await count('daily_stats')).toBe(2);
  });
  it('limits monitoring to ten targets atomically', async () => {
    const rows = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        createMonitor(fixture.db, { ...httpConfig, name: `Monitor ${i}` }),
      ),
    );
    expect(rows.filter(Boolean)).toHaveLength(10);
  });
  it('stays within the configured concurrent probe budget and isolates unexpected failures', async () => {
    for (let i = 0; i < 10; i++) await createMonitor(fixture.db, { ...httpConfig, name: `Service ${i}` });
    let active = 0,
      maxActive = 0;
    const result = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async (config) => {
        active++;
        maxActive = Math.max(active, maxActive);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        if (config.name === 'Service 3') throw new Error('unexpected internal failure');
        return success();
      },
      () => timestamp,
    );
    expect(maxActive).toBe(4);
    expect(result.checked).toBe(9);
    expect(result.stored).toBe(9);
    expect(result.rowsWritten).toBeLessThan(150);
    const nextSlot = timestamp + 300_000;
    const healthy = await runScheduled({ DB: fixture.db }, nextSlot, async () => success(nextSlot));
    expect(healthy.stored).toBe(10);
    expect(healthy.rowsWritten).toBeLessThan(150);
  });
});
