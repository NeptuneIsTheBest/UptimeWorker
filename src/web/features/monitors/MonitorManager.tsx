import { message, errorMessage, displayMessage, NoticeError, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { useState } from 'react';
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

export function MonitorManager({
  remote,
  visible,
  editor,
  onEditorChange: setEditor,
  notice,
  onNoticeChange: setNotice,
}: {
  remote: ReturnType<typeof useRemote<AdminResponse>>;
  visible: boolean;
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
              {t('admin.monitorCount', { count: data.monitors.length, limit: data.limit })}
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
                data.monitors.map((monitor) => (
                  <article className="admin-card" key={monitor.id}>
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
                            {data.groups?.find((group) => group.id === monitor.groupId)?.name ??
                              t('groups.ungrouped')}
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
                      <button
                        className="button small secondary"
                        disabled={busy === monitor.id}
                        onClick={() =>
                          void action(monitor.id, async () => {
                            const result = await api<ProbeResult>(`/api/admin/monitors/${monitor.id}/test`, {
                              method: 'POST',
                              body: '{}',
                            });
                            if (!result.ok)
                              throw new NoticeError(
                                message('monitor.testFailed', {
                                  name: monitor.name,
                                  reason: message(
                                    result.errorCode ? ERROR_LABELS[result.errorCode] : 'monitor.checkFailed',
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
                        aria-label={t(monitor.enabled ? 'monitor.pauseNamed' : 'monitor.resumeNamed', {
                          name: monitor.name,
                        })}
                        disabled={busy === monitor.id}
                        onClick={() =>
                          void action(monitor.id, async () => {
                            await api(`/api/admin/monitors/${monitor.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !monitor.enabled, version: monitor.version }),
                            });
                            return monitor.enabled ? message('monitor.paused') : message('monitor.resumed');
                          })
                        }
                      >
                        <Icon name={monitor.enabled ? 'pause' : 'play'} size={17} />
                      </button>
                      <button
                        className="icon-button"
                        title={t('monitors.edit')}
                        aria-label={t('common.editNamed', { name: monitor.name })}
                        disabled={busy === monitor.id}
                        onClick={() => setEditor(monitor)}
                      >
                        <Icon name="edit" size={17} />
                      </button>
                      <button
                        className="icon-button danger"
                        title={t('monitor.delete')}
                        aria-label={t('common.deleteNamed', { name: monitor.name })}
                        disabled={busy === monitor.id}
                        onClick={() => {
                          setDeleting(monitor);
                          setDeleteError(null);
                        }}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
          )
        )}
      </div>
      {editor && (
        <MonitorEditor
          groups={data?.groups ?? []}
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
