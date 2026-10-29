import { eventLabel } from '../shared/events';
import type { EventDetailResponse } from '../shared/types';
import { useRemote } from './api';
import { ErrorNotice, Icon, Layout, Loading, useNow } from './components';
import { EventMonitors } from './EventList';
import { eventTime, eventTimeline, relativeEventTime } from './eventPresentation';
import { RefreshStatus } from './RefreshStatus';

export function EventDetailPage({ id }: { id: string }) {
  const remote = useRemote<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}`);
  const { data, error, loading, refresh } = remote;
  const event = data?.event;
  const now = useNow();
  return (
    <Layout siteName={data?.siteName}>
      <a className="back-link" href="/">
        <Icon name="back" size={17} />
        返回状态概览
      </a>
      {error && <ErrorNotice message={error} retry={refresh} />}
      {loading ? (
        <Loading />
      ) : (
        event && (
          <article className="event-detail">
            <header className="event-detail-header">
              <p className="event-last-updated">
                最后更新于{' '}
                <time dateTime={new Date(event.updatedAt).toISOString()} title={eventTime(event.updatedAt)}>
                  {relativeEventTime(event.updatedAt, now)}
                </time>
              </p>
              <div className="event-tags">
                <span className={`event-status ${event.status === 'open' ? event.type : event.status}`}>
                  {eventLabel(event, now)}
                </span>
                <span className="muted">
                  {event.type === 'maintenance' ? '计划维护' : '故障事件'} ·{' '}
                  {event.source === 'automatic' ? '自动检测' : '管理员发布'}
                </span>
              </div>
              <h1>{event.title}</h1>
              <p className="event-id">事件 ID：{event.id}</p>
              <EventMonitors event={event} />
              <dl className="event-detail-times">
                {event.type === 'maintenance' ? (
                  <>
                    <div>
                      <dt>计划开始</dt>
                      <dd>
                        <time dateTime={new Date(event.startsAt!).toISOString()}>
                          {eventTime(event.startsAt!)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>计划结束</dt>
                      <dd>
                        <time dateTime={new Date(event.endsAt!).toISOString()}>
                          {eventTime(event.endsAt!)}
                        </time>
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>{event.source === 'automatic' ? '首次失败' : '开始时间'}</dt>
                    <dd>
                      <time dateTime={new Date(event.startedAt).toISOString()}>
                        {eventTime(event.startedAt)}
                      </time>
                    </dd>
                  </div>
                )}
                {event.endedAt !== null && (
                  <div>
                    <dt>
                      {event.status === 'stopped'
                        ? '停止跟踪'
                        : event.type === 'maintenance'
                          ? '完成时间'
                          : '恢复时间'}
                    </dt>
                    <dd>
                      <time dateTime={new Date(event.endedAt).toISOString()}>{eventTime(event.endedAt)}</time>
                    </dd>
                  </div>
                )}
              </dl>
            </header>
            <section className="event-timeline" aria-labelledby="timeline-heading">
              <div className="event-timeline-heading">
                <h2 id="timeline-heading">时间线</h2>
                <span className="muted">时间按浏览器时区显示</span>
              </div>
              <ol>
                {eventTimeline(event).map((entry, index) => (
                  <li
                    key={entry.id}
                    className={index === 0 ? 'event-timeline-entry latest' : 'event-timeline-entry'}
                  >
                    <span className="event-timeline-dot" aria-hidden="true" />
                    <div className="event-timeline-entry-heading">
                      <h3>{entry.title}</h3>
                      <span className="muted">{relativeEventTime(entry.createdAt, now)}</span>
                    </div>
                    <p className="event-timeline-meta">
                      <time dateTime={new Date(entry.createdAt).toISOString()}>
                        {eventTime(entry.createdAt)}
                      </time>
                      <span> · {entry.source === 'automatic' ? '自动检测' : '管理员发布'}</span>
                    </p>
                    {entry.legacyTitle && <p className="event-legacy-title">{entry.legacyTitle}</p>}
                    <p className="event-body">{entry.body}</p>
                  </li>
                ))}
              </ol>
            </section>
          </article>
        )
      )}
      <RefreshStatus {...remote} />
    </Layout>
  );
}
