import type { EventConfig, EventUpdateConfig } from './types';
import { ValidationError } from '../errors';
import { object, parseText } from '../validation';
import { isEventProgressTitle, completesEvent } from './progress';

export function parseEventConfig(value: unknown, allowEmptyMonitors = false): EventConfig {
  const v = object(value);
  const title = parseText(v.title, 'event_title', 120);
  const body = parseText(v.body, 'event_body', 4000);
  if (v.type !== 'incident' && v.type !== 'maintenance') throw new ValidationError('event_type_invalid');
  if (
    !Array.isArray(v.monitorIds) ||
    (!v.monitorIds.length && !allowEmptyMonitors) ||
    v.monitorIds.some((id) => typeof id !== 'string' || !id || id.length > 100)
  )
    throw new ValidationError('event_monitors_invalid');
  const monitorIds = [...new Set(v.monitorIds as string[])];
  if (v.type === 'incident') return { title, body, type: v.type, monitorIds, startsAt: null, endsAt: null };
  if (
    !Number.isSafeInteger(v.startsAt) ||
    !Number.isSafeInteger(v.endsAt) ||
    Number(v.startsAt) < 0 ||
    Number(v.endsAt) <= Number(v.startsAt) ||
    Number(v.endsAt) > 8_640_000_000_000_000
  )
    throw new ValidationError('maintenance_time_invalid');
  return { title, body, type: v.type, monitorIds, startsAt: Number(v.startsAt), endsAt: Number(v.endsAt) };
}
export function parseEventUpdateConfig(value: unknown): EventUpdateConfig {
  const v = object(value);
  const title =
    v.title == null || (typeof v.title === 'string' && !v.title.trim())
      ? null
      : parseText(v.title, 'progress_title', 120);
  const body = parseText(v.body, 'progress_body', 4000);
  if (title !== null && !isEventProgressTitle(title)) throw new ValidationError('event_progress_invalid');
  if (v.resolve !== undefined && typeof v.resolve !== 'boolean')
    throw new ValidationError('event_resolve_invalid');
  if (title !== null && v.resolve !== undefined && v.resolve !== completesEvent(title))
    throw new ValidationError('event_progress_conflict');
  return { title, body, ...(v.resolve !== undefined ? { resolve: v.resolve } : {}) };
}
