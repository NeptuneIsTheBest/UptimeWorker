import { afterAll, beforeAll, expect, it } from 'vitest';
import { findMonitor } from '../../src/worker/features/monitors/repository';
import { applyMigration, databaseFixture, httpConfig, tcpConfig, timestamp } from '../support/fixtures';

// Seed old schemas without using repository code that requires the latest columns.
async function createMonitor(db: D1Database, config: typeof httpConfig | typeof tcpConfig, now: number) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO monitors(id, name, type, config_json, interval_minutes, timeout_seconds,
    enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      config.name,
      config.type,
      JSON.stringify(config),
      config.intervalMinutes,
      config.timeoutSeconds,
      Number(config.enabled),
      now,
      now,
    )
    .run();
  return { id };
}

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
beforeAll(async () => {
  fixture = await databaseFixture('0002_global_settings.sql');
});
afterAll(async () => {
  await fixture?.dispose();
});

it('initializes display positions in legacy order without changing monitoring state or groups', async () => {
  const legacy = await databaseFixture('0007_performance_settings.sql');
  try {
    const db = legacy.db;
    await db
      .prepare("INSERT INTO monitor_groups(id, name, sort_order, created_at) VALUES ('g', 'Group', 42, ?)")
      .bind(timestamp)
      .run();
    for (const [id, groupId, createdAt] of [
      ['b', 'g', timestamp],
      ['a', 'g', timestamp],
      ['c', 'g', timestamp + 1],
      ['u2', null, timestamp + 1],
      ['u1', null, timestamp],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO monitors(id, name, type, config_json, interval_minutes, timeout_seconds,
        enabled, created_at, updated_at, group_id) VALUES (?, ?, 'http', ?, 1, 10, 1, ?, ?, ?)`,
        )
        .bind(id, id, JSON.stringify(httpConfig), createdAt, createdAt, groupId)
        .run();
    }
    await db
      .prepare(
        `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES ('a', 1, ?, ?, 0, 42)`,
      )
      .bind(timestamp, timestamp)
      .run();
    const tables = [
      'monitors',
      'monitor_groups',
      'check_results',
      'daily_stats',
      'monitor_outages',
      'events',
      'global_settings',
      'scheduler_state',
    ];
    // daily_stats is WITHOUT ROWID, so use its primary key instead.
    const read = async () =>
      (
        await db.batch<Record<string, unknown>>(
          tables.map((table) =>
            db.prepare(
              `SELECT * FROM ${table} ORDER BY ${table === 'daily_stats' ? 'monitor_id, day' : 'rowid'}`,
            ),
          ),
        )
      ).map((result) => result.results);
    const before = await read();
    await applyMigration(db, '0008_display_order.sql');
    const after = await read();
    expect(after[0].map(({ sort_order: _, ...row }) => row)).toEqual(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(
      (await db.prepare('SELECT id, sort_order FROM monitors ORDER BY group_id, sort_order').all()).results,
    ).toEqual([
      { id: 'u1', sort_order: 0 },
      { id: 'u2', sort_order: 1 },
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 2 },
    ]);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    for (const invalid of [-1, 1.5, null])
      await expect(
        db.prepare("UPDATE monitors SET sort_order = ? WHERE id = 'a'").bind(invalid).run(),
      ).rejects.toThrow();
  } finally {
    await legacy.dispose();
  }
});

it('adds performance defaults and an indexed due query without altering existing data', async () => {
  const legacy = await databaseFixture('0006_event_update_titles.sql');
  try {
    const db = legacy.db;
    const row = await createMonitor(db, httpConfig, timestamp);
    await db.batch([
      db
        .prepare('UPDATE global_settings SET version = 7, page_refresh_seconds = 127, waf_bypass_token = ?')
        .bind('legacy-secret-'.repeat(4)),
      db
        .prepare(
          'INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms) VALUES (?, 1, ?, ?, 1, 42)',
        )
        .bind(row.id, timestamp, timestamp),
      db
        .prepare('UPDATE scheduler_state SET lease_owner = ?, lease_until = ?')
        .bind('old-lease', timestamp + 240_000),
    ]);
    const tables = ['monitors', 'check_results', 'daily_stats', 'scheduler_state', 'global_settings'];
    const snapshot = async () =>
      (
        await db.batch<Record<string, unknown>>(tables.map((table) => db.prepare(`SELECT * FROM ${table}`)))
      ).map((result) => result.results);
    const before = await snapshot();
    await applyMigration(db, '0007_performance_settings.sql');
    const after = await snapshot();
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4));
    expect(after[4]).toEqual([
      {
        ...before[4][0],
        workers_plan: 'free',
        probe_concurrency: 4,
        max_checks_per_run: 10,
        time_budget_seconds: 50,
      },
    ]);
    const queryPlan = await db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM monitors WHERE enabled = 1 AND next_check_at <= ? ORDER BY next_check_at, id LIMIT 10',
      )
      .bind(timestamp)
      .all();
    expect(JSON.stringify(queryPlan.results)).toContain('monitors_due');
    for (const [column, value] of [
      ['probe_concurrency', 7],
      ['max_checks_per_run', 501],
      ['max_checks_per_run', 1.5],
      ['time_budget_seconds', 39],
      ['workers_plan', 'invalid'],
    ] as const)
      await expect(
        db.prepare(`UPDATE global_settings SET ${column} = ?`).bind(value).run(),
      ).rejects.toThrow();
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await legacy.dispose();
  }
});

it('adds a 30-second refresh default while preserving existing settings and monitoring data', async () => {
  const legacy = await databaseFixture('0003_flexible_intervals.sql');
  try {
    const db = legacy.db;
    const row = (await createMonitor(db, httpConfig, timestamp))!;
    await db.batch([
      db
        .prepare(
          `UPDATE global_settings SET version = 7, waf_bypass_enabled = 1,
        waf_bypass_token = ?, waf_bypass_domains_json = '["legacy.example.com"]'`,
        )
        .bind('existing-secret-'.repeat(4)),
      db
        .prepare(
          `INSERT INTO check_results
        (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
        VALUES (?, 1, ?, ?, 1, 42)`,
        )
        .bind(row.id, timestamp, timestamp),
      db
        .prepare('UPDATE scheduler_state SET lease_owner = ?, lease_until = ?, last_completed_slot = ?')
        .bind('existing-lease', timestamp + 60_000, timestamp),
    ]);
    const queries = ['monitors', 'check_results', 'daily_stats', 'scheduler_state', 'global_settings'];
    const snapshot = async () =>
      (
        await db.batch<Record<string, unknown>>(queries.map((table) => db.prepare(`SELECT * FROM ${table}`)))
      ).map((r) => r.results);
    const before = await snapshot();
    await applyMigration(db, '0004_page_refresh.sql');
    const after = await snapshot();
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4));
    expect(after[4]).toEqual([{ ...before[4][0], page_refresh_seconds: 30 }]);
    for (const seconds of [0, 5, 15, 30, 60, 127, 3600])
      await db.prepare('UPDATE global_settings SET page_refresh_seconds = ?').bind(seconds).run();
    for (const seconds of [-1, 1, 4, 3601, 15.5, null])
      await expect(
        db.prepare('UPDATE global_settings SET page_refresh_seconds = ?').bind(seconds).run(),
      ).rejects.toThrow();
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await legacy.dispose();
  }
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

it('adds groups and events without backfilling incidents or changing legacy monitoring state', async () => {
  const legacy = await databaseFixture('0004_page_refresh.sql');
  try {
    const db = legacy.db;
    const row = await createMonitor(db, httpConfig, timestamp);
    await db
      .prepare(
        `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES (?, 1, ?, ?, 0, 10)`,
      )
      .bind(row.id, timestamp, timestamp)
      .run();
    const before = await db.prepare('SELECT * FROM monitors WHERE id = ?').bind(row.id).first();
    const tables = ['check_results', 'daily_stats', 'global_settings', 'scheduler_state'];
    const previous = await db.batch<Record<string, unknown>>(
      tables.map((table) => db.prepare(`SELECT * FROM ${table}`)),
    );
    await applyMigration(db, '0005_groups_events.sql');
    expect(await db.prepare('SELECT * FROM monitors WHERE id = ?').bind(row.id).first()).toEqual({
      ...before,
      group_id: null,
    });
    const current = await db.batch(tables.map((table) => db.prepare(`SELECT * FROM ${table}`)));
    for (const index of [0, 1, 3]) expect(current[index].results).toEqual(previous[index].results);
    expect(current[2].results).toEqual([{ ...previous[2].results[0], auto_incident_after_minutes: 5 }]);
    for (const table of ['events', 'monitor_outages', 'monitor_groups'])
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0);
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    for (const value of [-1, 1441, 1.2, null])
      await expect(
        db.prepare('UPDATE global_settings SET auto_incident_after_minutes = ?').bind(value).run(),
      ).rejects.toThrow();
  } finally {
    await legacy.dispose();
  }
});

it('adds nullable progress titles while preserving legacy records and automatic lifecycle triggers', async () => {
  const legacy = await databaseFixture('0005_groups_events.sql');
  try {
    const db = legacy.db;
    const row = await createMonitor(db, httpConfig, timestamp);
    await db.batch([
      db
        .prepare(
          `INSERT INTO events(id, title, body, type, source, started_at, created_at, updated_at)
        VALUES ('manual', '故障说明', '处理中', 'incident', 'manual', ?, ?, ?)`,
        )
        .bind(timestamp, timestamp, timestamp),
      db
        .prepare(
          `INSERT INTO events(id, title, body, type, source, auto_monitor_id, started_at, created_at, updated_at)
        VALUES ('automatic', '自动故障', '检测失败', 'incident', 'automatic', ?, ?, ?, ?)`,
        )
        .bind(row.id, timestamp, timestamp, timestamp),
      db
        .prepare(
          `INSERT INTO event_monitors(event_id, monitor_key, monitor_id, monitor_name)
        SELECT id, ?, ?, ? FROM events`,
        )
        .bind(row.id, row.id, httpConfig.name),
      db
        .prepare(
          `INSERT INTO event_updates(id, event_id, body, source, created_at)
        VALUES ('legacy', 'manual', '旧版进展正文', 'manual', ?)`,
        )
        .bind(timestamp),
    ]);
    const tables = [
      'events',
      'event_monitors',
      'monitors',
      'check_results',
      'daily_stats',
      'global_settings',
    ];
    const snapshot = async () =>
      (await db.batch(tables.map((table) => db.prepare(`SELECT * FROM ${table}`)))).map(
        (result) => result.results,
      );
    const before = await snapshot();
    const progress = await db.prepare('SELECT * FROM event_updates').first();
    await applyMigration(db, '0006_event_update_titles.sql');
    expect(await snapshot()).toEqual(before);
    expect(await db.prepare('SELECT * FROM event_updates').first()).toEqual({ ...progress, title: null });

    // Existing writers and database triggers omit the new column during rollout.
    await db
      .prepare(
        `INSERT INTO event_updates(id, event_id, body, source, created_at)
      VALUES ('old-client', 'manual', '兼容旧版写入', 'manual', ?)`,
      )
      .bind(timestamp + 1)
      .run();
    expect(
      await db.prepare("SELECT title FROM event_updates WHERE id = 'old-client'").first('title'),
    ).toBeNull();
    await db
      .prepare(
        `INSERT INTO check_results(monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES (?, 1, ?, ?, 1, 42)`,
      )
      .bind(row.id, timestamp + 60_000, timestamp + 60_000)
      .run();
    expect(await db.prepare("SELECT status FROM events WHERE id = 'automatic'").first('status')).toBe(
      'resolved',
    );
    expect(
      await db
        .prepare("SELECT title, source, status FROM event_updates WHERE event_id = 'automatic'")
        .first(),
    ).toEqual({ title: null, source: 'automatic', status: 'resolved' });
    await db
      .prepare(
        `INSERT INTO events(id, title, body, type, source, auto_monitor_id, started_at, created_at, updated_at)
      VALUES ('stop', '再次故障', '检测失败', 'incident', 'automatic', ?, ?, ?, ?)`,
      )
      .bind(row.id, timestamp, timestamp, timestamp)
      .run();
    await db.prepare('DELETE FROM monitors WHERE id = ?').bind(row.id).run();
    expect(
      await db.prepare("SELECT title, status FROM event_updates WHERE event_id = 'stop'").first(),
    ).toEqual({ title: null, status: 'stopped' });
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {
    await legacy.dispose();
  }
});
