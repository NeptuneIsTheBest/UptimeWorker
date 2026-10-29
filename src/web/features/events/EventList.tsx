import type { ReactNode } from 'react';
import type { StatusEvent } from '../../../shared/events/types';
import { eventLabel } from './labels';
import { Empty } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { useNow } from '../../hooks/useNow';
import { eventTime, latestEventEntry } from './presentation';

export function EventMonitors({ event }: { event: StatusEvent }) {
  return (
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
  );
}

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
          {visibleEvents.map((event) => {
            const latest = latestEventEntry(event);
            const href = `/events/${encodeURIComponent(event.id)}`;
            return (
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
                </div>
                <h3>
                  <a className="event-title-link" href={href}>
                    {event.title}
                    <Icon name="arrow" size={16} />
                  </a>
                </h3>
                <EventMonitors event={event} />
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
                <div className="event-latest" aria-label="最新进展">
                  <div className="event-latest-heading">
                    <h4>{latest.title}</h4>
                    <time className="event-updated" dateTime={new Date(latest.createdAt).toISOString()}>
                      {eventTime(latest.createdAt)}
                    </time>
                  </div>
                  <p className="event-body event-excerpt">
                    {latest.legacyTitle && (
                      <>
                        {latest.legacyTitle}
                        {'\n'}
                      </>
                    )}
                    {latest.body}
                  </p>
                  <a className="event-timeline-link" href={href}>
                    查看时间线 <Icon name="arrow" size={14} />
                  </a>
                </div>
                {actions && <div className="event-actions">{actions(event)}</div>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
