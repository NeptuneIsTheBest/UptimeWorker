import { useI18n } from '../../i18n/I18nProvider';
import type { HistoryResponse } from '../../../shared/status/types';
import { useRemote } from '../../hooks/useRemote';
import { EventList } from '../events/EventList';
import { RefreshStatus } from '../../components/RefreshStatus';
import { ErrorNotice, Loading } from '../../components/feedback';
import { HistoryBars, Legend } from './HistoryBars';
import { Icon } from '../../components/Icon';
import { Layout } from '../../app/Layout';
import { ResponseChart } from './ResponseChart';
import { StatusBadge, effectiveStatus } from './status';
import { number, formatTime, latency, percent } from '../../lib/format';
import { useNow } from '../../hooks/useNow';

export function DetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const remote = useRemote<HistoryResponse>(`/api/monitors/${encodeURIComponent(id)}/history`);
  const { data, error, loading, refresh } = remote;
  const now = useNow();
  return (
    <Layout>
      <a className="back-link" href="/">
        <Icon name="back" size={17} />
        {t('nav.back')}
      </a>
      {!data && <RefreshStatus {...remote} />}
      {error && <ErrorNotice message={error} retry={refresh} />}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <EventList events={data.events ?? []} variant="open" />
            <div className="detail-heading">
              <div>
                <div className="page-eyebrow">
                  {t('page.insights')} · {data.monitor.type.toUpperCase()}
                </div>
                <h1>{data.monitor.name}</h1>
                <p className="muted">
                  {t('monitor.detailSchedule', {
                    count: data.monitor.intervalMinutes,
                    time: formatTime(data.monitor.lastCheckedAt, true, locale),
                  })}
                </p>
              </div>
              <StatusBadge status={effectiveStatus(data.monitor, now)} />
            </div>
            <RefreshStatus {...remote} />
            <div className="detail-metrics">
              <div>
                <span>{t('monitor.currentLatency')}</span>
                <strong>{latency(data.monitor.latencyMs, locale)}</strong>
              </div>
              <div>
                <span>{t('monitor.uptime')}</span>
                <strong>{percent(data.monitor.uptime30d, locale)}</strong>
              </div>
              <div>
                <span>{t('monitor.checkCount')}</span>
                <strong>{number(data.checks.length, locale)}</strong>
              </div>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('monitor.latency')}</h2>
                <span className="muted">{t('monitor.chartPeriod')}</span>
              </div>
              <ResponseChart checks={data.checks} now={now} intervalMinutes={data.monitor.intervalMinutes} />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>{t('monitor.history')}</h2>
                <Legend />
              </div>
              <HistoryBars days={data.monitor.days} />
            </section>
            <EventList events={data.events ?? []} variant="history" />
          </>
        )
      )}
    </Layout>
  );
}
