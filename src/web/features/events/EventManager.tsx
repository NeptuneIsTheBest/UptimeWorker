import { errorMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { localizedEventTitle } from './presentation';
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
  const { t, locale } = useI18n();
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
  const [error, setError] = useState<DisplayMessage | null>(null);
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
      setError(errorMessage(err, 'error.delete'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="event-manager">
      <div className="event-toolbar">
        <button className="button primary" disabled={!monitors.length} onClick={() => setEditor('new')}>
          {t('event.publish')}
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
                {t('event.addUpdate')}
              </button>
              {event.source === 'manual' && (
                <button className="button small secondary" onClick={() => setEditor(event)}>
                  {t('event.edit')}
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
                  {t('event.delete')}
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
              {t('common.previous')}
            </button>
            <button className="button secondary" onClick={latest}>
              {t('event.newest')}
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
            {t('event.older')}
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
          title={t('event.delete')}
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="modal-scroll delete-body">
            <p>{t('event.deleteQuestion', { title: localizedEventTitle(deleting, locale) })}</p>
            {error && <ErrorNotice message={error} />}
          </div>
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </button>
            <button className="button destructive" disabled={busy} onClick={() => void remove()}>
              {t('event.confirmDelete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
