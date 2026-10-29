import { intlLocale, type Locale } from '../../../shared/locale';
import { translate, type MessageKey } from '../../i18n/core';
import { isEventProgressTitle } from '../../../shared/events/progress';
import type { EventProgressTitle, EventUpdate, StatusEvent } from '../../../shared/events/types';

export const eventTime = (time: number, locale: Locale = 'zh-CN') =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(time);

export function relativeEventTime(time: number, now: number, locale: Locale = 'zh-CN') {
  const relativeTime = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' });
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return translate(locale, 'time.justNow');
  for (const [duration, unit] of [
    [604_800_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ] as const) {
    if (elapsed >= duration) return relativeTime.format(-Math.floor(elapsed / duration), unit);
  }
  return translate(locale, 'time.justNow');
}

interface EventEntry {
  id: string;
  title: EventProgressTitle | 'Stopped';
  legacyTitle: string | null;
  body: string;
  createdAt: number;
  source: StatusEvent['source'];
}
function progressEntry(event: StatusEvent, update: EventUpdate): EventEntry {
  const fixedTitle = update.title && isEventProgressTitle(update.title) ? update.title : null;
  return {
    ...update,
    title:
      update.status === 'stopped'
        ? 'Stopped'
        : update.status === 'resolved'
          ? event.type === 'maintenance'
            ? 'Completed'
            : 'Resolved'
          : (fixedTitle ?? 'Updated'),
    legacyTitle: fixedTitle ? null : update.title || null,
  };
}
function initialEntry(event: StatusEvent): EventEntry {
  return {
    id: `initial-${event.id}`,
    title: event.type === 'maintenance' ? 'Scheduled' : 'Investigating',
    legacyTitle: null,
    body: event.body,
    createdAt: event.createdAt,
    source: event.source,
  };
}
// The API orders updates by createdAt, then id, ascending. Preserve that tie-break.
export function latestEventEntry(event: StatusEvent): EventEntry {
  const update = event.updates.at(-1);
  return update ? progressEntry(event, update) : initialEntry(event);
}
export function eventTimeline(event: StatusEvent): EventEntry[] {
  return [...event.updates]
    .reverse()
    .map((update) => progressEntry(event, update))
    .concat(initialEntry(event));
}

export const PROGRESS_LABELS: Record<EventProgressTitle | 'Stopped', MessageKey> = {
  Scheduled: 'progress.Scheduled',
  Updated: 'progress.Updated',
  'In Progress': 'progress.InProgress',
  Completed: 'progress.Completed',
  Investigating: 'progress.Investigating',
  Identified: 'progress.Identified',
  Monitoring: 'progress.Monitoring',
  Resolved: 'progress.Resolved',
  Stopped: 'progress.Stopped',
};
// Recognize only our persisted templates. Manual content and unfamiliar legacy text stay untouched.
export function localizedEventTitle(event: Pick<StatusEvent, 'source' | 'title'>, locale: Locale) {
  const suffix = ' 服务异常';
  return event.source === 'automatic' && event.title.endsWith(suffix)
    ? translate(locale, 'auto.title', { name: event.title.slice(0, -suffix.length) })
    : event.title;
}
export function localizedEntryBody(entry: Pick<EventEntry, 'source' | 'body'>, locale: Locale) {
  if (entry.source !== 'automatic') return entry.body;
  const templates: Record<string, MessageKey> = {
    '定时检测持续失败，已达到自动发布阈值。恢复后将自动更新此事件。': 'auto.body',
    '检测已恢复正常。': 'auto.recovered',
    '节点已删除，已停止跟踪。': 'auto.stopped',
  };
  return Object.hasOwn(templates, entry.body) ? translate(locale, templates[entry.body]) : entry.body;
}
