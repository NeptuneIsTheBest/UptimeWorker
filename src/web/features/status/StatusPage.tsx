import { number } from '../../lib/format';
import { useI18n } from '../../i18n/I18nProvider';
import { useMemo } from 'react';
import { usePageScroll, usePageState } from '../../hooks/usePageState';
import { isRecord } from '../../lib/navigation';
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
import { orderedGroups } from '../../../shared/groups/ordering';
import { GroupHeading } from '../groups/GroupHeading';
import { useCollapsedGroups } from '../groups/useCollapsedGroups';
import { groupBy } from '../../../shared/collections';
import type { PublicMonitor } from '../../../shared/monitors/types';

const EMPTY_MONITORS: PublicMonitor[] = [];

interface Filters {
  search: string;
  filter: string;
  groupFilter: string;
}

const isFilters = (value: unknown): value is Filters =>
  isRecord(value) &&
  typeof value.search === 'string' &&
  typeof value.groupFilter === 'string' &&
  typeof value.filter === 'string' &&
  ['all', 'up', 'down', 'stale', 'unknown', 'paused'].includes(value.filter);

export function StatusPage() {
  const { t, locale } = useI18n();
  const remote = useRemote<StatusResponse>('/api/status');
  const { data, error, loading, refresh } = remote;
  const now = useNow();
  const [filters, setFilters] = usePageState<Filters>(
    'overviewFilters',
    { search: '', filter: 'all', groupFilter: 'all' },
    isFilters,
  );
  const { search, filter, groupFilter } = filters;
  usePageScroll(Boolean(data) && !loading);
  const collapsedGroups = useCollapsedGroups('public');
  const filtering = search !== '' || filter !== 'all' || groupFilter !== 'all';
  const displayGroups = useMemo(
    () => (data ? orderedGroups(data.groups, { ...data.ungrouped, name: t('groups.ungrouped') }) : []),
    [data?.groups, data?.ungrouped, t],
  );
  const knownGroups = useMemo(() => new Set(data?.groups.map((group) => group.id)), [data?.groups]);
  const monitors = data?.monitors ?? EMPTY_MONITORS;
  const statusById = useMemo(
    () => new Map(monitors.map((monitor) => [monitor.id, effectiveStatus(monitor, now)])),
    [monitors, now],
  );
  const statuses = [...statusById.values()];
  const up = statuses.filter((s) => s === 'up').length;
  const active = statuses.filter((s) => s !== 'paused').length;
  const summary = getStatusSummary(statuses, data ? data.events : [], now, Boolean(error), locale);
  const totals = useMemo(() => {
    let success = 0;
    let total = 0;
    for (const monitor of monitors) {
      for (let index = Math.max(0, monitor.days.length - 30); index < monitor.days.length; index++) {
        success += monitor.days[index].successful;
        total += monitor.days[index].total;
      }
    }
    return { success, total };
  }, [monitors]);
  const latencies = monitors
    .filter((m) => statusById.get(m.id) === 'up' && m.latencyMs !== null)
    .map((m) => m.latencyMs!);
  const { visible, membersByGroup } = useMemo(() => {
    const query = search.toLowerCase();
    const groupOf = (monitor: PublicMonitor) =>
      monitor.groupId !== null && knownGroups.has(monitor.groupId) ? monitor.groupId : UNGROUPED_ID;
    const visible = monitors.filter(
      (monitor) =>
        monitor.name.toLowerCase().includes(query) &&
        (filter === 'all' || statusById.get(monitor.id) === filter) &&
        (groupFilter === 'all' || groupOf(monitor) === (groupFilter || UNGROUPED_ID)),
    );
    return { visible, membersByGroup: groupBy(visible, groupOf) };
  }, [monitors, search, filter, groupFilter, statusById, knownGroups]);
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
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </label>
              <select
                aria-label={t('status.groupFilter')}
                value={groupFilter}
                onChange={(e) => setFilters({ ...filters, groupFilter: e.target.value })}
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
                onChange={(e) => setFilters({ ...filters, filter: e.target.value })}
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
              const members = membersByGroup.get(group.id) ?? [];
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
                        <MonitorCard
                          key={monitor.id}
                          monitor={monitor}
                          status={statusById.get(monitor.id)!}
                        />
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
            <p>{t('status.methodNote')}</p>
          </details>
        </div>
      </section>
      <EventList events={data ? data.events : []} variant="history" />
    </Layout>
  );
}
