import { expect, it } from 'vitest';
import { publicMonitors, type PublicMonitorRow } from '../../../src/worker/features/status/aggregation';
import { DAY } from '../../../src/worker/lib/time';

it('keeps UTC day boundaries, sparse data, monitor order and sample-weighted 30-day totals', () => {
  const now = Date.UTC(2026, 10, 1);
  const monitor: PublicMonitorRow = {
    id: 'a',
    name: 'A',
    group_id: null,
    type: 'http',
    enabled: 1,
    interval_minutes: 1,
    last_checked_at: now,
    last_ok: 1,
    last_latency_ms: 42,
  };
  const daily = [
    { monitor_id: 'a', day: '2026-10-02', total: 100, successful: 0 },
    { monitor_id: 'a', day: '2026-10-03', total: 2, successful: 1 },
    { monitor_id: 'a', day: '2026-11-01', total: 8, successful: 8 },
    { monitor_id: 'a', day: '2026-11-02', total: 100, successful: 0 },
    { monitor_id: 'unrelated', day: '2026-11-01', total: 100, successful: 0 },
  ];
  const [empty, filled] = publicMonitors([{ ...monitor, id: 'b', enabled: 0 }, monitor], daily, now);
  expect(empty.id).toBe('b');
  expect(empty.status).toBe('paused');
  expect(empty.uptime30d).toBeNull();
  expect(empty.days.every((day) => day.total === 0 && day.uptime === null)).toBe(true);
  expect(filled.days).toHaveLength(90);
  expect(filled.days[0].day).toBe(new Date(now - 89 * DAY).toISOString().slice(0, 10));
  expect(filled.days.at(-1)).toEqual({ day: '2026-11-01', total: 8, successful: 8, uptime: 100 });
  expect(filled.uptime30d).toBe(90);
  expect(publicMonitors([monitor], daily, now - 1)[0].days.at(-1)?.day).toBe('2026-10-31');
});
