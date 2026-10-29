import { isEventProgressTitle } from '../../../shared/events/progress';
import type { EventProgressTitle, EventUpdate, StatusEvent } from '../../../shared/events/types';

export const eventTime = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(time);

const relativeTime = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' });
export function relativeEventTime(time: number, now: number) {
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return '刚刚';
  for (const [duration, unit] of [
    [604_800_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ] as const) {
    if (elapsed >= duration) return relativeTime.format(-Math.floor(elapsed / duration), unit);
  }
  return '刚刚';
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
