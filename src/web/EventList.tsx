import type { ReactNode } from 'react';
import type { StatusEvent } from '../shared/types';
import { eventLabel } from '../shared/events';
import { Empty, useNow } from './components';

export const eventTime = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);

export function EventList<T extends StatusEvent>({
  events,
  title,
  variant = 'all',
  actions,
}: {
  events: T[];
  title?: string;
  variant?: 'all' | 'open' | 'history';
  actions?: (event: T) => ReactNode;
}) {
  const now = useNow();
  const visibleEvents = events.filter(
    (event) => variant === 'all' || (variant === 'open' ? event.status === 'open' : event.status !== 'open'),
  );
  if (variant === 'open' && !visibleEvents.length) return null;
  const heading =
    title ?? (variant === 'open' ? '进行中与计划事件' : variant === 'history' ? '历史事件' : '最近事件');
  return (
    <section
      className={`events-section${variant === 'open' ? ' events-section-open' : ''}`}
      aria-label={heading}
    >
      <div className="section-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {variant === 'history' ? '已结束的维护与故障记录' : '维护安排与故障进展'} · 时间按浏览器时区显示
          </p>
        </div>
      </div>
      {!visibleEvents.length ? (
        <Empty title={variant === 'history' ? '暂无历史事件' : '暂无关联事件'} icon="clock">
          {variant === 'history'
            ? '已完成、已恢复和已停止跟踪的事件将在这里展示。'
            : '发布的维护安排和故障进展将在这里展示。'}
        </Empty>
      ) : (
        <div className="event-list">
          {visibleEvents.map((event) => (
            <article className="event-card" key={event.id}>
              <div className="event-heading">
                <div className="event-tags">
                  <span className={`event-status ${event.status === 'open' ? event.type : event.status}`}>
                    {eventLabel(event, now)}
                  </span>
                  <span className="muted">
                    {event.type === 'maintenance' ? '计划维护' : '故障事件'} ·{' '}
                    {event.source === 'automatic' ? '自动检测' : '管理员发布'}
                  </span>
                </div>
                <time className="event-updated" dateTime={new Date(event.updatedAt).toISOString()}>
                  更新于 {eventTime(event.updatedAt)}
                </time>
              </div>
              <h3>{event.title}</h3>
              <div className="event-monitors" aria-label="关联节点">
                {event.monitors.map((monitor, index) =>
                  monitor.id ? (
                    <a key={monitor.id} href={`/monitors/${encodeURIComponent(monitor.id)}`}>
                      {monitor.name}
                    </a>
                  ) : (
                    <span key={`deleted-${index}`}>{monitor.name}（已删除）</span>
                  ),
                )}
              </div>
              <p className="event-body">{event.body}</p>
              {event.type === 'maintenance' && (
                <p className="event-window">
                  计划时间：{eventTime(event.startsAt!)} — {eventTime(event.endsAt!)}
                </p>
              )}
              {event.source === 'automatic' && (
                <p className="event-window">
                  首次失败：{eventTime(event.startedAt)}
                  {event.endedAt !== null && (
                    <>
                      {' '}
                      · {event.status === 'resolved' ? '恢复' : '停止跟踪'}：{eventTime(event.endedAt)} ·
                      持续约 {Math.max(0, Math.round((event.endedAt - event.startedAt) / 60_000))} 分钟
                    </>
                  )}
                </p>
              )}
              {event.updates.length > 0 && (
                <details className="event-progress">
                  <summary>进展记录（{event.updates.length}）</summary>
                  <ol>
                    {event.updates.map((update) => (
                      <li key={update.id}>
                        <div className="muted">
                          <time dateTime={new Date(update.createdAt).toISOString()}>
                            {eventTime(update.createdAt)}
                          </time>{' '}
                          · {update.source === 'automatic' ? '自动检测' : '管理员'}
                          {update.status === 'resolved'
                            ? ' · 已完成'
                            : update.status === 'stopped'
                              ? ' · 已停止跟踪'
                              : ''}
                        </div>
                        {update.title && <h4 className="event-progress-title">{update.title}</h4>}
                        <p className="event-body">{update.body}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {actions && <div className="event-actions">{actions(event)}</div>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
