import type { EventProgressTitle, EventUpdateConfig, StatusEvent } from './types';
import { ValidationError } from '../errors';

export const EVENT_PROGRESS_TITLES: readonly EventProgressTitle[] = [
  'Scheduled',
  'Updated',
  'In Progress',
  'Completed',
  'Investigating',
  'Identified',
  'Monitoring',
  'Resolved',
];
export function isEventProgressTitle(value: string): value is EventProgressTitle {
  return EVENT_PROGRESS_TITLES.includes(value as EventProgressTitle);
}
export function eventProgressOptions(
  event: Pick<StatusEvent, 'type' | 'source' | 'status'>,
): EventProgressTitle[] {
  if (event.status !== 'open') return ['Updated'];
  if (event.type === 'maintenance') return ['Scheduled', 'Updated', 'In Progress', 'Completed'];
  return [
    'Investigating',
    'Identified',
    'Monitoring',
    'Updated',
    ...(event.source === 'manual' ? ['Resolved' as const] : []),
  ];
}
export const completesEvent = (title: EventProgressTitle) => title === 'Completed' || title === 'Resolved';
export function resolveEventUpdateConfig(event: StatusEvent, config: EventUpdateConfig) {
  const title =
    config.title ?? (config.resolve ? (event.type === 'maintenance' ? 'Completed' : 'Resolved') : 'Updated');
  if (!eventProgressOptions(event).includes(title)) throw new ValidationError('event_progress_unavailable');
  const resolve = completesEvent(title);
  if (config.resolve !== undefined && config.resolve !== resolve)
    throw new ValidationError('event_progress_conflict');
  return { title, body: config.body, resolve };
}
