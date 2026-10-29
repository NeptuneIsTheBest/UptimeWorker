import { useEffect, useState } from 'react';
import type { AdminEvent, EventConfig, EventsResponse } from '../../../shared/events/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import type { GlobalSettings } from '../../../shared/settings/types';
import { api } from '../../lib/api';
import { useRemote } from '../../hooks/useRemote';
import { ErrorNotice, Loading } from '../../components/feedback';
import { Modal } from '../../components/Modal';
import { EventList } from './EventList';
import { RefreshStatus } from '../../components/RefreshStatus';
import { EventEditor } from './EventEditor';
import { ProgressEditor } from './ProgressEditor';

export function EventManager({
  monitors,
  settings,
}: {
  monitors: AdminMonitor[];
  settings?: GlobalSettings;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const remote = useRemote<EventsResponse>(
    `/api/admin/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  useEffect(() => {
    if (settings) remote.refreshWithSettings(settings);
  }, [settings, remote.refreshWithSettings]);
  const [editor, setEditor] = useState<AdminEvent | 'new' | null>(null);
  const [progress, setProgress] = useState<AdminEvent | null>(null);
  const [deleting, setDeleting] = useState<AdminEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(config: EventConfig) {
    const existing = editor !== 'new' ? editor : null;
    await api(existing ? `/api/admin/events/${existing.id}` : '/api/admin/events', {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...config, ...(existing ? { version: existing.version } : {}) }),
    });
    setEditor(null);
    latest();
  }
  function latest() {
    setCursor(null);
    setPrevious([]);
    remote.refresh();
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/events/${deleting.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: deleting.version }),
      });
      setDeleting(null);
      remote.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="event-manager">
      <div className="event-toolbar">
        <p className="muted">发布维护安排，记录故障处理与恢复过程。</p>
        <button className="button primary" disabled={!monitors.length} onClick={() => setEditor('new')}>
          发布事件
        </button>
      </div>
      <RefreshStatus {...remote} />
      {remote.error && <ErrorNotice message={remote.error} retry={remote.refresh} />}
      {remote.loading ? (
        <Loading />
      ) : (
        <EventList
          events={remote.data?.events ?? []}
          actions={(event) => (
            <>
              <button className="button small secondary" onClick={() => setProgress(event)}>
                追加进展
              </button>
              {event.source === 'manual' && (
                <button className="button small secondary" onClick={() => setEditor(event)}>
                  编辑事件
                </button>
              )}
              {(event.source === 'manual' || event.status !== 'open') && (
                <button
                  className="button small secondary"
                  onClick={() => {
                    setDeleting(event);
                    setError(null);
                  }}
                >
                  删除事件
                </button>
              )}
            </>
          )}
        />
      )}
      <div className="event-pagination">
        {previous.length > 0 && (
          <>
            <button
              className="button secondary"
              onClick={() => {
                setCursor(previous.at(-1)!);
                setPrevious((values) => values.slice(0, -1));
              }}
            >
              上一页
            </button>
            <button className="button secondary" onClick={latest}>
              返回最新
            </button>
          </>
        )}
        {remote.data?.nextCursor && (
          <button
            className="button secondary"
            onClick={() => {
              setPrevious((values) => [...values, cursor]);
              setCursor(remote.data!.nextCursor);
            }}
          >
            更早事件
          </button>
        )}
      </div>
      {editor && (
        <EventEditor
          initial={editor === 'new' ? undefined : editor}
          monitors={monitors}
          save={save}
          close={() => setEditor(null)}
        />
      )}
      {progress && <ProgressEditor event={progress} saved={latest} close={() => setProgress(null)} />}
      {deleting && (
        <Modal
          title="删除事件"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>确定删除「{deleting.title}」及其全部进展记录？</p>
          {error && <ErrorNotice message={error} />}
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="button destructive" disabled={busy} onClick={() => void remove()}>
              确认删除事件
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
