import { displayMessage, errorMessage, message, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { localizedEventTitle } from './presentation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminEvent,
  EventBulkDeleteRequest,
  EventBulkDeleteResponse,
  EventConfig,
  EventsResponse,
} from '../../../shared/events/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import type { GlobalSettings } from '../../../shared/settings/types';
import { api, ApiError } from '../../lib/api';
import { useRemote } from '../../hooks/useRemote';
import { usePageState } from '../../hooks/usePageState';
import { isRecord } from '../../lib/navigation';
import { ErrorNotice, Loading } from '../../components/feedback';
import { Modal } from '../../components/Modal';
import { EventList } from './EventList';
import { RefreshStatus } from '../../components/RefreshStatus';
import { EventEditor } from './EventEditor';
import { ProgressEditor } from './ProgressEditor';

const canDeleteEvent = (event: AdminEvent) => event.source === 'manual' || event.status !== 'open';

interface Pagination {
  cursor: string | null;
  previous: (string | null)[];
}

const isCursor = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0);
const isPagination = (value: unknown): value is Pagination =>
  isRecord(value) &&
  isCursor(value.cursor) &&
  Array.isArray(value.previous) &&
  value.previous.every(isCursor) &&
  (value.cursor === null ? value.previous.length === 0 : value.previous[0] === null);

