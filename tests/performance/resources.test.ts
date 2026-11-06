import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listEvents, listPublicEvents } from '../../src/worker/features/events/repository';
import {
  publicMonitors,
  type DailyRow,
  type PublicMonitorRow,
} from '../../src/worker/features/status/aggregation';
import { getStatus } from '../../src/worker/features/status/queries';
import { DAY } from '../../src/worker/lib/time';
import { databaseFixture, environment, httpConfig, resetDatabase, timestamp } from '../support/fixtures';
import { baselineMonitors, baselinePublicEvents, medianMs } from './baseline';
import { wrapDatabase } from '../support/database';

describe('resource usage on isolated D1 data', () => {
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

  async function seedMonitors(count: number) {
    await fixture.db
      .prepare(
        `WITH RECURSIVE n(x) AS (
      VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x + 1 < ?
    ) INSERT INTO monitors(id, name, type, config_json, timeout_seconds, created_at, updated_at)
      SELECT printf('m%04d', x), printf('Monitor %04d', x), 'http', ?, 10, ?, ? FROM n`,
      )
      .bind(count, JSON.stringify(httpConfig), timestamp, timestamp)
      .run();
  }

  function captureBatches() {
    const batches: D1Result[][] = [];
    const db = wrapDatabase(fixture.db, {
      batch: async <T>(statements: D1PreparedStatement[]) => {
        const results = await fixture.db.batch<T>(statements);
        batches.push(results);
        return results;
      },
    });
    return { db, batches };
  }

  it.each([10, 100, 500])(
    'aggregates %s monitors with 90 daily rows each without changing the response',
    async (count) => {
      await seedMonitors(count);
      await fixture.db
        .prepare(
          `WITH RECURSIVE days(n) AS (
      VALUES(0) UNION ALL SELECT n + 1 FROM days WHERE n < 89
    ) INSERT INTO daily_stats(monitor_id, day, total, successful)
      SELECT id, strftime('%Y-%m-%d', (? - (89 - n) * ?) / 1000, 'unixepoch'), 1440, 1439
      FROM monitors CROSS JOIN days`,
        )
        .bind(timestamp, DAY)
        .run();
      const { db, batches } = captureBatches();
      const response = await getStatus(environment(db), timestamp);
      const snapshot = batches.find((batch) => batch.length === 2)!;
      const rows = snapshot[0].results as unknown as PublicMonitorRow[];
      const daily = snapshot[1].results as unknown as DailyRow[];
      expect(response.monitors).toEqual(baselineMonitors(rows, daily, timestamp));
      expect(response.monitors).toHaveLength(count);
      expect(rows[0]).not.toHaveProperty('config_json');
      expect(rows[0]).not.toHaveProperty('timeout_seconds');
      expect(daily).toHaveLength(count * 90);
      console.info(
        JSON.stringify({
          benchmark: 'status_aggregation',
          monitors: count,
          dailyRows: daily.length,
          baselineMs: medianMs(() => baselineMonitors(rows, daily, timestamp)),
          optimizedMs: medianMs(() => publicMonitors(rows, daily, timestamp)),
          snapshotRowsRead: snapshot.reduce((sum, query) => sum + query.meta.rows_read, 0),
          snapshotRowsWritten: snapshot.reduce((sum, query) => sum + query.meta.rows_written, 0),
        }),
      );
    },
  );

  it('reads fewer than 100 parent rows for five open events among ten thousand events', async () => {
    await seedMonitors(1);
    await fixture.db
      .prepare(
        `WITH RECURSIVE n(x) AS (
      VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 10000
    ) INSERT INTO events(id, title, body, type, source, status, started_at, created_at, updated_at)
      SELECT printf('e%05d', x), 'Incident', 'Body', 'incident', 'manual',
        CASE WHEN x <= 5 THEN 'open' ELSE 'resolved' END, x, x, x FROM n`,
      )
      .run();
    await fixture.db
      .prepare(
        `INSERT INTO event_monitors(event_id, monitor_key, monitor_id, monitor_name)
      SELECT id, 'm0000', 'm0000', 'Monitor 0000' FROM events
      WHERE CAST(substr(id, 2) AS INTEGER) % 100 = 0 OR status = 'open'`,
      )
      .run();
    await fixture.db
      .prepare(
        `INSERT INTO event_updates(id, event_id, title, body, source, created_at)
      SELECT 'update-' || id, id, 'Updated', 'Progress', 'manual', updated_at FROM events`,
      )
      .run();
    const baseline = await fixture.db.prepare(baselinePublicEvents).all<{ id: string }>();
    const { db, batches } = captureBatches();
    const events = await listPublicEvents(db);
    expect(events.map((event) => event.id)).toEqual(baseline.results.map((event) => event.id));
    expect(events).toHaveLength(25);
    expect(events.every((event) => event.updates.length === 1)).toBe(true);
    const [parents] = batches[0];
    expect(parents.meta.rows_read).toBeLessThan(100);
    const adminCapture = captureBatches();
    const admin = await listEvents(adminCapture.db);
    expect(admin.events.map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(admin.events.every((event) => event.version === 1 && event.updates.length === 1)).toBe(true);
    expect(adminCapture.batches[0][0].meta.rows_read).toBeLessThan(100);
    const next = await listEvents(adminCapture.db, { cursor: admin.nextCursor! });
    expect(next.events).toHaveLength(25);
    expect(next.events.filter((event) => event.status === 'open')).toEqual(
      admin.events.filter((event) => event.status === 'open'),
    );
    const closedIds = [...admin.events, ...next.events]
      .filter((event) => event.status !== 'open')
      .map((event) => event.id);
    expect(new Set(closedIds).size).toBe(40);
    console.info(
      JSON.stringify({
        benchmark: 'admin_events',
        events: 10000,
        returned: admin.events.length,
        parentRowsRead: adminCapture.batches[0][0].meta.rows_read,
        nextPageParentRowsRead: adminCapture.batches[1][0].meta.rows_read,
        fullSnapshotRowsRead: adminCapture.batches[0].reduce((sum, query) => sum + query.meta.rows_read, 0),
      }),
    );
    const scoped = await listPublicEvents(db, 'm0000');
    expect(scoped).toHaveLength(25);
    expect(scoped.every((event) => event.monitors[0]?.id === 'm0000')).toBe(true);
    expect(batches[1][0].meta.rows_read).toBeLessThan(1000);
    const scopeReads = batches[1][0].meta.rows_read;
    await fixture.db
      .prepare(
        `INSERT INTO events(id, title, body, type, source, status, started_at, created_at, updated_at)
      SELECT 'other-' || id, title, body, type, source, status, started_at, created_at, updated_at FROM events`,
      )
      .run();
    expect(await listPublicEvents(db, 'm0000')).toEqual(scoped);
    expect(batches[2][0].meta.rows_read).toBe(scopeReads);
    console.info(
      JSON.stringify({
        benchmark: 'public_events',
        events: 10000,
        returned: events.length,
        baselineParentRowsRead: baseline.meta.rows_read,
        optimizedParentRowsRead: parents.meta.rows_read,
        fullSnapshotRowsRead: batches[0].reduce((sum, query) => sum + query.meta.rows_read, 0),
        fullSnapshotRowsWritten: batches[0].reduce((sum, query) => sum + query.meta.rows_written, 0),
        scopedParentRowsRead: scopeReads,
      }),
    );
  });

  it('writes six rows per ordinary same-day success, with no writes on replay', async () => {
    await seedMonitors(1);
    const insert = fixture.db.prepare(`INSERT OR IGNORE INTO check_results
      (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms)
      VALUES ('m0000', 1, ?, ?, 1, 42)`);
    const first = await insert.bind(timestamp, timestamp).run();
    const next = timestamp + 60_000;
    const steady = await insert.bind(next, next).run();
    const replay = await insert.bind(next, next).run();
    expect(steady.meta.rows_written).toBe(6);
    expect(replay.meta.rows_written).toBe(0);
    expect(await fixture.db.prepare('SELECT total, successful FROM daily_stats').first()).toEqual({
      total: 2,
      successful: 2,
    });
    console.info(
      JSON.stringify({
        benchmark: 'successful_check',
        firstDayRowsWritten: first.meta.rows_written,
        sameDayRowsRead: steady.meta.rows_read,
        sameDayRowsWritten: steady.meta.rows_written,
        replayRowsWritten: replay.meta.rows_written,
      }),
    );
  });
});
