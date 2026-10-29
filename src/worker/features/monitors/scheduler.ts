import type { ProbeResult } from '../../../shared/monitors/types';
import { monitorConfig } from './repository';
import { utcDay, dayStart, DAY } from '../../lib/time';
import type { Env } from '../../types';
import type { MonitorRow, Probe } from './types';
import { getProbeSnapshot } from './snapshot';

const SLOT = 60_000;

interface RunMetrics {
  claimed: boolean;
  checked: number;
  stored: number;
  rowsRead: number;
  rowsWritten: number;
  elapsedMs: number;
}

async function mapConcurrent<T, U>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<U>,
): Promise<U[]> {
  const result: U[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        result[index] = await work(values[index]);
      }
    }),
  );
  return result;
}

export async function runScheduled(
  env: Pick<Env, 'DB'>,
  scheduledTime: number,
  probe: Probe,
  now = () => Date.now(),
): Promise<RunMetrics> {
  const started = now();
  const slot = Math.floor(scheduledTime / SLOT) * SLOT;
  const owner = crypto.randomUUID();
  const metrics: RunMetrics = {
    claimed: false,
    checked: 0,
    stored: 0,
    rowsRead: 0,
    rowsWritten: 0,
    elapsedMs: 0,
  };
  const count = (results: Pick<D1Result, 'meta'>[]) =>
    results.forEach(({ meta }) => {
      metrics.rowsRead += meta.rows_read ?? 0;
      metrics.rowsWritten += meta.rows_written ?? 0;
    });
  const lease = await env.DB.prepare(
    `UPDATE scheduler_state SET lease_owner = ?, lease_until = ?
    WHERE id = 1 AND lease_until <= ? AND last_completed_slot < ? RETURNING id`,
  )
    .bind(owner, started + 240_000, started, slot)
    .all();
  count([lease]);
  if (!lease.results.length) return metrics;
  metrics.claimed = true;
  try {
    const { monitors, options, reads } = await getProbeSnapshot(env.DB);
    count(reads);
    const due = monitors.filter((row) => row.enabled === 1 && row.next_check_at <= slot).slice(0, 10);
    const results = await mapConcurrent(
      due,
      4,
      async (row): Promise<{ row: MonitorRow; result: ProbeResult } | null> => {
        try {
          return { row, result: await probe(monitorConfig(row), options) };
        } catch {
          console.error(JSON.stringify({ event: 'probe_internal_error', monitorId: row.id }));
          return null;
        }
      },
    );
    const completed = results.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    metrics.checked = completed.length;
    if (completed.length) {
      const writes = await env.DB.batch(
        completed.map(({ row, result }) =>
          env.DB.prepare(
            `
        INSERT OR IGNORE INTO check_results (monitor_id, monitor_version, scheduled_at, checked_at, ok, latency_ms, http_status, error_code)
        SELECT id, version, ?, ?, ?, ?, ?, ? FROM monitors WHERE id = ? AND version = ? AND enabled = 1
          AND EXISTS (SELECT 1 FROM scheduler_state WHERE id = 1 AND lease_owner = ? AND lease_until > ?)`,
          ).bind(
            slot,
            result.checkedAt,
            Number(result.ok),
            result.latencyMs,
            result.httpStatus,
            result.errorCode,
            row.id,
            row.version,
            owner,
            now(),
          ),
        ),
      );
      count(writes);
      metrics.stored = writes.filter((write) => write.meta.changes > 0).length;
    }
    // A bounded cleanup each tick catches up after long downtimes without a large transaction.
    const housekeeping = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM event_suppressions WHERE id IN
        (SELECT id FROM event_suppressions WHERE ends_at < ? ORDER BY ends_at LIMIT 100)`,
      ).bind(now() - 7 * DAY),
      env.DB.prepare(
        `DELETE FROM check_results WHERE id IN
        (SELECT id FROM check_results WHERE checked_at < ? ORDER BY checked_at LIMIT 500)`,
      ).bind(now() - 7 * DAY),
      env.DB.prepare(
        `DELETE FROM daily_stats WHERE (monitor_id, day) IN
        (SELECT monitor_id, day FROM daily_stats WHERE day < ? ORDER BY day LIMIT 100)`,
      ).bind(utcDay(dayStart(now()) - 89 * DAY)),
      env.DB.prepare(
        `UPDATE scheduler_state SET last_completed_slot = ?, lease_until = 0, lease_owner = NULL
        WHERE id = 1 AND lease_owner = ? AND lease_until > ?`,
      ).bind(slot, owner, now()),
    ]);
    count(housekeeping);
    return metrics;
  } finally {
    const released = await env.DB.prepare(
      'UPDATE scheduler_state SET lease_until = 0, lease_owner = NULL WHERE id = 1 AND lease_owner = ?',
    )
      .bind(owner)
      .run();
    count([released]);
    metrics.elapsedMs = Math.max(0, now() - started);
    console.info(JSON.stringify({ event: 'scheduled_run', ...metrics }));
  }
}
