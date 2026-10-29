import { useI18n } from '../../i18n/I18nProvider';
import type { ReactNode } from 'react';
import type { StatusEvent } from '../../../shared/events/types';
import { eventLabel } from './labels';
import { Empty } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { useNow } from '../../hooks/useNow';
import {
  eventTime,
  latestEventEntry,
  localizedEventTitle,
  localizedEntryBody,
  PROGRESS_LABELS,
} from './presentation';

export function EventMonitors({ event }: { event: StatusEvent }) {
  const { t } = useI18n();
  return (
    <div className="event-monitors" aria-label={t('event.monitors')}>
      {event.monitors.map((monitor, index) =>
        monitor.id ? (
          <a key={monitor.id} href={`/monitors/${encodeURIComponent(monitor.id)}`}>
            {monitor.name}
          </a>
        ) : (
          <span key={`deleted-${index}`}>{t('event.deletedMonitor', { name: monitor.name })}</span>
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
  const { t, locale } = useI18n();
  const now = useNow();
  const visibleEvents = events.filter(
    (event) => variant === 'all' || (variant === 'open' ? event.status === 'open' : event.status !== 'open'),
  );
  if (variant === 'open' && !visibleEvents.length) return null;
  const heading =
    title ??
    (variant === 'open' ? t('event.open') : variant === 'history' ? t('event.history') : t('event.recent'));
  return (
    <section
      className={`events-section${variant === 'open' ? ' events-section-open' : ''}`}
      aria-label={heading}
    >
      <div className="section-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {variant === 'history' ? t('event.historyDescription') : t('event.description')} ·{' '}
            {t('time.browserZone')}
          </p>
        </div>
      </div>
      {!visibleEvents.length ? (
        <Empty title={variant === 'history' ? t('event.noHistory') : t('event.noEvents')} icon="clock">
          {variant === 'history' ? t('event.noHistoryDescription') : t('event.noEventsDescription')}
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
                      {eventLabel(event, now, locale)}
                    </span>
                    <span className="muted">
                      {event.type === 'maintenance' ? t('event.maintenance') : t('event.incident')} ·{' '}
                      {event.source === 'automatic' ? t('event.automatic') : t('event.manual')}
                    </span>
                  </div>
                </div>
                <h3>
                  <a className="event-title-link" href={href}>
                    {localizedEventTitle(event, locale)}
                    <Icon name="arrow" size={16} />
                  </a>
                </h3>
                <EventMonitors event={event} />
                {event.type === 'maintenance' && (
                  <p className="event-window">
                    {t('event.plannedWindow', {
                      start: eventTime(event.startsAt!, locale),
                      end: eventTime(event.endsAt!, locale),
                    })}
                  </p>
                )}
                {event.source === 'automatic' && (
                  <p className="event-window">
                    {t('event.failureAt', { time: eventTime(event.startedAt, locale) })}
                    {event.endedAt !== null && (
                      <>
                        {' '}
                        ·{' '}
                        {t('event.endedAt', {
                          label: event.status === 'resolved' ? t('event.recovery') : t('event.stopped'),
                          time: eventTime(event.endedAt, locale),
                        })}
                        {' · '}
                        {t('event.duration', {
                          count: Math.max(0, Math.round((event.endedAt - event.startedAt) / 60_000)),
                        })}
                      </>
                    )}
                  </p>
                )}
                <div className="event-latest" aria-label={t('event.latest')}>
                  <div className="event-latest-heading">
                    <h4>{t(PROGRESS_LABELS[latest.title])}</h4>
                    <time className="event-updated" dateTime={new Date(latest.createdAt).toISOString()}>
                      {eventTime(latest.createdAt, locale)}
                    </time>
                  </div>
                  <p className="event-body event-excerpt">
                    {latest.legacyTitle && (
                      <>
                        {latest.legacyTitle}
                        {'\n'}
                      </>
                    )}
                    {localizedEntryBody(latest, locale)}
                  </p>
                  <a className="event-timeline-link" href={href}>
                    {t('event.viewTimeline')}
                    <Icon name="arrow" size={14} />
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
