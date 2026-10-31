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
  if (event.type === 'maintenance') return ['Scheduled', 'In Progress', 'Completed', 'Updated'];
  return [
    'Investigating',
    'Identified',
    'Monitoring',
    ...(event.source === 'manual' ? ['Resolved' as const] : []),
    'Updated',
  ];
}
export const completesEvent = (title: EventProgressTitle) => title === 'Completed' || title === 'Resolved';
export function resolveEventUpdateConfig(event: StatusEvent, config: EventUpdateConfig) {
  const { title, body } = config;
  if (!eventProgressOptions(event).includes(title)) throw new ValidationError('event_progress_unavailable');
  return { title, body, resolve: completesEvent(title) };
}
