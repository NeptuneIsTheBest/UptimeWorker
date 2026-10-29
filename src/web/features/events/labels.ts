import type { StatusEvent } from '../../../shared/events/types';

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
