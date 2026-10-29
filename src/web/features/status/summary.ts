import { translator, type Locale } from '../../i18n/core';
import type { MonitorStatus } from '../../../shared/monitors/types';
import type { StatusEvent } from '../../../shared/events/types';

interface StatusSummary {
  tone: 'healthy' | 'attention' | 'maintenance' | 'waiting';
  title: string;
  description?: string;
  icon: 'check' | 'info' | 'pulse';
}

export function getStatusSummary(
  statuses: MonitorStatus[],
  events: StatusEvent[],
  now: number,
  hasError: boolean,
  locale: Locale = 'zh-CN',
): StatusSummary {
  const t = translator(locale);
  const attention = { tone: 'attention', icon: 'info' } as const;
  if (hasError)
    return {
      ...attention,
      title: t('summary.unavailable'),
    };

  const open = events.filter((event) => event.status === 'open');
  const incidents = open.filter((event) => event.type === 'incident').length;
  const down = statuses.filter((status) => status === 'down').length;
  const stale = statuses.filter((status) => status === 'stale').length;
  if (incidents || down || stale) {
    const reasons = [
      incidents ? t('summary.incidentCount', { count: incidents }) : '',
      down ? t('summary.downCount', { count: down }) : '',
      stale ? t('summary.staleCount', { count: stale }) : '',
    ].filter(Boolean);
    return {
      ...attention,
      title: t('summary.attention'),
      description: reasons.join(locale === 'en' ? ', ' : '，'),
    };
  }

  const maintenance = open.filter(
    (event) => event.type === 'maintenance' && event.startsAt !== null && event.startsAt <= now,
  );
  if (maintenance.length) {
    const overdue = maintenance.filter((event) => event.endsAt !== null && event.endsAt <= now).length;
    return {
      tone: 'maintenance',
      title: t('summary.maintenance'),
      description: [
        t('summary.maintenanceCount', { count: maintenance.length }),
        ...(overdue ? [t('summary.overdueCount', { count: overdue })] : []),
      ].join(locale === 'en' ? ', ' : '，'),
      icon: 'info',
    };
  }

  const active = statuses.filter((status) => status !== 'paused');
  if (active.length && active.every((status) => status === 'up'))
    return {
      tone: 'healthy',
      title: t('summary.healthy'),
      icon: 'check',
    };

  const waiting = { tone: 'waiting', icon: 'pulse' } as const;
  if (statuses.includes('unknown'))
    return {
      ...waiting,
      title: t('summary.waiting'),
    };
  return statuses.length
    ? {
        ...waiting,
        title: t('monitor.paused'),
      }
    : {
        ...waiting,
        title: t('summary.empty'),
      };
}
