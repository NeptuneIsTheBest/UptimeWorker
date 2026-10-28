import { type HistoryResponse } from '../shared/types';
import { useRemote } from './api';
import { EventList } from './EventList';
import { RefreshStatus } from './RefreshStatus';
import {
  ErrorNotice,
  HistoryBars,
  Icon,
  Layout,
  Legend,
  Loading,
  ResponseChart,
  StatusBadge,
  effectiveStatus,
  formatTime,
  latency,
  percent,
  useNow,
} from './components';

export function DetailPage({ id }: { id: string }) {
  const remote = useRemote<HistoryResponse>(`/api/monitors/${encodeURIComponent(id)}/history`);
  const { data, error, loading, refresh } = remote;
  const now = useNow();
  return (
    <Layout>
      <a className="back-link" href="/">
        <Icon name="back" size={17} />
        返回状态概览
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
                <div className="page-eyebrow">SERVICE INSIGHTS · {data.monitor.type.toUpperCase()}</div>
                <h1>{data.monitor.name}</h1>
                <p className="muted">
                  每 {data.monitor.intervalMinutes} 分钟检测 · 最近检测{' '}
                  {formatTime(data.monitor.lastCheckedAt, true)}
                </p>
              </div>
              <StatusBadge status={effectiveStatus(data.monitor, now)} />
            </div>
            <RefreshStatus {...remote} />
            <div className="detail-metrics">
              <div>
                <span>当前响应时间</span>
                <strong>{latency(data.monitor.latencyMs)}</strong>
              </div>
              <div>
                <span>30 日可用率</span>
                <strong>{percent(data.monitor.uptime30d)}</strong>
              </div>
              <div>
                <span>24 小时检测次数</span>
                <strong>{data.checks.length}</strong>
              </div>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <h2>响应时间</h2>
                <span className="muted">最近 24 小时 · 毫秒</span>
              </div>
              <ResponseChart checks={data.checks} now={now} intervalMinutes={data.monitor.intervalMinutes} />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>运行历史</h2>
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
