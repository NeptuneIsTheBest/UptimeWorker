import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitor, findMonitor, updateMonitor } from '../../../src/worker/features/monitors/repository';
import { getHistory, getStatus } from '../../../src/worker/features/status/queries';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { wrapDatabase } from '../../support/database';
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
const count = async (table: string) =>
  fixture.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');
describe('D1 scheduling and aggregation', () => {
  it('migrates an empty database and atomically records a check plus daily stats', async () => {
    const row = await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp);
    const metrics = await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => success(),
      () => timestamp,
    );
    expect(metrics).toMatchObject({ claimed: true, checked: 1, stored: 1 });
    expect(await findMonitor(fixture.db, row!.id)).toMatchObject({
      last_ok: 1,
      next_check_at: timestamp + 60_000,
    });
    expect(await fixture.db.prepare('SELECT total, successful FROM daily_stats').first()).toEqual({
      total: 1,
      successful: 1,
    });
    expect(metrics.rowsWritten).toBeGreaterThan(0);
  });
  it('ignores completed slots and duplicate result writes without inflating aggregates', async () => {
    await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp);
    const probe = vi.fn(async () => success());
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect((await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp)).claimed).toBe(false);
    expect(
      (await runScheduled({ DB: fixture.db }, timestamp + 59_999, probe, () => timestamp + 59_999)).claimed,
    ).toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    await fixture.db.batch([
      fixture.db.prepare('UPDATE scheduler_state SET last_completed_slot = 0'),
      fixture.db.prepare('UPDATE monitors SET next_check_at = 0'),
    ]);
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect(await count('check_results')).toBe(1);
    expect(await fixture.db.prepare('SELECT total FROM daily_stats').first('total')).toBe(1);
  });
  it('releases a completed lease only once and still releases it after a housekeeping failure', async () => {
    await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp);
    const queries: string[] = [];
    const observed = wrapDatabase(fixture.db, {
      prepare: (sql) => {
        queries.push(sql);
        return fixture.db.prepare(sql);
      },
    });
    await runScheduled(
      { DB: observed },
      timestamp,
      async () => success(),
      () => timestamp,
    );
    expect(queries.filter((sql) => sql.startsWith('UPDATE scheduler_state SET lease_until'))).toHaveLength(0);
    const failCleanup = wrapDatabase(fixture.db, {
      batch: async <T>(statements: D1PreparedStatement[]) => {
        if (statements.length === 4) throw new Error('cleanup unavailable');
        return fixture.db.batch<T>(statements);
      },
    });
    const next = timestamp + 60_000;
    await expect(
      runScheduled(
        { DB: failCleanup },
        next,
        async () => success(next),
        () => next,
      ),
    ).rejects.toThrow('cleanup unavailable');
    expect(
      await fixture.db
        .prepare('SELECT lease_owner, lease_until, last_completed_slot FROM scheduler_state')
        .first(),
    ).toEqual({ lease_owner: null, lease_until: 0, last_completed_slot: timestamp });
    expect(await count('check_results')).toBe(2);
    expect(
      (
        await runScheduled(
          { DB: fixture.db },
          next,
          async () => success(next),
          () => next,
        )
      ).claimed,
    ).toBe(true);
  });
  it('leases prevent overlapping invocations across minutes and skip missed rounds', async () => {
    await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp);
    let now = timestamp;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const probe = vi.fn(async () => {
      const checkedAt = now;
      await gate;
      return success(checkedAt);
    });
    const first = runScheduled({ DB: fixture.db }, timestamp, probe, () => now);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    const second = await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect(second.claimed).toBe(false);
    now = timestamp + 60_000;
    expect((await runScheduled({ DB: fixture.db }, now, probe, () => now)).claimed).toBe(false);
    now = timestamp + 90_000;
    finish();
    await first;
    now = timestamp + 120_000;
    expect((await runScheduled({ DB: fixture.db }, now, probe, () => now)).stored).toBe(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(
      (await fixture.db.prepare('SELECT scheduled_at FROM check_results ORDER BY scheduled_at').all())
        .results,
    ).toEqual([{ scheduled_at: timestamp }, { scheduled_at: timestamp + 120_000 }]);
    expect(await fixture.db.prepare('SELECT total FROM daily_stats').first('total')).toBe(2);
  });
  it('checks mixed integer intervals only when due on each minute tick', async () => {
    const intervals = [1, 2, 7, 60];
    for (const intervalMinutes of intervals)
      await createMonitor(
        fixture.db,
        { ...httpConfig, name: `${intervalMinutes}m`, intervalMinutes },
        timestamp,
      );
    for (let minute = 0; minute <= 60; minute++) {
      const now = timestamp + minute * 60_000;
      const metrics = await runScheduled(
        { DB: fixture.db },
        now,
        async () => success(now),
        () => now,
      );
      expect(metrics.stored).toBe(intervals.filter((interval) => minute % interval === 0).length);
    }
    const totals = await fixture.db
      .prepare(
        `SELECT interval_minutes, total FROM monitors JOIN daily_stats ON monitor_id = id
        ORDER BY interval_minutes`,
      )
      .all();
    expect(totals.results).toEqual(
      intervals.map((interval) => ({ interval_minutes: interval, total: Math.floor(60 / interval) + 1 })),
    );
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
    const row = await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp);
    await runScheduled(
      { DB: fixture.db },
      timestamp,
      async () => {
        await updateMonitor(
          fixture.db,
          row!.id,
          1,
          { ...httpConfig, name: '已修改', intervalMinutes: 7 },
          timestamp,
        );
        return success();
      },
      () => timestamp,
    );
    expect(await count('check_results')).toBe(0);
    expect(await findMonitor(fixture.db, row!.id)).toMatchObject({ version: 2, last_checked_at: null });
    await runScheduled(
      { DB: fixture.db },
      timestamp + 60_000,
      async () => {
        await fixture.db.prepare('DELETE FROM monitors WHERE id = ?').bind(row!.id).run();
        return success(timestamp + 60_000);
      },
      () => timestamp + 60_000,
    );
    expect(await count('check_results')).toBe(0);
  });
  it('honors longer intervals, pause and resume', async () => {
    const config = { ...httpConfig, intervalMinutes: 2 };
    const row = await createMonitor(fixture.db, config, timestamp);
    const probe = vi.fn(async () => success());
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    await runScheduled({ DB: fixture.db }, timestamp + 60_000, probe, () => timestamp + 60_000);
    expect(probe).toHaveBeenCalledOnce();
    await updateMonitor(fixture.db, row!.id, 1, { ...config, enabled: false });
    await runScheduled({ DB: fixture.db }, timestamp + 120_000, probe, () => timestamp + 120_000);
    expect(probe).toHaveBeenCalledOnce();
    await updateMonitor(fixture.db, row!.id, 2, config);
    await runScheduled({ DB: fixture.db }, timestamp + 180_000, probe, () => timestamp + 180_000);
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
  it('bounds composite-key cleanup and preserves samples exactly at the retention boundary', async () => {
    const row = (await createMonitor(fixture.db, { ...httpConfig, enabled: false }, timestamp))!;
    const cutoff = timestamp - 7 * 86_400_000;
    await fixture.db
      .prepare(
        `WITH RECURSIVE n(x) AS (
      VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < 500
    ) INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      SELECT ?, 1, ? - x, ? - 1, 1, 42 FROM n`,
      )
      .bind(row.id, cutoff - 1, cutoff)
      .run();
    await fixture.db
      .prepare(
        `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES (?, 1, ?, ?, 1, 42)`,
      )
      .bind(row.id, cutoff, cutoff)
      .run();
    const probe = vi.fn(async () => success());
    await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp);
    expect(probe).not.toHaveBeenCalled();
    expect(await count('check_results')).toBe(2);
    expect(
      await fixture.db
        .prepare('SELECT COUNT(*) AS n FROM check_results WHERE checked_at = ?')
        .bind(cutoff)
        .first('n'),
    ).toBe(1);
    expect(await fixture.db.prepare('SELECT total FROM daily_stats').first('total')).toBe(502);
    await runScheduled({ DB: fixture.db }, timestamp + 60_000, probe, () => timestamp + 60_000);
    expect(await count('check_results')).toBe(0);
    expect(await fixture.db.prepare('SELECT total FROM daily_stats').first('total')).toBe(502);
  });
  it('returns every minute in the last 24 hours even after switching to a longer interval', async () => {
    const row = (await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 1 }, timestamp))!;
    const checks = Array.from({ length: 1442 }, (_, index) => timestamp - (1441 - index) * 60_000);
    for (let offset = 0; offset < checks.length; offset += 100)
      await fixture.db.batch(
        checks.slice(offset, offset + 100).map((checkedAt) =>
          fixture.db
            .prepare(
              `INSERT INTO check_results
              (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms) VALUES (?, 1, ?, ?, 1, 42)`,
            )
            .bind(row.id, checkedAt, checkedAt),
        ),
      );
    await updateMonitor(fixture.db, row.id, 1, { ...httpConfig, intervalMinutes: 60 }, timestamp);
    const history = await getHistory(fixture.db, row.id, timestamp);
    expect(history?.monitor.intervalMinutes).toBe(60);
    expect(history?.checks.map((check) => check.checkedAt)).toEqual(checks.slice(1));
    expect(history?.checks).toHaveLength(1441);
  });
  it('creates more than ten monitors concurrently', async () => {
    const rows = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        createMonitor(fixture.db, { ...httpConfig, name: `Monitor ${i}` }),
      ),
    );
    expect(rows.filter(Boolean)).toHaveLength(11);
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
