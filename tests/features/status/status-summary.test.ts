import { describe, expect, it } from 'vitest';
import type { MonitorStatus } from '../../../src/shared/monitors/types';
import type { StatusEvent } from '../../../src/shared/events/types';
import { getStatusSummary } from '../../../src/web/features/status/summary';

const now = Date.UTC(2026, 9, 29, 2);
function event(changes: Partial<StatusEvent> = {}): StatusEvent {
  return {
    id: 'incident',
    title: '故障排查',
    body: '正在处理',
    type: 'incident',
    source: 'manual',
    status: 'open',
    startsAt: null,
    endsAt: null,
    startedAt: now - 60_000,
    endedAt: null,
    createdAt: now - 60_000,
    updatedAt: now,
    monitors: [{ id: 'node', name: '节点' }],
    updates: [],
    ...changes,
  };
}

describe('homepage status summary', () => {
  it.each(['manual', 'automatic'] as const)(
    'shows an open %s incident despite successful probes',
    (source) => {
      const summary = getStatusSummary(['up', 'paused'], [event({ source })], now, false);
      expect(summary).toMatchObject({
        tone: 'attention',
        title: '部分服务需要关注',
        icon: 'info',
      });
      expect(summary.description).toContain('1 条未解决故障');
      expect(summary.description).not.toMatch(/0 项|0 条/);
    },
  );

  it('counts incidents, failed probes and stale data separately', () => {
    const summary = getStatusSummary(['up', 'down', 'stale'], [event(), event({ id: 'second' })], now, false);
    expect(summary.description).toContain('2 条未解决故障，1 项服务异常，1 项数据过期');
  });

  it('keeps an orphaned open incident visible even with no active monitors', () => {
    expect(
      getStatusSummary([], [event({ monitors: [{ id: null, name: '已删除节点' }] })], now, false).tone,
    ).toBe('attention');
  });

  it('ignores resolved and stopped events when probes are healthy', () => {
    const events = [
      event({ status: 'resolved' }),
      event({ id: 'stopped', status: 'stopped' }),
      event({
        id: 'maintenance',
        type: 'maintenance',
        startsAt: now - 60_000,
        endsAt: now,
        status: 'resolved',
      }),
    ];
    expect(getStatusSummary(['up'], events, now, false)).toMatchObject({
      tone: 'healthy',
      title: '全部服务正常',
      icon: 'check',
    });
    expect(getStatusSummary(['down'], events, now, false).tone).toBe('attention');
  });

  it('starts maintenance at its start time and keeps overdue maintenance until completion', () => {
    const maintenance = event({ type: 'maintenance', startsAt: now, endsAt: now + 60_000 });
    expect(getStatusSummary(['up'], [maintenance], now - 1, false).tone).toBe('healthy');
    expect(getStatusSummary(['up'], [maintenance], now, false)).toMatchObject({
      tone: 'maintenance',
      title: '维护进行中',
      icon: 'info',
    });
    expect(getStatusSummary(['up'], [maintenance], now + 59_999, false).description).not.toContain(
      '已过计划时间',
    );
    for (const time of [now + 60_000, now + 120_000]) {
      const summary = getStatusSummary(['up'], [maintenance], time, false);
      expect(summary.tone).toBe('maintenance');
      expect(summary.description).toContain('1 项维护尚未完成，其中 1 项已过计划时间');
    }
    expect(
      getStatusSummary(['up'], [{ ...maintenance, status: 'resolved' }], now + 120_000, false).tone,
    ).toBe('healthy');
  });

  it('prioritizes data errors and faults over active maintenance, and maintenance over waiting', () => {
    const maintenance = event({ type: 'maintenance', startsAt: now - 60_000, endsAt: now + 60_000 });
    for (const statuses of [['up'], ['unknown'], ['paused'], []] as MonitorStatus[][]) {
      expect(getStatusSummary(statuses, [maintenance], now, false).tone).toBe('maintenance');
      expect(getStatusSummary(statuses, [maintenance, event()], now, false).tone).toBe('attention');
    }
    for (const status of ['down', 'stale'] as const)
      expect(getStatusSummary([status], [maintenance], now, false).tone).toBe('attention');
    expect(getStatusSummary(['down'], [maintenance, event()], now, true)).toMatchObject({
      tone: 'attention',
      title: '状态暂时不可用',
      icon: 'info',
    });
  });

  it.each<{ statuses: MonitorStatus[]; title: string }>([
    { statuses: ['up', 'paused'], title: '全部服务正常' },
    { statuses: ['up', 'unknown'], title: '等待首次检测' },
    { statuses: ['paused'], title: '监控已暂停' },
    { statuses: [], title: '暂无监控' },
  ])('preserves the existing summary for $statuses without active events', ({ statuses, title }) => {
    expect(getStatusSummary(statuses, [], now, false).title).toBe(title);
  });
});
