import { ERROR_LABELS, type HistoryResponse } from '../shared/types';
import { useRemote } from './api';
import {
  Empty,
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
  const { data, error, loading, refresh } = useRemote<HistoryResponse>(
    `/api/monitors/${encodeURIComponent(id)}/history`,
  );
  const now = useNow();
  return (
    <Layout>
      <a className="back-link" href="/">
        <Icon name="back" size={17} />
        返回状态概览
      </a>
      {error && <ErrorNotice message={error} retry={refresh} />}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
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
            <section className="panel checks-panel">
              <div className="panel-heading">
                <h2>最近检测</h2>
                <span className="muted">最近 20 条 · 时间按浏览器时区显示</span>
              </div>
              {!data.checks.length ? (
                <Empty title="等待首次检测" icon="clock">
                  检测记录将在下一轮调度后出现在这里。
                </Empty>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>检测时间</th>
                        <th>状态</th>
                        <th>响应时间</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.checks
                        .slice(-20)
                        .reverse()
                        .map((check) => (
                          <tr key={check.checkedAt}>
                            <td className="tabular">{formatTime(check.checkedAt, true)}</td>
                            <td>
                              <StatusBadge status={check.ok ? 'up' : 'down'} />
                            </td>
                            <td className="tabular">{latency(check.latencyMs)}</td>
                            <td>
                              {check.errorCode
                                ? `${ERROR_LABELS[check.errorCode]}${check.httpStatus ? ` · HTTP ${check.httpStatus}` : ''}`
                                : check.httpStatus
                                  ? `HTTP ${check.httpStatus}`
                                  : 'TCP 连接成功'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      )}
    </Layout>
  );
}
