import type { EventConfig, EventUpdateConfig } from './types';
import { ValidationError } from '../errors';
import { object, parseText } from '../validation';
import { isEventProgressTitle, completesEvent } from './progress';

export function parseEventConfig(value: unknown, allowEmptyMonitors = false): EventConfig {
  const v = object(value);
  const title = parseText(v.title, '事件标题', 120);
  const body = parseText(v.body, '事件正文', 4000);
  if (v.type !== 'incident' && v.type !== 'maintenance') throw new ValidationError('事件类型无效');
  if (
    !Array.isArray(v.monitorIds) ||
    (!v.monitorIds.length && !allowEmptyMonitors) ||
    v.monitorIds.length > 10 ||
    v.monitorIds.some((id) => typeof id !== 'string' || !id || id.length > 100)
  )
    throw new ValidationError('请选择 1–10 个关联节点');
  const monitorIds = [...new Set(v.monitorIds as string[])];
  if (v.type === 'incident') return { title, body, type: v.type, monitorIds, startsAt: null, endsAt: null };
  if (
    !Number.isSafeInteger(v.startsAt) ||
    !Number.isSafeInteger(v.endsAt) ||
    Number(v.startsAt) < 0 ||
    Number(v.endsAt) <= Number(v.startsAt) ||
    Number(v.endsAt) > 8_640_000_000_000_000
  )
    throw new ValidationError('请填写有效的维护起止时间，结束时间须晚于开始时间');
  return { title, body, type: v.type, monitorIds, startsAt: Number(v.startsAt), endsAt: Number(v.endsAt) };
}
export function parseEventUpdateConfig(value: unknown): EventUpdateConfig {
  const v = object(value);
  const title =
    v.title == null || (typeof v.title === 'string' && !v.title.trim())
      ? null
      : parseText(v.title, '进展标题', 120);
  const body = parseText(v.body, '进展说明', 4000);
  if (title !== null && !isEventProgressTitle(title)) throw new ValidationError('请选择有效的进展阶段');
  if (v.resolve !== undefined && typeof v.resolve !== 'boolean') throw new ValidationError('完成状态无效');
  if (title !== null && v.resolve !== undefined && v.resolve !== completesEvent(title))
    throw new ValidationError('进展阶段与完成状态不一致');
  return { title, body, ...(v.resolve !== undefined ? { resolve: v.resolve } : {}) };
}
