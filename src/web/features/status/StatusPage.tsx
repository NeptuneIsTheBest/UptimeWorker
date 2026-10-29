import { number } from '../../lib/format';
import { useI18n } from '../../i18n/I18nProvider';
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
  const { t, locale } = useI18n();
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
  const summary = getStatusSummary(statuses, data?.events ?? [], now, Boolean(error), locale);
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
        <span className="eyebrow-line" /> {t('page.observability')}{' '}
        <span className="eyebrow-right">{t('status.tagline')}</span>
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
      <section className="stats-grid" aria-label={t('status.overview')}>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="server" size={16} />
            {t('status.healthyServices')}
          </span>
          <div className="stat-value">
            {number(up, locale)}
            <span className="stat-denominator"> / {number(active, locale)}</span>
          </div>
          <span className="stat-note">
            {t('status.pausedCount', { count: statuses.filter((s) => s === 'paused').length })}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="shield" size={16} />
            {t('status.overallUptime')}
          </span>
          <div className="stat-value">
            {totals.total ? (
              <>
                {number((totals.success / totals.total) * 100, locale, 2)}
                <span className="stat-unit">%</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <span className="stat-note">{t('status.uptimeNote')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">
            <Icon name="pulse" size={16} />
            {t('status.averageLatency')}
          </span>
          <div className="stat-value">
            {latencies.length ? (
              <>
                {number(Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length), locale)}
                <span className="stat-unit">ms</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <span className="stat-note">{t('status.latencyNote')}</span>
        </div>
        <RefreshStatus {...remote} card />
      </section>
      <section className="services-section">
        <div className="section-heading">
          <div>
            <h2>
              {t('status.services')}
              <span className="count-badge">{monitors.length.toString().padStart(2, '0')}</span>
            </h2>
            <p>{t('status.historyNote')}</p>
          </div>
          {monitors.length > 0 && (
            <div className="filter-controls">
              <label className="search-box">
                <Icon name="search" size={17} />
                <input
                  aria-label={t('status.search')}
                  placeholder={t('status.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label={t('status.groupFilter')}
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="all">{t('status.allGroups')}</option>
                {(data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
                <option value="">{t('groups.ungrouped')}</option>
              </select>
              <select
                aria-label={t('status.statusFilter')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">{t('status.allStatuses')}</option>
                <option value="up">{t('status.up')}</option>
                <option value="down">{t('status.down')}</option>
                <option value="stale">{t('status.stale')}</option>
                <option value="unknown">{t('status.unknown')}</option>
                <option value="paused">{t('status.paused')}</option>
              </select>
            </div>
          )}
        </div>
        <div className="monitor-list">
          {loading ? (
            <Loading />
          ) : !monitors.length ? (
            <Empty title={t('status.empty')}>
              {t('status.emptyDescription')}
              <br />
              <a className="button primary empty-action" href="/admin">
                <Icon name="plus" size={16} />
                {t('status.add')}
              </a>
            </Empty>
          ) : !visible.length ? (
            <Empty title={t('status.noMatch')} icon="search">
              {t('status.noMatchDescription')}
            </Empty>
          ) : (
            [...(data?.groups ?? []), { id: '', name: t('groups.ungrouped') }].map((group) => {
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
                      <span className="count-badge">{number(members.length, locale)}</span>
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
          <span>{t('status.gapNote')}</span>
        </div>
      </section>
      <EventList events={data?.events ?? []} variant="history" />
      <div className="info-strip">
        <Icon name="info" size={17} />
        <span>{t('status.methodNote')}</span>
        <a href="/admin">
          {t('status.manage')}
          <Icon name="arrow" size={13} />
        </a>
      </div>
    </Layout>
  );
}
