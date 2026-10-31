import { intlLocale, type Locale } from '../../../shared/locale';
import { translate, type MessageKey } from '../../i18n/core';
import type { EventUpdate, StatusEvent } from '../../../shared/events/types';

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

export function eventTime(time: number, locale: Locale = 'zh-CN') {
  let formatter = dateFormats.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    dateFormats.set(locale, formatter);
  }
  return formatter.format(time);
}

export function relativeEventTime(time: number, now: number, locale: Locale = 'zh-CN') {
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return translate(locale, 'time.justNow');
  let relativeTime = relativeFormats.get(locale);
  if (!relativeTime) {
    relativeTime = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' });
    relativeFormats.set(locale, relativeTime);
  }
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

type EventEntry = Omit<EventUpdate, 'status'>;
function initialEntry(event: StatusEvent): EventEntry {
  return {
    id: `initial-${event.id}`,
    title: event.type === 'maintenance' ? 'Scheduled' : 'Investigating',
    body: event.body,
    createdAt: event.createdAt,
    source: event.source,
  };
}
// The API orders updates by createdAt, then id, ascending. Preserve that tie-break.
export function latestEventEntry(event: StatusEvent): EventEntry {
  return event.updates.at(-1) ?? initialEntry(event);
}
export function eventTimeline(event: StatusEvent): EventEntry[] {
  const updates = [...event.updates].reverse();
  return [...updates, initialEntry(event)];
}

export const PROGRESS_LABELS: Record<EventUpdate['title'], MessageKey> = {
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
// Automatic titles store the monitor name at publication followed by this fixed suffix.
export function localizedEventTitle(event: Pick<StatusEvent, 'source' | 'title'>, locale: Locale) {
  const suffix = ' 服务异常';
  return event.source === 'automatic'
    ? translate(locale, 'auto.title', { name: event.title.slice(0, -suffix.length) })
    : event.title;
}
export function localizedEntryBody(entry: Pick<EventEntry, 'source' | 'title' | 'body'>, locale: Locale) {
  if (entry.source !== 'automatic') return entry.body;
  // Automatic entries are the initial incident, recovery, or stopped tracking.
  return translate(
    locale,
    entry.title === 'Resolved' ? 'auto.recovered' : entry.title === 'Stopped' ? 'auto.stopped' : 'auto.body',
  );
}
