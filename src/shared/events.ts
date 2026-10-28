import type { EventConfig, StatusEvent } from './types';
import { ValidationError } from './validation';

export function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new ValidationError('请携带有效的版本号');
  return value;
}
export function parseText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new ValidationError(`${label}需为 1–${max} 个字符`);
  return value.trim();
}
export function parseGroup(value: unknown) {
  const v = object(value);
  const name = parseText(v.name, '分组名称', 80);
  const sortOrder = v.sortOrder ?? 0;
  if (
    typeof sortOrder !== 'number' ||
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 1_000_000
  )
    throw new ValidationError('排序需为 0–1000000 的整数');
  return { name, sortOrder };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('请求内容必须是对象');
  return value as Record<string, unknown>;
}
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
export function eventLabel(event: StatusEvent, now: number) {
  if (event.status === 'resolved') return event.type === 'maintenance' ? '已完成' : '已恢复';
  if (event.status === 'stopped') return '已停止跟踪';
  if (event.type === 'maintenance') {
    if (now < event.startsAt!) return '待开始';
    if (now >= event.endsAt!) return '已过计划时间';
    return '维护进行中';
  }
  return '处理中';
}
