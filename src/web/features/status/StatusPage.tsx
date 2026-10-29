import { useMemo, useState } from 'react';
import type { StatusResponse } from '../../../shared/status/types';
import { useRemote } from '../../hooks/useRemote';
import { EventList } from '../events/EventList';
import { RefreshStatus } from '../../components/RefreshStatus';
import { getStatusSummary } from './summary';
import { Empty, ErrorNotice, Loading } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Layout } from '../../app/Layout';
import { Legend } from '../monitors/HistoryBars';
import { effectiveStatus } from '../monitors/status';
import { useNow } from '../../hooks/useNow';
import { MonitorCard } from '../monitors/MonitorCard';

export function StatusPage() {
  const remote = useRemote<StatusResponse>('/api/status');
  const { data, error, loading, refresh } = remote;
  const now = useNow();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const monitors = data?.monitors ?? [];
  const statuses = monitors.map((m) => effectiveStatus(m, now));
  const up = statuses.filter((s) => s === 'up').length;
  const active = statuses.filter((s) => s !== 'paused').length;
  const summary = getStatusSummary(statuses, data?.events ?? [], now, Boolean(error));
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
          (filter === 'all' || effectiveStatus(m, now) === filter) &&
          (groupFilter === 'all' ||
            (data?.groups?.some((group) => group.id === m.groupId) ? m.groupId : '') === groupFilter),
      ),
    [monitors, search, filter, groupFilter, now, data?.groups],
  );
  return (
    <Layout siteName={data?.siteName}>
      <EventList events={data?.events ?? []} variant="open" />
      <div className="page-eyebrow">
        <span className="eyebrow-line" /> SERVICE STATUS{' '}
        <span className="eyebrow-right">持续检测 · 即刻知悉</span>
      </div>
      <section className={`status-hero ${summary.tone}`}>
        <div className="hero-copy">
          <span className="hero-tag">
            <span className="status-dot" />
            {summary.label}
          </span>
          <h1>{summary.title}</h1>
          <p>{summary.description}</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit" />
          <div className="hero-orbit inner" />
          <div className="hero-symbol">
            <Icon name={summary.icon} size={36} />
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
        <RefreshStatus {...remote} card />
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
              <select
                aria-label="按分组筛选"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="all">全部分组</option>
                {(data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
                <option value="">未分组</option>
              </select>
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
              试试其他名称、分组或状态。
            </Empty>
          ) : (
            [...(data?.groups ?? []), { id: '', name: '未分组' }].map((group) => {
              const members = visible.filter(
                (monitor) =>
                  (data?.groups?.some((item) => item.id === monitor.groupId) ? monitor.groupId : '') ===
                  group.id,
              );
              return (
                members.length > 0 && (
                  <section className="monitor-group" key={group.id || 'ungrouped'} aria-label={group.name}>
                    <h3 className="group-heading">
                      {group.name}
                      <span className="count-badge">{members.length}</span>
                    </h3>
                    {members.map((monitor) => (
                      <MonitorCard key={monitor.id} monitor={monitor} now={now} />
                    ))}
                  </section>
                )
              );
            })
          )}
        </div>
        <div className="list-footnote">
          <Legend />
          <span>空白区间表示没有检测数据，不计为成功。</span>
        </div>
      </section>
      <EventList events={data?.events ?? []} variant="history" />
      <div className="info-strip">
        <Icon name="info" size={17} />
        <span>
          整体状态结合故障、维护与定时检测；节点状态及可用率依据检测结果。数据超过两个检测周期未更新时，将标记为过期。
        </span>
        <a href="/admin">
          管理监控 <Icon name="arrow" size={13} />
        </a>
      </div>
    </Layout>
  );
}
