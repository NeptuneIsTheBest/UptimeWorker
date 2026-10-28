import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMonitor, findMonitor } from '../src/worker/repository';
import { applyMigration, databaseFixture, httpConfig, tcpConfig, timestamp } from './helpers';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
beforeAll(async () => {
  fixture = await databaseFixture('0002_global_settings.sql');
});
afterAll(async () => {
  await fixture?.dispose();
});

it('upgrades legacy intervals without changing monitors, history, settings or scheduler state', async () => {
  const db = fixture.db;
  const ids: string[] = [];
  for (const intervalMinutes of [5, 10, 15, 30, 60]) {
    const config = intervalMinutes === 10 ? tcpConfig : httpConfig;
    const row = (await createMonitor(
      db,
      { ...config, intervalMinutes, enabled: intervalMinutes !== 30 },
      timestamp,
    ))!;
    ids.push(row.id);
    await db.prepare('UPDATE monitors SET version = 3 WHERE id = ?').bind(row.id).run();
    for (const [offset, ok] of [
      [-60_000, 1],
      [0, 0],
    ])
      await db
        .prepare(
          `INSERT INTO check_results
          (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms, error_code)
          VALUES (?, 3, ?, ?, ?, 42, ?)`,
        )
        .bind(row.id, timestamp + offset, timestamp + offset, ok, ok ? null : 'network')
        .run();
    await db
      .prepare('INSERT INTO daily_stats (monitor_id, day, total, successful) VALUES (?, ?, 100, 99)')
      .bind(row.id, '2026-08-01')
      .run();
  }
  await db
    .prepare('UPDATE scheduler_state SET lease_owner = ?, lease_until = ?, last_completed_slot = ?')
    .bind('in-flight', timestamp + 240_000, timestamp)
    .run();
  await db
    .prepare('UPDATE global_settings SET version = 3, waf_bypass_token = ?')
    .bind('saved-test-token')
    .run();
  await expect(db.prepare('UPDATE monitors SET interval_minutes = 1').run()).rejects.toThrow();

  const queries = [
    'SELECT * FROM monitors ORDER BY id',
    'SELECT * FROM check_results ORDER BY id',
    'SELECT * FROM daily_stats ORDER BY monitor_id, day',
    'SELECT * FROM scheduler_state',
    'SELECT * FROM global_settings',
  ];
  const snapshot = async () => (await db.batch(queries.map((sql) => db.prepare(sql)))).map((r) => r.results);
  const before = await snapshot();
  await applyMigration(db, '0003_flexible_intervals.sql');
  expect(await snapshot()).toEqual(before);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

  for (const interval of [1, 2, 7, 60])
    await db.prepare('UPDATE monitors SET interval_minutes = ? WHERE id = ?').bind(interval, ids[0]).run();
  for (const interval of [0, 61, 1.5, null])
    await expect(
      db.prepare('UPDATE monitors SET interval_minutes = ? WHERE id = ?').bind(interval, ids[0]).run(),
    ).rejects.toThrow();
  await db.prepare('UPDATE monitors SET interval_minutes = 1 WHERE id = ?').bind(ids[0]).run();
  await db
    .prepare(
      `INSERT INTO check_results
      (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms) VALUES (?, 3, ?, ?, 1, 43)`,
    )
    .bind(ids[0], timestamp + 60_000, timestamp + 60_000)
    .run();
  expect(await findMonitor(db, ids[0])).toMatchObject({ last_ok: 1, next_check_at: timestamp + 120_000 });
  expect(
    await db
      .prepare('SELECT total, successful FROM daily_stats WHERE monitor_id = ? AND day = ?')
      .bind(ids[0], '2026-10-28')
      .first(),
  ).toEqual({ total: 3, successful: 2 });

  await db.prepare('DELETE FROM monitors WHERE id = ?').bind(ids[0]).run();
  for (const table of ['check_results', 'daily_stats']) {
    expect(
      await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE monitor_id = ?`).bind(ids[0]).first('n'),
    ).toBe(0);
    expect(
      await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE monitor_id = ?`).bind(ids[1]).first('n'),
    ).toBe(2);
  }
});
