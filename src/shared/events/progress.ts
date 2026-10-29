import type { EventProgressTitle, EventUpdateConfig, StatusEvent } from './types';
import { ValidationError } from '../errors';

export const EVENT_PROGRESS_LABELS: Record<EventProgressTitle, string> = {
  Scheduled: '计划维护',
  Updated: '进展更新',
  'In Progress': '维护进行中',
  Completed: '维护完成',
  Investigating: '正在排查',
  Identified: '已定位问题',
  Monitoring: '持续观察',
  Resolved: '故障恢复',
};
export function isEventProgressTitle(value: string): value is EventProgressTitle {
  return Object.hasOwn(EVENT_PROGRESS_LABELS, value);
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
  if (!eventProgressOptions(event).includes(title)) throw new ValidationError('当前事件不能使用此进展阶段');
  const resolve = completesEvent(title);
  if (config.resolve !== undefined && config.resolve !== resolve)
    throw new ValidationError('进展阶段与完成状态不一致');
  return { title, body: config.body, resolve };
}
