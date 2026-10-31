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
import { UNGROUPED_ID } from '../../../shared/groups/types';
import { monitorGroupKey, orderedGroups } from '../../../shared/groups/ordering';
import { GroupHeading } from '../groups/GroupHeading';
import { useCollapsedGroups } from '../groups/useCollapsedGroups';

export function StatusPage() {
  const { t, locale } = useI18n();
  const remote = useRemote<StatusResponse>('/api/status');
  const { data, error, loading, refresh } = remote;
  const now = useNow();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const collapsedGroups = useCollapsedGroups('public');
  const filtering = search !== '' || filter !== 'all' || groupFilter !== 'all';
  const displayGroups = data
    ? orderedGroups(data.groups, { ...data.ungrouped, name: t('groups.ungrouped') })
    : [];
  const monitors = data?.monitors ?? [];
  const statuses = monitors.map((m) => effectiveStatus(m, now));
  const up = statuses.filter((s) => s === 'up').length;
  const active = statuses.filter((s) => s !== 'paused').length;
  const summary = getStatusSummary(statuses, data ? data.events : [], now, Boolean(error), locale);
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
            monitorGroupKey(m.groupId, data ? data.groups : []) === (groupFilter || UNGROUPED_ID)),
      ),
    [monitors, search, filter, groupFilter, now, data?.groups],
  );
  return (
    <Layout siteName={data?.siteName}>
      <section className={`status-hero ${summary.tone}`}>
        <span className="status-symbol" aria-hidden="true">
          <Icon name={summary.icon} size={24} />
        </span>
        <div className="hero-copy">
          <h1>{summary.title}</h1>
          {summary.description && <p>{summary.description}</p>}
        </div>
      </section>
      {error && <ErrorNotice message={error} retry={refresh} />}
      <RefreshStatus {...remote} />
      <EventList events={data ? data.events : []} variant="open" />
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
          {statuses.includes('paused') && (
            <span className="stat-note">
              {t('status.pausedCount', { count: statuses.filter((s) => s === 'paused').length })}
            </span>
          )}
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
        </div>
      </section>
      <section className="services-section">
        <div className="section-heading">
          <div>
            <h2>
              {t('status.services')}
              <span className="count-badge">{monitors.length.toString().padStart(2, '0')}</span>
            </h2>
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
                {displayGroups.map((group) => (
                  <option key={group.id} value={group.id === UNGROUPED_ID ? '' : group.id}>
                    {group.name}
                  </option>
                ))}
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
            displayGroups.map((group) => {
              const members = visible.filter(
                (monitor) => monitorGroupKey(monitor.groupId, data ? data.groups : []) === group.id,
              );
              const collapsed = !filtering && collapsedGroups.isCollapsed(group.id);
              const controls = `public-group-${group.id}`;
              return (
                members.length > 0 && (
                  <section className="monitor-group" key={group.id} aria-label={group.name}>
                    <GroupHeading
                      name={group.name}
                      count={members.length}
                      collapsed={collapsed}
                      controls={controls}
                      toggle={() => collapsedGroups.toggle(group.id)}
                      variant="public"
                      filtering={filtering}
                    />
                    <div className="monitor-group-list" id={controls} hidden={collapsed}>
                      {members.map((monitor) => (
                        <MonitorCard key={monitor.id} monitor={monitor} now={now} />
                      ))}
                    </div>
                  </section>
                )
              );
            })
          )}
        </div>
        <div className="list-footnote">
          <Legend />
          <details className="inline-help">
            <summary>{t('history.daily')}</summary>
            <p>
              {t('status.gapNote')} {t('status.methodNote')}
            </p>
          </details>
        </div>
      </section>
      <EventList events={data ? data.events : []} variant="history" />
    </Layout>
  );
}
