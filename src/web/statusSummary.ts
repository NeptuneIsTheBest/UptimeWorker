import type { MonitorStatus, StatusEvent } from '../shared/types';

interface StatusSummary {
  tone: 'healthy' | 'attention' | 'maintenance' | 'waiting';
  title: string;
  description: string;
  label: string;
  icon: 'check' | 'info' | 'pulse';
}

export function getStatusSummary(
  statuses: MonitorStatus[],
  events: StatusEvent[],
  now: number,
  hasError: boolean,
): StatusSummary {
  const attention = { tone: 'attention', label: 'ATTENTION REQUIRED', icon: 'info' } as const;
  if (hasError)
    return {
      ...attention,
      title: '状态数据暂时不可用。',
      description: '无法获取最新状态，请稍后重试。',
    };

  const open = events.filter((event) => event.status === 'open');
  const incidents = open.filter((event) => event.type === 'incident').length;
  const down = statuses.filter((status) => status === 'down').length;
  const stale = statuses.filter((status) => status === 'stale').length;
  if (incidents || down || stale) {
    const reasons = [
      incidents ? `${incidents} 条未解决故障` : '',
      down ? `${down} 项服务异常` : '',
      stale ? `${stale} 项数据过期` : '',
    ].filter(Boolean);
    return {
      ...attention,
      title: '部分服务需要关注。',
      description: `${reasons.join('，')}。查看${incidents ? '上方事件进展和下方服务' : '下方服务'}了解详情。`,
    };
  }

  const maintenance = open.filter(
    (event) => event.type === 'maintenance' && event.startsAt !== null && event.startsAt <= now,
  );
  if (maintenance.length) {
    const overdue = maintenance.filter((event) => event.endsAt !== null && event.endsAt <= now).length;
    return {
      tone: 'maintenance',
      title: '部分服务正在维护。',
      description: `${maintenance.length} 项维护尚未完成${overdue ? `，其中 ${overdue} 项已过计划时间` : ''}。查看上方事件了解进展。`,
      label: 'MAINTENANCE IN PROGRESS',
      icon: 'info',
    };
  }

  const active = statuses.filter((status) => status !== 'paused');
  if (active.length && active.every((status) => status === 'up'))
    return {
      tone: 'healthy',
      title: '所有服务，运行如常。',
      description: '所有受监控服务运行正常，每一次检测都在为稳定作证。',
      label: 'ALL SYSTEMS OPERATIONAL',
      icon: 'check',
    };

  const waiting = { tone: 'waiting', label: 'READY WHEN YOU ARE', icon: 'pulse' } as const;
  if (statuses.includes('unknown'))
    return {
      ...waiting,
      title: '正在等待第一条心跳。',
      description: '监控已就绪，定时任务每分钟检查到期的监控，正在等待首次结果。',
    };
  return statuses.length
    ? {
        ...waiting,
        title: '监控已暂停。',
        description: '恢复监控后，我们将继续记录服务的每一次响应。',
      }
    : {
        ...waiting,
        title: '从第一条监控开始。',
        description: '添加你的 HTTP 服务或 TCP 端口，即可持续了解它们的运行状态。',
      };
}