export function EventManager({
  monitors,
  settings,
  onReadyChange,
}: {
  monitors: AdminMonitor[];
  settings?: GlobalSettings;
  onReadyChange: (ready: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [{ cursor, previous }, setPagination] = usePageState<Pagination>(
    'eventPagination',
    { cursor: null, previous: [] },
    isPagination,
  );
  const remote = useRemote<EventsResponse>(
    `/api/admin/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  const ready = Boolean(remote.data) && !remote.loading;
  useEffect(() => {
    onReadyChange(ready);
    return () => onReadyChange(false);
  }, [ready, onReadyChange]);
  useEffect(() => {
    if (settings) remote.refreshWithSettings(settings);
  }, [settings, remote.refreshWithSettings]);
  const [editor, setEditor] = useState<AdminEvent | 'new' | null>(null);
  const [progress, setProgress] = useState<AdminEvent | null>(null);
  const [deleting, setDeleting] = useState<AdminEvent | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState<AdminEvent[] | null>(null);
  const [selected, setSelected] = useState<Map<string, number>>(() => new Map());
  const [notice, setNotice] = useState<{ text: DisplayMessage; error: boolean } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const selectable = useMemo(() => (remote.data?.events ?? []).filter(canDeleteEvent), [remote.data]);
  const selectedEvents = useMemo(
    () => selectable.filter((event) => selected.get(event.id) === event.version),
    [selectable, selected],
  );
  useEffect(() => {
    // A refreshed event must be selected again if its version or eligibility changed.
    setSelected((current) => {
      const retained = new Map(
        selectable
          .filter((event) => current.get(event.id) === event.version)
          .map((event) => [event.id, event.version]),
      );
      return retained.size === current.size ? current : retained;
    });
  }, [selectable]);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        selectedEvents.length > 0 && selectedEvents.length < selectable.length;
  }, [selectedEvents.length, selectable.length]);
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
    setSelected(new Map());
    setPagination({ cursor: null, previous: [] });
    if (!cursor) remote.refresh();
  }
  async function removeSelected() {
    if (!bulkDeleting || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: EventBulkDeleteRequest = {
      items: bulkDeleting.map(({ id, version }) => ({ id, version })),
    };
    try {
      const result = await api<EventBulkDeleteResponse>('/api/admin/events/bulk-delete', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setBulkDeleting(null);
      setNotice({ text: message('event.bulkDeleted', { count: result.deletedCount }), error: false });
      latest();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBulkDeleting(null);
        setSelected(new Map());
        setNotice({ text: errorMessage(err, 'error.delete'), error: true });
        remote.refresh();
      } else {
        setError(errorMessage(err, 'error.delete'));
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function renderSelection(event: AdminEvent) {
    const allowed = canDeleteEvent(event);
    return (
      <div className="event-selection">
        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label={t('event.select', { title: localizedEventTitle(event, locale) })}
            aria-describedby={allowed ? undefined : `event-selection-reason-${event.id}`}
            checked={allowed && selected.get(event.id) === event.version}
            disabled={!allowed || busy}
            onChange={(change) => {
              const checked = change.currentTarget.checked;
              setSelected((current) => {
                const next = new Map(current);
                if (checked) next.set(event.id, event.version);
                else next.delete(event.id);
                return next;
              });
            }}
          />
          <span>{t('event.selectShort')}</span>
        </label>
        {!allowed && (
          <span className="muted" id={`event-selection-reason-${event.id}`}>
            {t('event.cannotSelectAutomatic')}
          </span>
        )}
      </div>
    );
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
  function renderActions(event: AdminEvent) {
    return (
      <>
        <button className="button small secondary" onClick={() => setProgress(event)}>
          {t('event.addUpdate')}
        </button>
        {event.source === 'manual' && (
          <button className="button small secondary" onClick={() => setEditor(event)}>
            {t('event.edit')}
          </button>
        )}
        {canDeleteEvent(event) && (
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
    );
  }
  return (
    <div className="event-manager">
      <div className="event-toolbar">
        <div className="event-bulk-controls">
          <label className="checkbox-field">
            <input
              ref={selectAll}
              type="checkbox"
              checked={selectable.length > 0 && selectedEvents.length === selectable.length}
              disabled={!selectable.length || remote.loading || busy}
              onChange={(change) =>
                setSelected(
                  change.currentTarget.checked
                    ? new Map(selectable.map((event) => [event.id, event.version]))
                    : new Map(),
                )
              }
            />
            <span>{t('event.selectAll')}</span>
          </label>
          <span className="muted" role="status">
            {t('event.selectedCount', { count: selectedEvents.length })}
          </span>
          <button
            className="button small secondary"
            disabled={!selectedEvents.length || busy}
            onClick={() => setSelected(new Map())}
          >
            {t('event.clearSelection')}
          </button>
          <button
            className="button small destructive"
            disabled={!selectedEvents.length || busy}
            onClick={() => {
              setBulkDeleting([...selectedEvents]);
              setError(null);
              setNotice(null);
            }}
          >
            {t('event.bulkDelete')}
          </button>
        </div>
        <button className="button primary" disabled={!monitors.length} onClick={() => setEditor('new')}>
          {t('event.publish')}
        </button>
      </div>
      <RefreshStatus {...remote} />
      {notice &&
        (notice.error ? (
          <ErrorNotice message={notice.text} />
        ) : (
          <p className="form-note" role="status">
            {displayMessage(notice.text, locale)}
          </p>
        ))}
      {remote.error && <ErrorNotice message={remote.error} retry={remote.refresh} />}
      {remote.loading ? (
        <Loading />
      ) : (
        <>
          <EventList
            events={remote.data?.events ?? []}
            variant="open"
            actions={renderActions}
            selection={renderSelection}
          />
          <EventList
            events={remote.data?.events ?? []}
            variant="history"
            actions={renderActions}
            selection={renderSelection}
          />
        </>
      )}
      <div className="event-pagination">
        {previous.length > 0 && (
          <>
            <button
              className="button secondary"
              onClick={() => {
                setSelected(new Map());
                setPagination({ cursor: previous.at(-1)!, previous: previous.slice(0, -1) });
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
              setSelected(new Map());
              setPagination({ cursor: remote.data!.nextCursor, previous: [...previous, cursor] });
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
      {bulkDeleting && (
        <Modal
          title={t('event.bulkDelete')}
          close={() => {
            if (!busy) setBulkDeleting(null);
          }}
        >
          <div className="modal-scroll delete-body">
            <p>{t('event.bulkDeleteQuestion', { count: bulkDeleting.length })}</p>
            <ul className="event-bulk-titles">
              {bulkDeleting.map((event) => (
                <li key={event.id}>{localizedEventTitle(event, locale)}</li>
              ))}
            </ul>
            {error && <ErrorNotice message={error} />}
          </div>
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setBulkDeleting(null)}>
              {t('common.cancel')}
            </button>
            <button className="button destructive" disabled={busy} onClick={() => void removeSelected()}>
              {t(busy ? 'common.deleting' : 'event.confirmBulkDelete')}
            </button>
          </div>
        </Modal>
      )}
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
