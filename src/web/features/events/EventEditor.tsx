import { errorMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { useState, type FormEvent } from 'react';
import type { AdminEvent, EventConfig } from '../../../shared/events/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import { parseEventConfig } from '../../../shared/events/validation';
import { ErrorNotice } from '../../components/feedback';
import { Modal } from '../../components/Modal';

const localTime = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export function EventEditor({
  initial,
  monitors,
  save,
  close,
}: {
  initial?: AdminEvent;
  monitors: AdminMonitor[];
  save: (config: EventConfig) => Promise<void>;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const deletedMonitors = initial?.monitors.filter((monitor) => monitor.id === null) ?? [];
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [type, setType] = useState<EventConfig['type']>(initial?.type ?? 'incident');
  const [ids, setIds] = useState<string[]>(initial?.monitors.flatMap((m) => (m.id ? [m.id] : [])) ?? []);
  const [start, setStart] = useState(localTime(initial?.startsAt ?? Date.now() + 3_600_000));
  const [end, setEnd] = useState(localTime(initial?.endsAt ?? Date.now() + 7_200_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const config = parseEventConfig(
        {
          title,
          body,
          type,
          monitorIds: ids,
          startsAt: new Date(start).getTime(),
          endsAt: new Date(end).getTime(),
        },
        deletedMonitors.length > 0,
      );
      setBusy(true);
      await save(config);
    } catch (err) {
      setError(errorMessage(err, 'error.save'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? t('event.edit') : t('event.publish')}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form noValidate className="monitor-form" onSubmit={submit}>
        <div className="modal-scroll">
          <p className="form-note">{t('event.publishNote')}</p>
          <label className="field">
            {t('event.title')}
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            {t('event.type')}
            <select value={type} onChange={(e) => setType(e.target.value as EventConfig['type'])}>
              <option value="incident">{t('event.incident')}</option>
              <option value="maintenance">{t('event.maintenance')}</option>
            </select>
          </label>
          <label className="field">
            {t('event.body')}
            <textarea
              required
              rows={5}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <fieldset className="event-node-picker">
            <legend>{t('event.monitors')}</legend>
            {!monitors.length && !deletedMonitors.length && (
              <p className="muted">{t('event.addMonitorsFirst')}</p>
            )}
            {deletedMonitors.length > 0 && (
              <p className="form-note">
                {t('event.deletedAssociations', {
                  names: deletedMonitors.map((monitor) => monitor.name).join(locale === 'en' ? ', ' : '、'),
                })}
              </p>
            )}
            {monitors.map((monitor) => (
              <label className="checkbox-field" key={monitor.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(monitor.id)}
                  onChange={(e) =>
                    setIds((current) =>
                      e.target.checked ? [...current, monitor.id] : current.filter((id) => id !== monitor.id),
                    )
                  }
                />
                <span>{monitor.name}</span>
              </label>
            ))}
          </fieldset>
          {type === 'maintenance' && (
            <>
              <label className="field">
                {t('event.startInput')}
                <input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="field">
                {t('event.endInput')}
                <input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              <p className="form-note">{t('event.timeNote')}</p>
              <details className="form-help">
                <summary>{t('event.maintenanceHelp')}</summary>
                <p>{t('event.timeDetails')}</p>
              </details>
            </>
          )}
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="button primary" disabled={busy || (!monitors.length && !deletedMonitors.length)}>
            {busy ? t('common.saving') : initial ? t('event.save') : t('event.publish')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
