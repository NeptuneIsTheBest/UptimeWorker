import { message, errorMessage, displayMessage, NoticeError, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { useCallback, useMemo, useState } from 'react';
import { ERROR_LABELS } from './labels';
import type { AdminMonitor, MonitorConfig, ProbeResult } from '../../../shared/monitors/types';
import { api } from '../../lib/api';
import { useRemote } from '../../hooks/useRemote';
import { RefreshStatus } from '../../components/RefreshStatus';
import { Empty, ErrorNotice, Loading } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { StatusBadge } from './status';
import { formatTime, latency } from '../../lib/format';
import type { AdminResponse, MonitorEditorState, MonitorNotice } from './types';
import { MonitorEditor } from './MonitorEditor';
import { SortControls } from '../../components/SortControls';
import { useReorder } from '../../hooks/useReorder';
import { orderItems } from '../../../shared/ordering';
import { UNGROUPED_ID } from '../../../shared/groups/types';
import { orderedGroups } from '../../../shared/groups/ordering';
import { GroupHeading } from '../groups/GroupHeading';
import { useCollapsedGroups } from '../groups/useCollapsedGroups';
import { groupBy } from '../../../shared/collections';

const EMPTY_MONITORS: AdminMonitor[] = [];

export function MonitorManager({
  remote,
  visible,
  orderingDisabled,
  editor,
  onEditorChange: setEditor,
  notice,
  onNoticeChange: setNotice,
}: {
  remote: ReturnType<typeof useRemote<AdminResponse>>;
  visible: boolean;
  orderingDisabled: boolean;
  editor: MonitorEditorState;
  onEditorChange: (editor: MonitorEditorState) => void;
  notice: MonitorNotice | null;
  onNoticeChange: (notice: MonitorNotice | null) => void;
}) {
  const { t, locale } = useI18n();
  const { data, error, loading, refresh } = remote;
  const [deleting, setDeleting] = useState<AdminMonitor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<DisplayMessage | null>(null);
  const collapsedGroups = useCollapsedGroups('admin');
  const displayGroups = useMemo(
    () => (data ? orderedGroups(data.groups, { ...data.ungrouped, name: t('groups.ungrouped') }) : []),
    [data?.groups, data?.ungrouped, t],
  );
  const groupsById = useMemo(() => new Map(data?.groups.map((group) => [group.id, group])), [data?.groups]);
  const groupOf = useCallback(
    (monitor: AdminMonitor) =>
      monitor.groupId !== null && groupsById.has(monitor.groupId) ? monitor.groupId : UNGROUPED_ID,
    [groupsById],
  );
  const ordering = useReorder({
    items: data?.monitors ?? EMPTY_MONITORS,
    disabled: orderingDisabled || !!busy || !!editor || !!deleting || remote.locked,
    suspend: remote.suspend,
    scope: groupOf,
    save: async (items) => {
      const groupKey = groupOf(items[0]);
      const groupId = groupKey === UNGROUPED_ID ? null : groupKey;
      const result = await api<{ monitors: AdminMonitor[] }>('/api/admin/monitors/order', {
        method: 'PUT',
        body: JSON.stringify({ groupId, items: orderItems(items) }),
      });
      remote.updateData((current) => {
        let inserted = false;
        return {
          ...current,
          monitors: current.monitors.flatMap((monitor) => {
            if (groupOf(monitor) !== groupKey) return [monitor];
            if (inserted) return [];
            inserted = true;
            return result.monitors;
          }),
        };
      });
    },
  });
  const membersByGroup = useMemo(() => groupBy(ordering.items, groupOf), [ordering.items, groupOf]);
  async function action(id: string, work: () => Promise<DisplayMessage>) {
    setBusy(id);
    setNotice(null);
    try {
      setNotice({ text: await work(), error: false });
      refresh();
    } catch (err) {
      setNotice({ text: errorMessage(err, 'error.operation'), error: true });
    } finally {
      setBusy(null);
    }
  }
  async function save(config: MonitorConfig) {
    if (editor && editor !== 'new')
      await api(`/api/admin/monitors/${editor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...config, version: editor.version }),
      });
    else await api('/api/admin/monitors', { method: 'POST', body: JSON.stringify(config) });
    setEditor(null);
    setNotice({ text: message('monitor.saved'), error: false });
    refresh();
  }
  async function remove() {
    if (!deleting) return;
    setBusy(deleting.id);
    setDeleteError(null);
    try {
      await api(`/api/admin/monitors/${deleting.id}`, { method: 'DELETE', body: '{}' });
      setDeleting(null);
      setNotice({ text: message('monitor.deleted'), error: false });
      refresh();
    } catch (err) {
      setDeleteError(errorMessage(err, 'error.delete'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div hidden={!visible}>
        <RefreshStatus {...remote} />
        {data && (
          <div className="access-strip">
            <span>
              <Icon name="shield" size={17} />
              <strong
                title={data.identity.email === 'local@development' ? t('admin.local') : t('admin.verified')}
              >
                {data.identity.email}
              </strong>
            </span>
            <span>
              {t('admin.monitorCount', { count: data.monitors.length })}
              {data.identity.email !== 'local@development' && (
                <a href="/cdn-cgi/access/logout">{t('admin.logout')}</a>
              )}
            </span>
          </div>
        )}
        {error && <ErrorNotice message={error} retry={refresh} />}
        {notice && (
          <div role="status" className={`notice ${notice.error ? 'error' : ''}`}>
            <Icon name={notice.error ? 'info' : 'check'} size={18} />
            <span>{displayMessage(notice.text, locale)}</span>
            <button className="icon-button" onClick={() => setNotice(null)} aria-label={t('common.dismiss')}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {ordering.notice &&
          (ordering.notice.error ? (
            <ErrorNotice message={ordering.notice.text} />
          ) : (
            <div role="status" className="notice">
              {displayMessage(ordering.notice.text, locale)}
            </div>
          ))}
        {loading ? (
          <Loading />
        ) : (
          data && (
            <section className="admin-list">
              {!data.monitors.length ? (
                <Empty title={t('monitor.empty')} icon="server">
                  {t('monitor.supported')}
                  <br />
                  <button className="button primary empty-action" onClick={() => setEditor('new')}>
                    <Icon name="plus" size={16} />
                    {t('monitor.addFirst')}
                  </button>
                </Empty>
              ) : (
                displayGroups.map((group) => {
                  const members = membersByGroup.get(group.id) ?? [];
                  const collapsed = collapsedGroups.isCollapsed(group.id);
                  const controls = `admin-group-${group.id}`;
                  return (
                    members.length > 0 && (
                      <section className="admin-group" key={group.id} aria-label={group.name}>
                        <GroupHeading
                          name={group.name}
                          count={members.length}
                          collapsed={collapsed}
                          controls={controls}
                          toggle={() => collapsedGroups.toggle(group.id)}
                          variant="admin"
                          disabled={remote.locked || ordering.saving}
                        />
                        <div id={controls} hidden={collapsed}>
                          {members.map((monitor, index) => (
                            <article className="admin-card" key={monitor.id} {...ordering.rowProps(monitor)}>
                              <div className="admin-card-info">
                                <span className="service-icon">
                                  <Icon name={monitor.type === 'http' ? 'globe' : 'server'} />
                                </span>
                                <div>
                                  <div className="admin-name">
                                    <h2>{monitor.name}</h2>
                                    <StatusBadge status={monitor.status} />
                                  </div>
                                  <p
                                    className="target-text"
                                    title={monitor.type === 'http' ? monitor.url : monitor.hostname}
                                  >
                                    {monitor.type === 'http'
                                      ? monitor.url
                                      : `${monitor.hostname.includes(':') ? `[${monitor.hostname}]` : monitor.hostname}:${monitor.port}`}
                                  </p>
                                  <div className="monitor-meta">
                                    <span className="protocol">{monitor.type.toUpperCase()}</span>
                                    <span>
                                      {groupsById.get(monitor.groupId ?? '')?.name ?? t('groups.ungrouped')}
                                    </span>
                                    <span>{t('monitor.interval', { count: monitor.intervalMinutes })}</span>
                                    <span>{t('monitor.timeout', { count: monitor.timeoutSeconds })}</span>
                                    <span>
                                      {t('monitor.lastCheck', {
                                        time: formatTime(monitor.lastCheckedAt, false, locale),
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="admin-actions">
                                <SortControls
                                  name={monitor.name}
                                  index={index}
                                  count={members.length}
                                  disabled={ordering.disabled}
                                  handleProps={ordering.handleProps(monitor)}
                                  move={(offset) => ordering.move(monitor, members[index + offset])}
                                />
                                <button
                                  className="button small secondary"
                                  disabled={busy === monitor.id || remote.locked}
                                  onClick={() =>
                                    void action(monitor.id, async () => {
                                      const result = await api<ProbeResult>(
                                        `/api/admin/monitors/${monitor.id}/test`,
                                        {
                                          method: 'POST',
                                          body: '{}',
                                        },
                                      );
                                      if (!result.ok)
                                        throw new NoticeError(
                                          message('monitor.testFailed', {
                                            name: monitor.name,
                                            reason: message(
                                              result.errorCode
                                                ? ERROR_LABELS[result.errorCode]
                                                : 'monitor.checkFailed',
                                            ),
                                            latency: latency(result.latencyMs, locale),
                                          }),
                                        );
                                      return message('monitor.testSucceeded', {
                                        name: monitor.name,
                                        latency: latency(result.latencyMs, locale),
                                      });
                                    })
                                  }
                                >
                                  <Icon name="pulse" size={16} />
                                  {busy === monitor.id ? t('event.status.open') : t('monitor.test')}
                                </button>
                                <button
                                  className="icon-button"
                                  title={monitor.enabled ? t('monitor.pause') : t('monitor.resume')}
                                  aria-label={t(
                                    monitor.enabled ? 'monitor.pauseNamed' : 'monitor.resumeNamed',
                                    {
                                      name: monitor.name,
                                    },
                                  )}
                                  disabled={busy === monitor.id || remote.locked}
                                  onClick={() =>
                                    void action(monitor.id, async () => {
                                      await api(`/api/admin/monitors/${monitor.id}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({
                                          enabled: !monitor.enabled,
                                          version: monitor.version,
                                        }),
                                      });
                                      return monitor.enabled
                                        ? message('monitor.paused')
                                        : message('monitor.resumed');
                                    })
                                  }
                                >
                                  <Icon name={monitor.enabled ? 'pause' : 'play'} size={17} />
                                </button>
                                <button
                                  className="icon-button"
                                  title={t('monitors.edit')}
                                  aria-label={t('common.editNamed', { name: monitor.name })}
                                  disabled={busy === monitor.id || remote.locked}
                                  onClick={() => setEditor(monitor)}
                                >
                                  <Icon name="edit" size={17} />
                                </button>
                                <button
                                  className="icon-button danger"
                                  title={t('monitor.delete')}
                                  aria-label={t('common.deleteNamed', { name: monitor.name })}
                                  disabled={busy === monitor.id || remote.locked}
                                  onClick={() => {
                                    setDeleting(monitor);
                                    setDeleteError(null);
                                  }}
                                >
                                  <Icon name="trash" size={17} />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )
                  );
                })
              )}
            </section>
          )
        )}
      </div>
      {editor && (
        <MonitorEditor
          groups={data ? data.groups : []}
          initial={editor === 'new' ? undefined : editor}
          save={save}
          close={() => setEditor(null)}
        />
      )}
      {deleting && (
        <Modal
          title={t('monitor.delete')}
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="modal-scroll delete-body">
            <p>{t('monitor.deleteQuestion', { name: deleting.name })}</p>
            <p className="muted">{t('monitor.deleteNote')}</p>
            {deleteError && <ErrorNotice message={deleteError} />}
          </div>
          <div className="modal-actions">
            <button className="button secondary" disabled={!!busy} onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </button>
            <button className="button destructive" disabled={!!busy} onClick={() => void remove()}>
              {busy ? t('common.deleting') : t('common.confirmDelete')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
