import { afterEach, beforeEach, expect, it } from 'vitest';
import { findMonitor } from '../../src/worker/features/monitors/repository';
import { databaseFixture, httpConfig, timestamp } from '../support/fixtures';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
beforeEach(async () => {
  fixture = await databaseFixture();
});
afterEach(async () => {
  await fixture?.dispose();
});

// Omit optional columns so these tests exercise SQL defaults, not repository defaults.
async function insertMonitor(id = 'monitor') {
  await fixture.db
    .prepare(
      `INSERT INTO monitors(id, name, type, config_json, timeout_seconds, created_at, updated_at)
      VALUES (?, 'Monitor', 'http', ?, 10, ?, ?)`,
    )
    .bind(id, JSON.stringify(httpConfig), timestamp, timestamp)
    .run();
}

it('initializes settings, scheduler state and Ungrouped on an empty database', async () => {
  const db = fixture.db;
  expect((await db.prepare('SELECT * FROM global_settings').all()).results).toEqual([
    {
      id: 1,
      waf_bypass_enabled: 0,
      waf_bypass_token: null,
      version: 1,
      page_refresh_seconds: 30,
      auto_incident_after_minutes: 5,
      workers_plan: 'free',
      probe_concurrency: 4,
      max_checks_per_run: 10,
      time_budget_seconds: 50,
    },
  ]);
  expect((await db.prepare('SELECT * FROM scheduler_state').all()).results).toEqual([
    { id: 1, lease_owner: null, lease_until: 0, last_completed_slot: 0 },
  ]);
  expect((await db.prepare('SELECT * FROM monitor_groups').all()).results).toEqual([
    { id: '__ungrouped__', name: '', sort_order: 0, version: 1, created_at: 0 },
  ]);
  for (const table of [
    'monitors',
    'check_results',
    'daily_stats',
    'events',
    'event_monitors',
    'event_updates',
    'monitor_outages',
    'event_suppressions',
  ]) {
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0);
  }
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

it('defaults new monitors to one-minute intervals and ungrouped position zero', async () => {
  await insertMonitor();
  expect(await findMonitor(fixture.db, 'monitor')).toMatchObject({
    interval_minutes: 1,
    enabled: 1,
    version: 1,
    next_check_at: 0,
    last_checked_at: null,
    last_ok: null,
    last_latency_ms: null,
    last_error_code: null,
    group_id: null,
    sort_order: 0,
  });
});

it.each([
  ['interval_minutes', [1, 2, 7, 60], [0, 61, 1.5, null]],
  ['sort_order', [0, 1, 1000000], [-1, 1.5, null]],
] as const)('enforces monitor %s boundaries', async (column, valid, invalid) => {
  await insertMonitor();
  const update = fixture.db.prepare(`UPDATE monitors SET ${column} = ? WHERE id = 'monitor'`);
  for (const value of valid) await update.bind(value).run();
  for (const value of invalid) await expect(update.bind(value).run()).rejects.toThrow();
});

it.each([
  ['page_refresh_seconds', [0, 5, 15, 30, 60, 127, 3600], [-1, 1, 4, 3601, 15.5, null]],
  ['auto_incident_after_minutes', [0, 1, 5, 1440], [-1, 1441, 1.2, null]],
  ['workers_plan', ['free', 'paid'], ['invalid', null]],
  ['probe_concurrency', [1, 4, 6], [0, 7, 1.5, null]],
  ['max_checks_per_run', [1, 10, 500], [0, 501, 1.5, null]],
  ['time_budget_seconds', [40, 50, 180], [39, 181, 50.5, null]],
] as const)('enforces global setting %s boundaries', async (column, valid, invalid) => {
  const update = fixture.db.prepare(`UPDATE global_settings SET ${column} = ? WHERE id = 1`);
  for (const value of valid) await update.bind(value).run();
  for (const value of invalid) await expect(update.bind(value).run()).rejects.toThrow();
});

it.each([
  [
    'monitors_due',
    'SELECT * FROM monitors WHERE enabled = 1 AND next_check_at <= 0 ORDER BY next_check_at, id LIMIT 10',
  ],
  [
    'monitors_display_order',
    'SELECT * FROM monitors WHERE group_id IS NULL ORDER BY sort_order, created_at, id',
  ],
])('uses %s for monitor queries', async (index, query) => {
  const plan = await fixture.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
  expect(JSON.stringify(plan.results)).toContain(index);
});

it('requires fixed progress titles and reserves Stopped for automatic records', async () => {
  const db = fixture.db;
  await db
    .prepare(
      `INSERT INTO events(id, title, body, type, source, started_at, created_at, updated_at)
      VALUES ('incident', 'Incident', 'Investigating', 'incident', 'manual', ?, ?, ?)`,
    )
    .bind(timestamp, timestamp, timestamp)
    .run();
  const insert = db.prepare(
    `INSERT INTO event_updates(id, event_id, title, body, source, created_at)
    VALUES (?, 'incident', ?, 'Update', ?, ?)`,
  );
  for (const title of [
    'Scheduled',
    'Updated',
    'In Progress',
    'Completed',
    'Investigating',
    'Identified',
    'Monitoring',
    'Resolved',
  ])
    await insert.bind(title, title, 'manual', timestamp).run();
  for (const title of [null, '', 'Free-form title', 'Stopped'])
    await expect(insert.bind(crypto.randomUUID(), title, 'manual', timestamp).run()).rejects.toThrow();
  await expect(
    db
      .prepare(
        `INSERT INTO event_updates(id, event_id, body, source, created_at)
    VALUES ('untitled', 'incident', 'Update', 'manual', ?)`,
      )
      .bind(timestamp)
      .run(),
  ).rejects.toThrow();
  await insert.bind('stopped', 'Stopped', 'automatic', timestamp).run();
  expect(await db.prepare('SELECT COUNT(*) AS n FROM event_updates').first('n')).toBe(9);
});

it('aggregates each check once and cascades only the deleted monitor history', async () => {
  const db = fixture.db;
  await insertMonitor();
  await insertMonitor('other');
  const check = db.prepare(
    `INSERT OR IGNORE INTO check_results
    (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
    VALUES (?, 1, ?, ?, ?, 42)`,
  );
  await db.batch([
    check.bind('monitor', timestamp, timestamp, 0),
    check.bind('monitor', timestamp, timestamp, 0),
    check.bind('monitor', timestamp + 60_000, timestamp + 60_000, 1),
    check.bind('other', timestamp, timestamp, 0),
  ]);
  expect(await findMonitor(db, 'monitor')).toMatchObject({
    last_ok: 1,
    next_check_at: timestamp + 120_000,
  });
  expect(
    await db.prepare("SELECT total, successful FROM daily_stats WHERE monitor_id = 'monitor'").first(),
  ).toEqual({ total: 2, successful: 1 });
  await db.prepare("DELETE FROM monitors WHERE id = 'monitor'").run();
  for (const table of ['check_results', 'daily_stats', 'monitor_outages']) {
    expect(
      await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE monitor_id = 'monitor'`).first('n'),
    ).toBe(0);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE monitor_id = 'other'`).first('n')).toBe(
      1,
    );
  }
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
