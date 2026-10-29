import { useI18n } from '../../i18n/I18nProvider';
import { eventLabel } from './labels';
import type { EventDetailResponse } from '../../../shared/events/types';
import { useRemote } from '../../hooks/useRemote';
import { ErrorNotice, Loading } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Layout } from '../../app/Layout';
import { useNow } from '../../hooks/useNow';
import { EventMonitors } from './EventList';
import {
  eventTime,
  eventTimeline,
  relativeEventTime,
  localizedEventTitle,
  localizedEntryBody,
  PROGRESS_LABELS,
} from './presentation';
import { RefreshStatus } from '../../components/RefreshStatus';

export function EventDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const remote = useRemote<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}`);
  const { data, error, loading, refresh } = remote;
  const event = data?.event;
  const now = useNow();
  return (
    <Layout siteName={data?.siteName}>
      <a className="back-link" href="/">
        <Icon name="back" size={17} />
        {t('nav.back')}
      </a>
      {error && <ErrorNotice message={error} retry={refresh} />}
      {loading ? (
        <Loading />
      ) : (
        event && (
          <article className="event-detail">
            <header className="event-detail-header">
              <p className="event-last-updated">
                {t('event.updated')}{' '}
                <time
                  dateTime={new Date(event.updatedAt).toISOString()}
                  title={eventTime(event.updatedAt, locale)}
                >
                  {relativeEventTime(event.updatedAt, now, locale)}
                </time>
              </p>
              <div className="event-tags">
                <span className={`event-status ${event.status === 'open' ? event.type : event.status}`}>
                  {eventLabel(event, now, locale)}
                </span>
                <span className="muted">
                  {event.type === 'maintenance' ? t('event.maintenance') : t('event.incident')} ·{' '}
                  {event.source === 'automatic' ? t('event.automatic') : t('event.manual')}
                </span>
              </div>
              <h1>{localizedEventTitle(event, locale)}</h1>
              <EventMonitors event={event} />
              <dl className="event-detail-times">
                {event.type === 'maintenance' ? (
                  <>
                    <div>
                      <dt>{t('event.plannedStart')}</dt>
                      <dd>
                        <time dateTime={new Date(event.startsAt!).toISOString()}>
                          {eventTime(event.startsAt!, locale)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt>{t('event.plannedEnd')}</dt>
                      <dd>
                        <time dateTime={new Date(event.endsAt!).toISOString()}>
                          {eventTime(event.endsAt!, locale)}
                        </time>
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>{event.source === 'automatic' ? t('event.firstFailure') : t('event.started')}</dt>
                    <dd>
                      <time dateTime={new Date(event.startedAt).toISOString()}>
                        {eventTime(event.startedAt, locale)}
                      </time>
                    </dd>
                  </div>
                )}
                {event.endedAt !== null && (
                  <div>
                    <dt>
                      {event.status === 'stopped'
                        ? t('event.stopped')
                        : event.type === 'maintenance'
                          ? t('event.completedAt')
                          : t('event.recoveredAt')}
                    </dt>
                    <dd>
                      <time dateTime={new Date(event.endedAt).toISOString()}>
                        {eventTime(event.endedAt, locale)}
                      </time>
                    </dd>
                  </div>
                )}
              </dl>
            </header>
            <section className="event-timeline" aria-labelledby="timeline-heading">
              <div className="event-timeline-heading">
                <h2 id="timeline-heading">{t('event.timeline')}</h2>
              </div>
              <ol>
                {eventTimeline(event).map((entry, index) => (
                  <li
                    key={entry.id}
                    className={index === 0 ? 'event-timeline-entry latest' : 'event-timeline-entry'}
                  >
                    <span className="event-timeline-dot" aria-hidden="true" />
                    <div className="event-timeline-entry-heading">
                      <h3>{t(PROGRESS_LABELS[entry.title])}</h3>
                      <span className="muted">{relativeEventTime(entry.createdAt, now, locale)}</span>
                    </div>
                    <p className="event-timeline-meta">
                      <time dateTime={new Date(entry.createdAt).toISOString()}>
                        {eventTime(entry.createdAt, locale)}
                      </time>
                      <span>
                        {' '}
                        · {entry.source === 'automatic' ? t('event.automatic') : t('event.manual')}
                      </span>
                    </p>
                    {entry.legacyTitle && <p className="event-legacy-title">{entry.legacyTitle}</p>}
                    <p className="event-body">{localizedEntryBody(entry, locale)}</p>
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
