import { useMemo, useState } from 'react';
import type { PublicMonitor, StatusResponse } from '../shared/types';
import { useRemote } from './api';
import {
  Empty,
  ErrorNotice,
  HistoryBars,
  Icon,
  Layout,
  Legend,
  Loading,
  StatusBadge,
  effectiveStatus,
  formatTime,
  latency,
  percent,
  useNow,
} from './components';

function MonitorCard({ monitor, now }: { monitor: PublicMonitor; now: number }) {
  return (
    <article className="monitor-card">
      <div className="monitor-top">
        <div className="monitor-title-group">
          <span className="service-icon">
            <Icon name={monitor.type === 'http' ? 'globe' : 'server'} size={21} />
          </span>
          <div>
            <a className="monitor-name" href={`/monitors/${monitor.id}`}>
              {monitor.name}
              <Icon name="arrow" size={15} />
            </a>
            <div className="monitor-meta">
              <span className="protocol">{monitor.type === 'http' ? 'HTTP' : 'TCP'}</span>
              <span>每 {monitor.intervalMinutes} 分钟</span>
              <span className="last-check">最近检测 {formatTime(monitor.lastCheckedAt)}</span>
            </div>
          </div>
        </div>
        <div className="monitor-figures">
          <div className="inline-metric">
            <strong>{latency(monitor.latencyMs)}</strong>
            <span>响应时间</span>
          </div>
          <div className="inline-metric">
            <strong>{percent(monitor.uptime30d)}</strong>
            <span>30 日可用率</span>
          </div>
          <StatusBadge status={effectiveStatus(monitor, now)} />
        </div>
      </div>
      <HistoryBars days={monitor.days} />
    </article>
  );
}
export function StatusPage() {
  const { data, error, loading, refresh } = useRemote<StatusResponse>('/api/status');
  const now = useNow();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const monitors = data?.monitors ?? [];
  const statuses = monitors.map((m) => effectiveStatus(m, now));
  const up = statuses.filter((s) => s === 'up').length;
  const down = statuses.filter((s) => s === 'down').length;
  const stale = statuses.filter((s) => s === 'stale').length;
  const pending = statuses.filter((s) => s === 'unknown').length;
  const active = statuses.filter((s) => s !== 'paused').length;
  const attention = down > 0 || stale > 0;
  const healthy = active > 0 && up === active && !error;
  const title = error
    ? '状态数据暂时不可用。'
    : healthy
      ? '所有服务，运行如常。'
      : attention
        ? '部分服务需要关注。'
        : pending
          ? '正在等待第一条心跳。'
          : monitors.length
            ? '监控已暂停。'
            : '从第一条监控开始。';
  const description = error
    ? '无法获取最新状态，请稍后重试。'
    : healthy
      ? '所有受监控服务运行正常，每一次检测都在为稳定作证。'
      : attention
        ? `${down} 项服务异常，${stale} 项数据过期。查看下方服务了解详情。`
        : pending
          ? '监控已就绪，定时任务每分钟检查到期的监控，正在等待首次结果。'
          : monitors.length
            ? '恢复监控后，我们将继续记录服务的每一次响应。'
            : '添加你的 HTTP 服务或 TCP 端口，即可持续了解它们的运行状态。';
  const totals = monitors
    .flatMap((m) => m.days.slice(-30))
    .reduce((a, d) => ({ success: a.success + d.successful, total: a.total + d.total }), {
      success: 0,
      total: 0,
    });
  const latencies = monitors
    .filter((m) => effectiveStatus(m, now) === 'up' && m.latencyMs !== null)
    .map((m) => m.latencyMs!);
  const visible = useMemo(
    () =>
      monitors.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) &&
          (filter === 'all' || effectiveStatus(m, now) === filter),
      ),
    [monitors, search, filter, now],
  );
  return (
    <Layout siteName={data?.siteName}>
      <div className="page-eyebrow">
        <span className="eyebrow-line" /> SERVICE STATUS{' '}
        <span className="eyebrow-right">持续检测 · 即刻知悉</span>
      </div>
      <section
        className={`status-hero ${healthy ? 'healthy' : attention || error ? 'attention' : 'waiting'}`}
      >
        <div className="hero-copy">
          <span className="hero-tag">
            <span className="status-dot" />
            {healthy
              ? 'ALL SYSTEMS OPERATIONAL'
              : attention || error
                ? 'ATTENTION REQUIRED'
                : 'READY WHEN YOU ARE'}
          </span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit" />
          <div className="hero-orbit inner" />
          <div className="hero-symbol">
            <Icon name={healthy ? 'check' : attention || error ? 'info' : 'pulse'} size={36} />
          </div>
          <span className="orbit-dot" />
        </div>
      </section>
      {error && <ErrorNotice message={error} retry={refresh} />}
      <section className="stats-grid" aria-label="监控概况">
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="server" size={16} /> 正常服务
          </span>
          <div className="stat-value">
            {up}
            <span className="stat-denominator"> / {active}</span>
          </div>
          <span className="stat-note">{statuses.filter((s) => s === 'paused').length} 项暂停监控</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="shield" size={16} /> 30 日整体可用率
          </span>
          <div className="stat-value">
            {totals.total ? (
              <>
                {((totals.success / totals.total) * 100).toFixed(2)}
                <span className="stat-unit">%</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <span className="stat-note">按成功检测次数统计</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="pulse" size={16} /> 平均响应时间
          </span>
          <div className="stat-value">
            {latencies.length ? (
              <>
                {Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}
                <span className="stat-unit">ms</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <span className="stat-note">正常服务的最近一次响应</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="clock" size={16} /> 最近同步
          </span>
          <div className="stat-value time-value">{data ? formatTime(data.generatedAt).slice(0, 5) : '—'}</div>
          <span className="stat-note">
            <span className="small-dot" /> 页面每 60 秒自动刷新
          </span>
        </div>
      </section>
      <section className="services-section">
        <div className="section-heading">
          <div>
            <h2>
              监控服务 <span className="count-badge">{monitors.length.toString().padStart(2, '0')}</span>
            </h2>
            <p>过去 90 天的运行记录，一目了然。</p>
          </div>
          {monitors.length > 0 && (
            <div className="filter-controls">
              <label className="search-box">
                <Icon name="search" size={17} />
                <input
                  aria-label="搜索服务"
                  placeholder="搜索服务…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select aria-label="按状态筛选" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="up">运行正常</option>
                <option value="down">服务异常</option>
                <option value="stale">数据过期</option>
                <option value="unknown">等待检测</option>
                <option value="paused">已暂停</option>
              </select>
            </div>
          )}
        </div>
        <div className="monitor-list">
          {loading ? (
            <Loading />
          ) : !monitors.length ? (
            <Empty title="还没有监控服务">
              在管理后台添加你的第一个服务。
              <br />
              <a className="button primary empty-action" href="/admin">
                <Icon name="plus" size={16} />
                添加监控
              </a>
            </Empty>
          ) : !visible.length ? (
            <Empty title="没有匹配的服务" icon="search">
              试试其他名称或状态。
            </Empty>
          ) : (
            visible.map((m) => <MonitorCard key={m.id} monitor={m} now={now} />)
          )}
        </div>
        <div className="list-footnote">
          <Legend />
          <span>空白区间表示没有检测数据，不计为成功。</span>
        </div>
      </section>
      <div className="info-strip">
        <Icon name="info" size={17} />
        <span>状态来自定时连接检测。数据超过两个检测周期未更新时，将标记为过期。</span>
        <a href="/admin">
          管理监控 <Icon name="arrow" size={13} />
        </a>
      </div>
    </Layout>
  );
}
